"""CSIC 2010 converter: dump parsing, session planning, replay recording and the R3 check."""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from eval.__main__ import main as eval_main
from eval.convert import csic_replay
from eval.convert.csic import (
    CSIC_USER_AGENT,
    CsicRequest,
    assign_splits,
    parse_requests,
    plan_sessions,
    read_dump,
    rewrite_line,
    session_ip,
    write_pair,
)
from eval.convert.csic_replay import TAG_HEADER, Recording, collect, record, send
from eval.csic_r3 import format_r3, r3_report
from eval.dataset import load_split


def _dump(*requests: tuple[str, str, str]) -> str:
    blocks = []
    for method, url, body in requests:
        lines = [f"{method} http://localhost:8080{url} HTTP/1.1", f"User-Agent: {CSIC_USER_AGENT}"]
        lines.append("Host: localhost:8080")
        if body:
            lines += [
                "Content-Type: application/x-www-form-urlencoded",
                f"Content-Length: {len(body)}",
            ]
        blocks.append("\r\n".join([*lines, "", body, ""]))
    return "\r\n".join(blocks)


SAMPLE = _dump(
    ("GET", "/tienda1/index.jsp", ""),
    ("GET", "/tienda1/publico/anadir.jsp?id=2&cantidad=%27%3B+DROP+TABLE+usuarios%3B", ""),
    ("POST", "/tienda1/publico/autenticar.jsp", "login=bob%3Cscript%3Ealert(1)%3C/script%3E"),
    ("PUT", "/tienda1/publico/registro.jsp", "modo=registro&login=armand"),
)


def test_parse_requests_reads_method_target_headers_and_body() -> None:
    requests = parse_requests("garbage line\r\n" + SAMPLE)
    assert [r.method for r in requests] == ["GET", "GET", "POST", "PUT"]
    first, second, post, put = requests
    assert first.target == "/tienda1/index.jsp"
    assert first.body == "" and first.query == ""
    assert second.path == "/tienda1/publico/anadir.jsp"
    assert second.query.startswith("id=2&cantidad=")
    assert post.body.startswith("login=bob") and post.query == ""
    assert post.content_type == "application/x-www-form-urlencoded"
    assert put.body == "modo=registro&login=armand"
    assert all(r.user_agent == CSIC_USER_AGENT for r in requests)


def test_parse_requests_keeps_relative_targets_and_reads_latin1(tmp_path: Path) -> None:
    text = "GET /plain?q=1 HTTP/1.0\nUser-Agent: x\n\n"
    assert parse_requests(text) == [CsicRequest("GET", "/plain?q=1", "x")]
    path = tmp_path / "dump.txt"
    path.write_bytes("GET http://h/a?n=Jam\xf3n HTTP/1.1\r\n\r\n".encode("latin-1"))
    assert read_dump(path)[0].target == "/a?n=Jam\xf3n"


def _many(count: int) -> list[CsicRequest]:
    return [CsicRequest("GET", f"/r{i}", CSIC_USER_AGENT) for i in range(count)]


def test_plan_sessions_picks_consecutive_runs_deterministically() -> None:
    requests = _many(2000)
    sessions = plan_sessions(requests, 20, seed=3)
    assert len(sessions) == 20
    assert sessions == plan_sessions(requests, 20, seed=3)
    starts = []
    for session in sessions:
        assert 10 <= len(session) <= 30
        first = requests.index(session[0])
        assert session == requests[first : first + len(session)]
        starts.append(first)
    assert starts == sorted(starts)


def test_plan_sessions_rejects_bad_sizes_and_too_many_sessions() -> None:
    with pytest.raises(ValueError, match="session sizes"):
        plan_sessions(_many(50), 1, seed=1, sizes=(5, 2))
    with pytest.raises(ValueError, match="only"):
        plan_sessions(_many(50), 10, seed=1)


def test_session_ip_is_distinct_and_private() -> None:
    ips = [session_ip(i) for i in range(600)]
    assert len(set(ips)) == 600
    assert ips[0] == "10.210.0.1" and ips[250] == "10.210.1.1"
    with pytest.raises(ValueError):
        session_ip(-1)
    with pytest.raises(ValueError):
        session_ip(250 * 256)


def test_assign_splits_halves_by_session() -> None:
    splits = assign_splits(61, seed=5)
    assert splits.count("tune") == 30 and splits.count("test") == 31
    assert splits == assign_splits(61, seed=5)


def _caddy(uri: str, headers: dict[str, list[str]]) -> str:
    request = {"remote_ip": "127.0.0.1", "client_ip": "127.0.0.1", "method": "GET", "uri": uri}
    entry = {
        "level": "info",
        "ts": time.time(),
        "logger": "http.log.access.log0",
        "msg": "handled request",
        "request": {**request, "headers": headers},
        "status": 404,
    }
    return json.dumps(entry)


def test_rewrite_line_sets_ip_and_drops_tag() -> None:
    line = _caddy("/x", {"User-Agent": ["ua"], TAG_HEADER: ["t-0"]})
    entry = json.loads(rewrite_line(line, "10.210.0.9", TAG_HEADER))
    assert entry["request"]["client_ip"] == entry["request"]["remote_ip"] == "10.210.0.9"
    assert entry["request"]["headers"] == {"User-Agent": ["ua"]}
    bare = {"request": {"uri": "/"}}
    assert json.loads(rewrite_line(json.dumps(bare), "10.0.0.1", TAG_HEADER))["request"] == {
        "uri": "/",
        "client_ip": "10.0.0.1",
        "remote_ip": "10.0.0.1",
    }


def test_collect_keeps_only_own_tagged_lines(tmp_path: Path) -> None:
    log = tmp_path / "access.log"
    log.write_text("old line\n", encoding="utf-8")
    offset = log.stat().st_size
    lines = [
        _caddy("/a", {TAG_HEADER: ["tok-0"]}),
        _caddy("/b", {TAG_HEADER: ["other-0"]}),
        _caddy("/c", {"User-Agent": ["ua"]}),
        "not json",
        json.dumps(["list"]),
        _caddy("/d", {TAG_HEADER: ["tok-1"]}),
    ]
    log.write_text("old line\n" + "\n".join(lines) + "\n", encoding="utf-8")
    found = collect(log, offset, "tok")
    assert sorted(found) == ["tok-0", "tok-1"]
    assert json.loads(found["tok-1"][0])["request"]["uri"] == "/d"


class _FakeCaddy(BaseHTTPRequestHandler):
    log_file: Path

    def _answer(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        headers = {name: [value] for name, value in self.headers.items()}
        with self.log_file.open("a", encoding="utf-8") as handle:
            handle.write(_caddy(self.path, headers) + "\n")
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = do_POST = do_PUT = _answer

    def log_message(self, format: str, *args: object) -> None:
        return None


@pytest.fixture
def fake_proxy(tmp_path: Path) -> Iterator[tuple[str, Path]]:
    log = tmp_path / "access.log"
    log.write_text("", encoding="utf-8")
    handler = type("Handler", (_FakeCaddy,), {"log_file": log})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"127.0.0.1:{server.server_address[1]}", log
    server.shutdown()
    server.server_close()


def test_send_returns_none_when_proxy_is_down() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeCaddy)
    port = server.server_address[1]
    server.server_close()
    assert send(f"127.0.0.1:{port}", CsicRequest("GET", "/", "ua"), "t-0") is None


def test_record_writes_labeled_tune_and_test_pairs(
    tmp_path: Path, fake_proxy: tuple[str, Path]
) -> None:
    proxy, log = fake_proxy
    sessions = [parse_requests(SAMPLE) for _ in range(4)]
    rec = Recording(proxy, log, tmp_path / "data", delay=0.0, flush_timeout=2.0, token="unit")
    summary = record(sessions, rec, seed=1)
    assert summary == {
        "sent": 16,
        "answered": 16,
        "logged": 16,
        "tune_sessions": 2,
        "test_sessions": 2,
    }
    tune, test = (load_split(tmp_path / "data" / name) for name in ("tune", "test"))
    assert not tune.labels.keys() & test.labels.keys()
    labels = {**tune.labels, **test.labels}
    assert set(labels.values()) == {"probing"}
    assert {key.split("|")[0] for key in labels} == {session_ip(i) for i in range(4)}
    assert all(req.user_agent == CSIC_USER_AGENT for req in tune.requests + test.requests)
    raw = (tmp_path / "data" / "test" / "csic-anomalous.jsonl").read_text(encoding="utf-8")
    assert TAG_HEADER not in raw and '"client_ip":"127.0.0.1"' not in raw
    meta = json.loads((tmp_path / "data" / "test" / "csic-anomalous.labels.json").read_text())
    assert meta["source"] == "csic2010" and meta["synthetic"] is False


def test_replay_main_runs_end_to_end_and_reports_errors(
    tmp_path: Path, fake_proxy: tuple[str, Path], capsys: pytest.CaptureFixture[str]
) -> None:
    proxy, log = fake_proxy
    raw = tmp_path / "raw"
    raw.mkdir()
    big = SAMPLE * 10
    (raw / "anomalousTrafficTest.txt").write_text(big, encoding="latin-1")
    args = [str(raw), "--proxy", proxy, "--log", str(log), "--out", str(tmp_path / "out")]
    assert csic_replay.main([*args, "--sessions", "2", "--delay", "0"]) == 0
    assert json.loads(capsys.readouterr().out)["logged"] >= 20
    assert csic_replay.main([str(tmp_path / "missing")]) == 2
    assert "csic_replay:" in capsys.readouterr().err


def test_write_pair_loads_with_eval_dataset(tmp_path: Path) -> None:
    line = rewrite_line(_caddy("/x", {"User-Agent": ["ua"]}), "10.210.0.1", TAG_HEADER)
    write_pair(tmp_path, "csic-x", [line], {"10.210.0.1|ua": "probing"}, "unit")
    split = load_split(tmp_path)
    assert split.labels == {"10.210.0.1|ua": "probing"}
    assert split.sources == {"10.210.0.1|ua": "csic2010"}


def _raw_dir(tmp_path: Path) -> Path:
    raw = tmp_path / "csic"
    raw.mkdir()
    normal = _dump(("GET", "/tienda1/index.jsp?q=o%27brien+caf%E9", ""), ("POST", "/a", "x=1"))
    (raw / "normalTrafficTraining.txt").write_text(normal, encoding="latin-1")
    (raw / "normalTrafficTest.txt").write_text(normal, encoding="latin-1")
    (raw / "anomalousTrafficTest.txt").write_text(SAMPLE, encoding="latin-1")
    return raw


def test_r3_report_counts_false_flags_and_hits(tmp_path: Path) -> None:
    report = r3_report(_raw_dir(tmp_path))
    assert report["normal"]["requests"] == 4 and report["normal"]["with_query"] == 2
    assert report["normal"]["url"]["false_flags"] == 0
    assert report["normal"]["url_and_body"]["false_flags"] == 0
    attacks = report["anomalous"]
    assert attacks["url"]["hits"] == 1
    assert attacks["url"]["by_signature"] == {"sql stacked query": 1}
    assert attacks["url_and_body"]["hits"] == 2
    assert attacks["url_and_body"]["rate"] == 0.5
    assert attacks["url_and_body"]["examples"][1].startswith("xss script tag: POST")
    text = format_r3(report)
    assert "anomalous url_and_body      2 / 4" in text
    assert "normal    url               0 / 4" in text


def test_csic_r3_cli_prints_report_and_fails_on_missing_files(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert eval_main(["csic-r3", str(_raw_dir(tmp_path))]) == 0
    out = capsys.readouterr().out
    assert out.startswith("R3 critical flag on CSIC 2010")
    assert '"false_flags": 0' in out
    assert eval_main(["csic-r3", str(tmp_path / "nowhere")]) == 2
    assert "not found" in capsys.readouterr().err
