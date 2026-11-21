"""Static checks on deploy/: what the proxy log keeps, how compose wires the mirror lane, which host
interfaces get a port. Docker is not available on the dev Mac, so compose is checked as YAML only;
tests/test_edge_caddy.py runs the Caddy rules for real."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import pytest
import yaml

REPO = Path(__file__).resolve().parents[1]
DEPLOY = REPO / "deploy"
CADDYFILES = [DEPLOY / "Caddyfile", DEPLOY / "Caddyfile.local"]
SECRET_QUERY_KEYS = ("current", "new", "repeat")
QUERY_FILTER = re.compile(r"request>uri query \{(?P<body>[^}]*)\}")
SOCKET_PATH = re.compile(r"/run/(?:edge|twin)/[a-z]+\.sock")
REAL_SIDE_VOLUMES = {"edge-sockets", "real-data", "mirror-state"}
ROUTER_FLAGS = [
    *("--lane", "--tap", "--relay", "--relay-block-host", "--real", "--twin", "--sync"),
    *("--sentinel", "--state", "--spool", "--canaries"),
]
RELAY_PORT = "8097"
TOKEN_REF = re.compile(r"^\$\{SENTINEL_INGEST_TOKEN:\?[^}]+\}$")
# Plays `python -m <module> ...` in the compose job scripts: logs the module, fails it for $FAIL.
FAKE_PYTHON = 'python() { echo "$2" >>"$CALLS"; [ "$2" != "$FAIL" ]; }\n'


def _compose() -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load((DEPLOY / "docker-compose.yml").read_text())
    return loaded


def _services() -> dict[str, dict[str, Any]]:
    services: dict[str, dict[str, Any]] = _compose()["services"]
    return services


def _mounts(service: dict[str, Any]) -> dict[str, str]:
    """Volume name or host path -> mount point inside the container."""
    pairs = (str(v).split(":")[:2] for v in service.get("volumes", []))
    return {source: target for source, target in pairs}


def _command(service: dict[str, Any]) -> list[str]:
    return [str(arg) for arg in service.get("command", [])]


def _flag(command: list[str], name: str) -> str:
    return command[command.index(name) + 1]


@pytest.mark.parametrize("caddyfile", CADDYFILES, ids=lambda p: p.name)
def test_log_filter_redacts_the_password_change_query(caddyfile: Path) -> None:
    text = caddyfile.read_text(encoding="utf-8")
    found = QUERY_FILTER.search(text)
    assert found, f"{caddyfile.name}: no request>uri query filter"
    lines = {line.strip() for line in found["body"].splitlines() if line.strip()}
    assert lines == {f"replace {key} REDACTED" for key in SECRET_QUERY_KEYS}


@pytest.mark.parametrize("caddyfile", CADDYFILES, ids=lambda p: p.name)
def test_header_limit_is_pinned_for_the_dashboard_body_limit(caddyfile: Path) -> None:
    assert re.search(r"^\s*max_header_size 16KiB$", caddyfile.read_text(), re.MULTILINE)


@pytest.mark.parametrize(
    ("caddyfile", "socket_dir"), [(CADDYFILES[0], "/run/edge"), (CADDYFILES[1], "run")]
)
def test_both_edges_import_the_one_set_of_lane_rules(caddyfile: Path, socket_dir: str) -> None:
    text = caddyfile.read_text(encoding="utf-8")
    assert re.findall(r"^import (.+)$", text, re.MULTILINE) == ["lanes.caddy"]
    assert re.findall(r"^\s+import lanes (.+)$", text, re.MULTILINE) == [socket_dir]
    assert "reverse_proxy" not in text and "forward_auth" not in text


def test_caddy_mounts_the_lane_rules_beside_its_caddyfile_and_the_edge_sockets() -> None:
    caddy = _services()["caddy"]
    mounts = _mounts(caddy)
    assert mounts["./Caddyfile"] == "/etc/caddy/Caddyfile"
    assert mounts["./lanes.caddy"] == "/etc/caddy/lanes.caddy"
    assert mounts["edge-sockets"] == "/run/edge"
    assert caddy["ports"] == ["8080:80"]


def test_twin_has_no_network_and_no_real_side_volume() -> None:
    twin = _services()["twin"]
    assert twin["network_mode"] == "none"
    assert twin["read_only"] is True and twin["cap_drop"] == ["ALL"]
    assert set(_mounts(twin)) == {"twin-sockets", "twin-data"}
    assert not REAL_SIDE_VOLUMES & set(_mounts(twin))


def test_only_caddy_router_and_sentinel_get_a_network() -> None:
    services = _services()
    networked = {
        name
        for name, service in services.items()
        if "network_mode" not in service and "eval" not in service.get("profiles", [])
    }
    assert networked == {"caddy", "router", "sentinel"}


def test_the_twin_reaches_out_only_through_the_bridges_to_the_router_relay() -> None:
    services = _services()
    egress = _flag(_command(services["twin"]), "--egress-proxy")
    assert egress == f"http://127.0.0.1:{RELAY_PORT}"
    assert _flag(_command(services["router"]), "--relay") == f"127.0.0.1:{RELAY_PORT}"
    twin_side, router_side = services["twin-egress"], services["relay-bridge"]
    assert twin_side["network_mode"] == "service:twin"
    assert router_side["network_mode"] == "service:router"
    assert _command(twin_side) == [
        f"TCP-LISTEN:{RELAY_PORT},bind=127.0.0.1,fork,reuseaddr",
        "UNIX-CONNECT:/run/twin/relay.sock",
    ]
    assert _command(router_side)[0].startswith("UNIX-LISTEN:/run/twin/relay.sock,")
    assert _command(router_side)[1] == f"TCP:127.0.0.1:{RELAY_PORT}"


def test_every_socket_a_service_names_is_on_a_volume_it_mounts() -> None:
    for name, service in _services().items():
        mounted = set(_mounts(service).values())
        for path in SOCKET_PATH.findall(" ".join(_command(service))):
            assert str(Path(path).parent) in mounted, f"{name}: {path} is not on a volume"


def test_router_runs_the_contract_cli_with_the_token_from_the_environment() -> None:
    services = _services()
    router = services["router"]
    command = _command(router)
    assert command[:3] == ["python", "-m", "mirror"]
    assert [arg for arg in command if arg.startswith("--")] == ROUTER_FLAGS
    assert _flag(command, "--sentinel") == "http://sentinel:8787"
    assert _flag(command, "--relay-block-host") == "${PUBLIC_HOST:-localhost}"
    assert services["sentinel"]["environment"]["SENTINEL_ALLOWED_HOSTS"] == "sentinel"
    for name in ("router", "sentinel"):
        token = services[name]["environment"]["SENTINEL_INGEST_TOKEN"]
        assert TOKEN_REF.match(token), f"{name}: the ingest token must come from the environment"


def test_data_jobs_finish_before_the_shops_start() -> None:
    services = _services()
    done = {"condition": "service_completed_successfully"}
    assert services["mask"]["depends_on"] == {"seed": done}
    assert services["real"]["depends_on"] == {"seed": done}
    assert services["twin"]["depends_on"] == {"mask": done}
    assert services["sync"]["depends_on"] == {"mask": done}
    for job in ("seed", "mask"):
        assert services[job]["restart"] == "no" and services[job]["network_mode"] == "none"


def _run_job(name: str, root: Path, fail: str = "") -> bool:
    """Run the compose job's own sh script with /data under root and a recording fake python."""
    shell, flag, script = _command(_services()[name])
    assert (shell, flag) == ("sh", "-c")
    env = {"PATH": os.environ["PATH"], "CALLS": str(root / "calls"), "FAIL": fail}
    script = FAKE_PYTHON + script.replace("/data/", f"{root}/data/")
    return subprocess.run(["sh", "-c", script], env=env, check=False, timeout=30).returncode == 0


def test_data_jobs_run_until_they_succeed_once_and_a_new_seed_redoes_the_mask(
    tmp_path: Path,
) -> None:
    real = tmp_path / "data" / "real"
    for side in ("real", "twin"):
        (tmp_path / "data" / side).mkdir(parents=True)

    def calls() -> list[str]:
        return (tmp_path / "calls").read_text().split()

    assert not _run_job("seed", tmp_path, fail="demo.seed")
    (real / "real.db").write_text("half written")
    assert _run_job("seed", tmp_path)
    assert not (real / "real.db").exists(), "a seed after a failed one starts from scratch"
    assert not _run_job("mask", tmp_path, fail="demo.mask")
    assert _run_job("mask", tmp_path)
    assert _run_job("seed", tmp_path) and _run_job("mask", tmp_path)
    assert calls() == ["demo.seed", "demo.seed", "demo.mask", "demo.mask"]
    (real / "seed.done").unlink()
    assert _run_job("seed", tmp_path) and _run_job("mask", tmp_path)
    assert calls()[4:] == ["demo.seed", "demo.mask"]


def test_no_engine_follow_service_and_replay_only_on_demand() -> None:
    services = _services()
    assert "engine" not in services
    assert not any("follow" in _command(service) for service in services.values())
    assert services["replay"]["profiles"] == ["eval"]
    assert _command(services["replay"]) == ["replay", "/var/log/caddy/access.log"]


def test_sentinel_port_is_published_on_loopback_only() -> None:
    ports = [str(port) for port in _services()["sentinel"].get("ports", [])]
    assert ports == ["127.0.0.1:8787:8787"]


def test_every_image_and_dockerfile_exists_and_is_pinned() -> None:
    for name, service in _services().items():
        build = service.get("build")
        if build:
            assert (REPO / build["dockerfile"]).is_file(), f"{name}: missing Dockerfile"
        else:
            assert re.search(r":[0-9][\w.-]*$", service["image"]), f"{name}: unpinned image"
    for dockerfile in DEPLOY.glob("*.Dockerfile"):
        for line in dockerfile.read_text().splitlines():
            if line.startswith(("FROM ", "COPY --from=")):
                image = line.split()[1].removeprefix("--from=")
                assert re.search(r":[0-9][\w.-]*$", image), f"{dockerfile.name}: {line}"


def test_named_volumes_are_declared() -> None:
    compose = _compose()
    used = {
        source
        for service in compose["services"].values()
        for source in _mounts(service)
        if not source.startswith(".")
    }
    assert used == set(compose["volumes"])


def _password_change_queries() -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for log in sorted((REPO / "eval" / "data").rglob("*.jsonl")):
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
            if "change-password" not in line:
                continue
            uri = urlsplit(json.loads(line).get("request", {}).get("uri", ""))
            if uri.path.rstrip("/").endswith("/change-password"):
                pairs.extend(parse_qsl(uri.query, keep_blank_values=True))
    return pairs


def test_captured_eval_data_holds_no_password_change_values() -> None:
    pairs = _password_change_queries()
    leaked = [(k, v) for k, v in pairs if k in SECRET_QUERY_KEYS and v != "REDACTED"]
    assert leaked == []
