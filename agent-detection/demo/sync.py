"""`python -m demo.sync --socket run/sync.sock --real run/real.db --twin run/twin.db`

The real-side job that keeps the twin live, one way: it reads the real database and writes the
twin's file; the twin never connects to it.

- Every 5 s it pushes the masked projection of the real rows (demo.replica.Syncer.push).
- POST /copy {"cookie": "<Cookie header or session token>"} copies that real session and its
  own account verbatim to the twin (demo.replica.Syncer.copy), so a flagged agent stays signed
  in there. 200 {"userId", "orders"}; 400 for a bad body; 404 for an unknown session.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any

from demo.mask import DEFAULT_POLICY
from demo.masking import load_policy
from demo.replica import Syncer
from demo.web import JSON
from mirror.sockets import UnixHTTPServer

PUSH_SECONDS = 5.0
MAX_COPY_BODY = 8 * 1024


class SyncServer(UnixHTTPServer):
    def __init__(self, path: Path, syncer: Syncer) -> None:
        super().__init__(path, SyncHandler)
        self.syncer = syncer


class SyncHandler(BaseHTTPRequestHandler):
    def read_json(self) -> object:
        """The JSON body, or None when it is missing, too long or not JSON. The body is read
        before any answer, so the caller can finish sending it."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        raw = self.rfile.read(min(max(length, 0), MAX_COPY_BODY + 1))
        try:
            return json.loads(raw) if 0 < len(raw) <= MAX_COPY_BODY else None
        except ValueError:
            return None

    def do_POST(self) -> None:
        data = self.read_json()
        if self.path != "/copy" or not isinstance(self.server, SyncServer):
            return self.reply(404, {"error": "not found"})
        if not isinstance(data, dict) or not isinstance(data.get("cookie"), str):
            return self.reply(400, {"error": 'expected {"cookie": "<value>"}'})
        try:
            copied = self.server.syncer.copy(data["cookie"])
        except sqlite3.Error as exc:
            return self.reply(503, {"error": f"copy failed: {exc}"})
        if copied is None:
            return self.reply(404, {"error": "unknown session"})
        return self.reply(200, {"userId": copied.user_id, "orders": copied.orders})

    def do_GET(self) -> None:
        self.reply(404, {"error": "not found"})

    def reply(self, status: int, data: dict[str, Any]) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", JSON)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        sys.stdout.write(f"sync {format % args}\n")


def push_forever(syncer: Syncer, stop: threading.Event, every: float = PUSH_SECONDS) -> None:
    """Push now, then every `every` seconds until `stop` is set. A failed push (the twin file
    busy or briefly missing) is reported and retried on the next tick."""
    while True:
        try:
            counts = syncer.push()
            if any(counts.values()):
                print(f"sync push: {counts}", flush=True)
        except (sqlite3.Error, OSError) as exc:
            print(f"sync push failed, retrying in {every} s: {exc}", file=sys.stderr, flush=True)
        if stop.wait(every):
            return


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="demo.sync", description="Keep the twin live.")
    parser.add_argument("--socket", type=Path, required=True)
    parser.add_argument("--real", type=Path, required=True)
    parser.add_argument("--twin", type=Path, required=True)
    parser.add_argument("--allow", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--every", type=float, default=PUSH_SECONDS, help="seconds between pushes")
    args = parser.parse_args(argv)
    syncer, stop = Syncer(args.real, args.twin, load_policy(args.allow)), threading.Event()
    with SyncServer(args.socket, syncer) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"demo sync on unix:{args.socket}, pushing every {args.every} s", flush=True)
        with contextlib.suppress(KeyboardInterrupt):
            push_forever(syncer, stop, args.every)
        server.shutdown()


if __name__ == "__main__":
    main()
