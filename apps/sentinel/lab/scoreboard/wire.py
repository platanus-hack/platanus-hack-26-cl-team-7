"""HTTP observations and Envoy lifecycle for Reaper's local fixture runner."""
from contextlib import contextmanager
from datetime import datetime, timezone
from http.client import HTTPConnection
from pathlib import Path
from tempfile import TemporaryDirectory
import socket
import subprocess
import time
from urllib.parse import urlencode
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
ENVOY_IMAGE = "envoyproxy/envoy:v1.36.2"


def request(port, path, actor="read-only-client", headers=None, form=None):
    conn = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        fields = {"User-Agent": actor, **(headers or {})}
        if form is None:
            conn.request("GET", path, headers=fields)
        else:
            fields.update({"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"})
            conn.request("POST", path, body=urlencode(form), headers=fields)
        response = conn.getresponse()
        return response.status, response.getheaders(), response.read().decode()
    finally:
        conn.close()


def await_value(operation):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            if result := operation():
                return result
        except OSError:
            pass
        time.sleep(0.02)
    raise TimeoutError("Timed out waiting for proxy or rule")


def free_ports(count):
    sockets = [socket.socket() for _ in range(count)]
    try:
        for listener in sockets:
            listener.bind(("127.0.0.1", 0))
        return [listener.getsockname()[1] for listener in sockets]
    finally:
        for listener in sockets:
            listener.close()


@contextmanager
def proxy(binary, mode, upstream, run_id, event_dir=None, payload_dir=None, businesses=()):
    with TemporaryDirectory(prefix="up-defense-") as temp:
        work = Path(temp)
        listen, admin, ingress, envoy_admin = free_ports(4)
        events = event_dir / f"{run_id}-{mode}.jsonl" if event_dir else work / "events.jsonl"
        command = [str(binary), "-mode", mode, "-listen", f"127.0.0.1:{listen}",
                   "-admin", f"127.0.0.1:{admin}", "-upstream", f"http://127.0.0.1:{upstream}",
                   "-events", str(events)]
        if event_dir:
            command.extend(["-run-id", run_id])
        if payload_dir:
            command.extend(["-payload-archive", str(payload_dir / f"{run_id}-{mode}.jsonl")])
        for business in businesses:
            command.extend(["-canary", f"{business.slug}={business.private_ref}"])
        engine_log = work / "engine.log"
        with engine_log.open("w") as log:
            engine = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        container = None
        try:
            await_value(lambda: request(admin, "/healthz")[0] == 200)
            if mode == "extproc":
                template = (ROOT / "deploy/envoy.tmpl.yaml").read_text()
                for name, value in {"LISTEN": ingress, "UPSTREAM_PORT": upstream,
                                    "EXTPROC_PORT": listen, "ADMIN_PORT": envoy_admin}.items():
                    template = template.replace(f"__{name}__", str(value))
                config = work / "envoy.yaml"
                config.write_text(template.replace("0.0.0.0", "127.0.0.1"))
                container = subprocess.check_output([
                    "docker", "run", "-d", "--network", "host", "-v",
                    f"{config}:/etc/envoy/envoy.yaml:ro", ENVOY_IMAGE,
                    "-c", "/etc/envoy/envoy.yaml", "--disable-hot-restart", "--log-level", "error",
                ], text=True).strip()
                await_value(lambda: request(ingress, "/")[0] == 200)
            yield ingress if mode == "extproc" else listen, admin, events
        except Exception:
            if container:
                subprocess.run(["docker", "logs", "--tail", "15", container], check=False)
            print(engine_log.read_text())
            raise
        finally:
            if container:
                subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, check=True)
            engine.terminate()
            engine.wait(timeout=5)


def wire(service, port, path, actor, token=None, headers=None, form=None):
    before = service.count(path)
    started = time.monotonic()
    fixture_id = uuid4().hex
    status, actual_headers, body = request(port, path, actor, {**(headers or {}), "X-Up-Fixture-Id": fixture_id}, form)
    return {
        "fixture_id": fixture_id, "ts": datetime.now(timezone.utc).isoformat(),
        "path": path, "status": status, "upstream_hits": service.count(path) - before,
        "evidence_in_body": bool(token and token in body),
        "evidence_in_headers": bool(token and any(token in v for _, v in actual_headers)),
        "bytes": len(body.encode()), "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    }
