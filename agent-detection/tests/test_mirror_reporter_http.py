"""mirror.reporter over HTTP: post_batch and to_sentinel against a local ingest stub."""

from __future__ import annotations

import http.client
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from mirror import reporter as r
from mirror.contracts import TrackKey, TrackLinked, event_id, to_wire
from mirror.reporter import SentinelReporter, post_batch

KEY = TrackKey("ip", "203.0.113.7")
LINKED = TrackLinked(event_id("track.linked", "r0"), "trk_0123456789abcdef", 1_763_700_000_000, KEY)


class _Ingest(BaseHTTPRequestHandler):
    seen: list[tuple[str, str | None, list[dict[str, Any]]]] = []
    status = 202

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).seen.append((self.path, self.headers["Authorization"], body))
        self.send_response(type(self).status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        return None


@pytest.fixture
def ingest() -> Iterator[str]:
    _Ingest.seen, _Ingest.status = [], 202
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Ingest)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join()


def test_post_batch_sends_the_bearer_token_and_json(ingest: str) -> None:
    batch = [to_wire(LINKED)]
    assert post_batch(ingest + r.EVENTS_PATH, "tok-1", batch) == 202
    _Ingest.status = 503
    assert post_batch(ingest + r.EVENTS_PATH, "tok-1", batch) == 503
    assert _Ingest.seen[0] == (r.EVENTS_PATH, "Bearer tok-1", batch)


def test_post_batch_refuses_a_non_http_url() -> None:
    with pytest.raises(http.client.InvalidURL):
        post_batch("ftp://127.0.0.1/v1/deception/events", "tok", [])


def test_to_sentinel_posts_to_the_events_path(ingest: str, tmp_path: Path) -> None:
    reporter = SentinelReporter.to_sentinel(ingest + "/", "tok-2", tmp_path / "spool.jsonl")
    reporter.emit(LINKED)
    reporter.close()
    assert [(path, auth) for path, auth, _ in _Ingest.seen] == [(r.EVENTS_PATH, "Bearer tok-2")]
