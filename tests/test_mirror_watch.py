"""scripts/mirror_watch.py: SSE parsing, the printed lines, the stream loop and the retry loop."""

from __future__ import annotations

import io
import json
from collections.abc import Iterator
from typing import Any

import pytest

from scripts import mirror_watch
from scripts.mirror_watch import View, open_url, sse_events, watch_once

TRACK = {
    "trackId": "trk_0123456789abcdef", "ip": "203.0.113.9", "userAgent": "probe/1",
    "rule": "R3", "reason": "critical flag: dotenv file", "openedAt": 1_700_000_000_000,
}
ACTION = {
    "eventId": "track.action:r1", "trackId": TRACK["trackId"], "ts": 1_700_000_000_100,
    "method": "GET", "path": "/api/users/1", "query": "x=1", "status": 200, "durationMs": 3,
}
FINDING = {
    "findingId": "fnd_0123456789abcdef", "trackId": TRACK["trackId"], "ts": 1_700_000_000_200,
    "kind": "canary_read", "endpoint": "GET /api/users/{id}", "evidence": {"canary": "c1"},
    "proposal": None, "proposalStatus": "pending",
}


class FakeView(View):
    def __init__(self, pages: dict[str, Any], color: bool = False) -> None:
        super().__init__("http://127.0.0.1:1/", io.StringIO(), color)
        self.pages = pages

    def get(self, path: str) -> dict[str, Any]:
        page: dict[str, Any] = self.pages[path]
        return page

    def text(self) -> str:
        assert isinstance(self.out, io.StringIO)
        return self.out.getvalue()


def detail(actions: list[dict[str, Any]], findings: list[dict[str, Any]]) -> dict[str, Any]:
    return {"track": TRACK, "actions": actions, "findings": findings}


def test_sse_events_groups_lines_and_skips_comments() -> None:
    lines = [": ping\n", "event: ready\n", "data: {}\n", "\n", "id: e-1\n", "event: batch\n",
             "data: {\"a\":\n", "data: 1}\n", "\r\n", "\n"]
    assert list(sse_events(iter(lines))) == [("ready", "{}"), ("batch", '{"a":\n1}')]


def test_track_action_and_finding_print_once() -> None:
    path = f"/v1/tracks/{TRACK['trackId']}"
    view = FakeView({path: detail([ACTION], [FINDING])})
    changes = [{"kind": "track", "track": TRACK}, {"kind": "finding", "finding": FINDING},
               {"kind": "attacker", "attacker": {}}]
    view.apply(changes)
    view.apply(changes)
    out = view.text()
    assert out.count("TRACK") == 1 and "[R3] critical flag: dotenv file" in out
    assert out.count("GET /api/users/1?x=1") == 1 and "3 ms" in out
    assert out.count("FINDING") == 1 and "canary_read on GET /api/users/{id}" in out
    assert "AI fix: pending" in out and '"canary": "c1"' in out


def test_colors_and_status_tones_and_a_written_proposal() -> None:
    path = f"/v1/tracks/{TRACK['trackId']}"
    failed = {**ACTION, "eventId": "track.action:r2", "status": 502, "query": ""}
    missing = {**ACTION, "eventId": "track.action:r3", "status": 404}
    written = {**FINDING, "proposal": {"summary": "Use a bound parameter.", "generatedAt": 1,
                                       "model": "m"}}
    view = FakeView({path: detail([failed, missing], [written])}, color=True)
    view.track(TRACK)
    out = view.text()
    assert "\x1b[31m502\x1b[0m" in out and "\x1b[34m404\x1b[0m" in out
    assert "Use a bound parameter." in out


def test_watch_once_replays_tracks_then_follows_until_reset() -> None:
    path = f"/v1/tracks/{TRACK['trackId']}"
    pages = {"/v1/snapshot?range=5m": {"epoch": "ep", "seq": 7},
             "/v1/tracks?range=1h&limit=50": {"items": [TRACK]}, path: detail([ACTION], [])}
    view = FakeView(pages)
    urls: list[str] = []
    batch = json.dumps({"changes": [{"kind": "finding", "finding": FINDING}]})

    def opener(url: str) -> Iterator[str]:
        urls.append(url)
        yield from ["event: ready\n", "data: {}\n", "\n", "event: batch\n", f"data: {batch}\n",
                    "\n", "event: reset\n", "data: {}\n", "\n", "event: batch\n", "data: x\n", "\n"]

    assert watch_once(view, opener) == "reset"
    assert urls == ["http://127.0.0.1:1/v1/stream?after=ep-7"]
    assert "TRACK" in view.text() and "FINDING" in view.text()


def test_open_url_needs_plain_http() -> None:
    with pytest.raises(OSError, match="http://"):
        open_url("https://example.com/v1/health", timeout=1)


def test_get_and_stream_against_a_closed_port_raise_oserror() -> None:
    view = View("http://127.0.0.1:9/", io.StringIO(), color=False)
    with pytest.raises(OSError):
        view.get("/v1/health")
    with pytest.raises(OSError):
        list(mirror_watch.stream_lines("http://127.0.0.1:9/v1/stream"))


def test_main_retries_after_oserror_and_stops_on_ctrl_c(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_watch(view: View) -> str:
        calls.append(view.base)
        if len(calls) == 1:
            raise OSError("refused")
        raise KeyboardInterrupt

    monkeypatch.setattr(mirror_watch, "watch_once", fake_watch)
    monkeypatch.setattr("scripts.mirror_watch.time.sleep", lambda _: None)
    assert mirror_watch.main(["--sentinel", "http://127.0.0.1:2/", "--no-color"]) == 0
    assert calls == ["http://127.0.0.1:2", "http://127.0.0.1:2"]
