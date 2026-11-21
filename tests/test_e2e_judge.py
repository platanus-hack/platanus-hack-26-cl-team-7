"""The offline parts of the e2e harness (scripts/e2e_mirror.py): its judgements and parsers. The
harness itself needs the local stack, so it runs by hand, not in CI."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.e2e.context import session_of, user_of
from scripts.e2e.judge import (
    access_entries,
    access_entry,
    comparable,
    differences,
    human_visits,
    leaks,
    percentile,
    stream_lags,
)
from scripts.e2e.wire import Reply, Stream

HTML = b"<html><a href='/static/css/site.css'>$80.97</a> order 18097 rerun/</html>"


def caddy_line(ts: float, ip: str, agent: str, uri: str = "/", **request: object) -> str:
    return json.dumps({
        "logger": "http.log.access.log0", "ts": ts, "status": 200,
        "request": {"remote_ip": ip, "method": "GET", "uri": uri,
                    "headers": {"User-Agent": [agent]}, **request},
    })


def test_comparable_ignores_date_order_and_session_values() -> None:
    real = comparable(200, [("Date", "Mon"), ("Content-Type", "text/html"),
                            ("Set-Cookie", "session=abc; HttpOnly; Path=/")], HTML)
    twin = comparable(200, [("set-cookie", "session=xyz; HttpOnly; Path=/"),
                            ("content-type", "text/html"), ("Date", "Tue")], HTML)
    assert differences(real, twin) == []
    assert ("set-cookie", "session=<value>; HttpOnly; Path=/") in real.headers
    assert all(name != "date" for name, _ in real.headers)


def test_differences_name_status_headers_and_first_body_byte() -> None:
    real = comparable(200, [("Set-Cookie", "cart=1:2; Path=/")], b"abcdef")
    twin = comparable(404, [("Set-Cookie", "cart=9:9; Path=/"), ("X-Extra", "1")], b"abXdef!")
    found = differences(real, twin)
    assert found[0] == "status 200 != 404"
    assert "real-only [('set-cookie', 'cart=1:2; Path=/')]" in found[1]
    assert "('x-extra', '1')" in found[1]
    assert found[2] == "body 6 B != 7 B, first difference at 2"


def test_differences_of_a_longer_body_point_at_its_end() -> None:
    assert differences(comparable(200, [], b"ab"), comparable(200, [], b"abc")) == [
        "body 2 B != 3 B, first difference at 2"
    ]


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("connect: run/twin.sock refused", "socket path"),
        ("see run/real.log", "run folder"),
        ("upstream 127.0.0.1:9000", "loopback address"),
        ("proxy port 8097 down", "relay port"),
        ("Traceback: /Users/x/demo/site.py", "filesystem path"),
        ("open /private/tmp/a", "filesystem path"),
        ("no such file twin-files/a.txt", "data file"),
        ("sqlite real.db locked", "data file"),
    ],
)
def test_leaks_find_each_kind(text: str, kind: str) -> None:
    assert any(found.startswith(f"{kind}:") for found in leaks(text))


def test_leaks_pass_an_ordinary_page() -> None:
    assert leaks(HTML.decode()) == []


def test_percentile_is_nearest_rank() -> None:
    values = [float(n) for n in range(1, 201)]
    assert percentile(values, 50) == 100.0
    assert percentile(values, 95) == 190.0
    assert percentile([3.0], 95) == 3.0
    assert percentile([5.0, 1.0], 100) == 5.0


@pytest.mark.parametrize(("values", "q"), [([], 50), ([1.0], 0), ([1.0], 101)])
def test_percentile_rejects_bad_input(values: list[float], q: float) -> None:
    with pytest.raises(ValueError, match="percentile"):
        percentile(values, q)


def test_stream_lags_wait_for_enough_actions() -> None:
    seen = [(10.5, 1), (11.0, 3), (12.0, 3)]
    lags = stream_lags(seen, [10.0, 10.25, 10.5, 10.75])
    assert lags == [0.5, 0.75, 0.5, None]
    assert stream_lags([(9.0, 1)], [10.0]) == [0.0]


def test_access_entry_reads_the_fields_the_engine_reads() -> None:
    entry = access_entry(caddy_line(1.5, "10.0.0.1", "ua", "/search?q=a", client_ip="10.0.0.9"))
    assert entry is not None
    assert (entry.ts, entry.ip, entry.user_agent, entry.method, entry.uri) == (
        1.5, "10.0.0.9", "ua", "GET", "/search?q=a")
    assert entry.session == "10.0.0.9|ua"


@pytest.mark.parametrize(
    "line",
    [
        "not json",
        "[1, 2]",
        json.dumps({"ts": 1, "status": 200}),
        json.dumps({"ts": True, "status": 200, "request": {"method": "GET", "uri": "/"}}),
        json.dumps({"ts": 1, "request": {"method": "GET", "uri": "/"}}),
        json.dumps({"ts": 1, "status": 200, "request": {"method": "GET"}}),
    ],
)
def test_access_entry_skips_other_lines(line: str) -> None:
    assert access_entry(line) is None


def test_access_entry_without_agent_or_ip() -> None:
    line = json.dumps({"ts": 2, "status": 404, "request": {"method": "HEAD", "uri": "/x"}})
    entry = access_entry(line)
    assert entry is not None
    assert (entry.ip, entry.user_agent) == ("", "")


def test_access_entries_of_a_log() -> None:
    text = "\n".join([caddy_line(1, "a", "u"), "garbage", caddy_line(2, "b", "v")])
    assert [entry.ip for entry in access_entries(text)] == ["a", "b"]


def test_human_visits_start_each_human_session_at_zero(tmp_path: Path) -> None:
    lines = [
        caddy_line(100.0, "198.51.100.1", "Firefox", "/"),
        caddy_line(50.0, "198.51.100.2", "Chrome", "/products"),
        caddy_line(103.5, "198.51.100.1", "Firefox", "/cart"),
        caddy_line(51.0, "203.0.113.9", "curl", "/.env"),
        caddy_line(52.0, "198.51.100.2", "Chrome", "/login"),
    ]
    (tmp_path / "mixed.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    labels = {"198.51.100.1|Firefox": "human", "198.51.100.2|Chrome": "human",
              "203.0.113.9|curl": "probing"}
    (tmp_path / "mixed.labels.json").write_text(json.dumps({"sessions": labels}), "utf-8")
    visits = human_visits(tmp_path)
    assert [(v.offset, v.entry.uri) for v in visits] == [
        (0.0, "/"), (0.0, "/products"), (2.0, "/login"), (3.5, "/cart")]


def reply(status: int = 200, headers: list[tuple[str, str]] | None = None,
          body: bytes = b"") -> Reply:
    return Reply(status, headers or [], body, 1.0)


def test_session_of_takes_the_session_pair_only() -> None:
    answer = reply(303, [("Set-Cookie", "cart=1; Path=/"),
                         ("Set-Cookie", "session=tok123; HttpOnly; Path=/")])
    assert session_of(answer) == "session=tok123"
    assert session_of(reply(303, [("Set-Cookie", "session=; Max-Age=0")])) == ""
    assert answer.header("set-cookie")[0] == "cart=1; Path=/"


def test_user_of_reads_api_session() -> None:
    assert user_of(reply(body=b'{"user": "alice"}')) == "alice"
    assert user_of(reply(body=b'{"user": null}')) is None
    assert user_of(reply(body=b"[1]")) == [1]
    assert user_of(reply(303, body=b"<html>")) == "HTTP 303"


def test_stream_keeps_track_changes_of_batches_only() -> None:
    stream = Stream()
    track = {"trackId": "trk_0123456789abcdef", "actions": 2}
    other = {"trackId": "trk_fedcba9876543210", "actions": 1}
    batch = {"changes": [{"kind": "track", "track": track}, {"kind": "counts"},
                         {"kind": "track", "track": other}]}
    stream._frame("batch", json.dumps(batch))
    stream._frame("ready", json.dumps({"epoch": "x"}))
    stream._frame("batch", "")
    assert [count for _, count in stream.seen("trk_0123456789abcdef")] == [2]
    assert len(stream.tracks) == 2
