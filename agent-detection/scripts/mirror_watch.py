"""Live terminal view of the mirror lane: tracks, every twin action and every finding.

    uv run python scripts/mirror_watch.py [--sentinel http://127.0.0.1:8787] [--no-color]

Reads Sentinel's SSE stream (GET /v1/stream). A track change fetches GET /v1/tracks/:id and
prints only the actions not printed before. Reconnects after a dropped stream or a reset.
"""

from __future__ import annotations

import argparse
import http.client
import json
import sys
import time
from collections.abc import Callable, Iterator
from datetime import datetime
from typing import Any, TextIO
from urllib.parse import urlsplit

Json = dict[str, Any]
COLORS = {"dim": "2", "red": "31", "green": "32", "yellow": "33", "blue": "34", "bold": "1"}


class View:
    def __init__(self, base: str, out: TextIO, color: bool) -> None:
        self.base = base.rstrip("/")
        self.out = out
        self.color = color
        self.seen_actions: set[str] = set()
        self.seen_tracks: set[str] = set()
        self.seen_findings: set[str] = set()

    def get(self, path: str) -> Json:
        answer, connection = open_url(self.base + path, timeout=5)
        try:
            if answer.status != 200:
                raise OSError(f"GET {path} answered HTTP {answer.status}")
            data: Json = json.load(answer)
            return data
        finally:
            connection.close()

    def paint(self, text: str, tone: str) -> str:
        return f"\x1b[{COLORS[tone]}m{text}\x1b[0m" if self.color else text

    def say(self, ts_ms: int, tag: str, tone: str, text: str) -> None:
        clock = datetime.fromtimestamp(ts_ms / 1000).strftime("%H:%M:%S")
        self.out.write(f"{self.paint(clock, 'dim')} {self.paint(f'{tag:<8}', tone)} {text}\n")
        self.out.flush()

    def track(self, track: Json) -> None:
        tid = track["trackId"]
        if tid not in self.seen_tracks:
            self.seen_tracks.add(tid)
            who = f"{track['ip']}  {track['userAgent'][:60]}"
            rule = f"[{track['rule']}] {track['reason']}"
            self.say(track["openedAt"], "TRACK", "yellow", f"{tid}  {who}  {rule}")
        detail = self.get(f"/v1/tracks/{tid}")
        for action in sorted(detail["actions"], key=lambda a: a["ts"]):
            self.action(action)
        for finding in detail["findings"]:
            self.finding(finding)

    def action(self, action: Json) -> None:
        if action["eventId"] in self.seen_actions:
            return
        self.seen_actions.add(action["eventId"])
        query = f"?{action['query']}" if action["query"] else ""
        status = action["status"]
        tone = "green" if status < 400 else "red" if status >= 500 else "blue"
        request = f"{action['method']} {action['path']}{query}"
        line = f"{action['trackId']}  {self.paint(str(status), tone)}  {request}"
        self.say(action["ts"], "TWIN", "blue", f"{line}  {action['durationMs']} ms")

    def finding(self, finding: Json) -> None:
        if finding["findingId"] in self.seen_findings:
            return
        self.seen_findings.add(finding["findingId"])
        text = f"{finding['kind']} on {finding['endpoint']}  track {finding['trackId']}"
        self.say(finding["ts"], "FINDING", "red", self.paint(text, "bold"))
        self.say(finding["ts"], "", "dim", f"evidence: {json.dumps(finding['evidence'])[:160]}")
        proposal = finding.get("proposal")
        fix = proposal["summary"][:200] if proposal else f"AI fix: {finding['proposalStatus']}"
        self.say(finding["ts"], "FIX", "green", fix)

    def apply(self, changes: list[Json]) -> None:
        for change in changes:
            if change["kind"] == "track":
                self.track(change["track"])
            elif change["kind"] == "finding":
                self.finding(change["finding"])


def sse_events(lines: Iterator[str]) -> Iterator[tuple[str, str]]:
    """(event, data) pairs from SSE lines; comments and ids are skipped."""
    event, data = "message", list[str]()
    for raw in lines:
        line = raw.rstrip("\r\n")
        if not line:
            if data:
                yield event, "\n".join(data)
            event, data = "message", list[str]()
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())


Opened = tuple[http.client.HTTPResponse, http.client.HTTPConnection]


def open_url(url: str, timeout: float) -> Opened:
    """GET an http:// URL. Sentinel listens on plain HTTP on loopback."""
    parts = urlsplit(url)
    if parts.scheme != "http" or not parts.hostname:
        raise OSError(f"need an http:// URL, got {url!r}")
    connection = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout)
    target = parts.path + (f"?{parts.query}" if parts.query else "")
    connection.request("GET", target, headers={"Accept": "application/json, text/event-stream"})
    return connection.getresponse(), connection


def stream_lines(url: str) -> Iterator[str]:
    answer, connection = open_url(url, timeout=60)
    try:
        for raw in answer:
            yield raw.decode("utf-8", "replace")
    finally:
        connection.close()


def watch_once(view: View, opener: Callable[[str], Iterator[str]] = stream_lines) -> str:
    """Replay recent tracks, then follow the stream until it ends. Returns the last event."""
    snap = view.get("/v1/snapshot?range=5m")
    for track in reversed(view.get("/v1/tracks?range=1h&limit=50")["items"]):
        view.track(track)
    last = "end"
    url = f"{view.base}/v1/stream?after={snap['epoch']}-{snap['seq']}"
    for event, data in sse_events(opener(url)):
        last = event
        if event == "batch":
            view.apply(json.loads(data)["changes"])
        elif event == "reset":
            break
    return last


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sentinel", default="http://127.0.0.1:8787")
    parser.add_argument("--no-color", action="store_true")
    args = parser.parse_args(argv)
    view = View(args.sentinel, sys.stdout, color=not args.no_color and sys.stdout.isatty())
    view.say(int(time.time() * 1000), "WATCH", "dim", f"following {view.base} (Ctrl-C to stop)")
    while True:
        try:
            watch_once(view)
        except KeyboardInterrupt:
            return 0
        except OSError as err:
            now = int(time.time() * 1000)
            view.say(now, "WAIT", "dim", f"Sentinel not reachable ({err}); retrying")
            time.sleep(2)


if __name__ == "__main__":
    raise SystemExit(main())
