"""Caddy v2 JSON access-log lines and labeled pairs for generated (synthetic) sessions."""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from engine.models import Request

HEADERS = {"Accept": ["text/html,*/*;q=0.8"], "Accept-Language": ["en-US,en;q=0.9"]}


def caddy_line(req: Request, host: str = "shop.localhost") -> str:
    uri = f"{req.path}?{req.query}" if req.query else req.path
    request: dict[str, Any] = {
        "remote_ip": req.ip,
        "remote_port": "51034",
        "client_ip": req.ip,
        "proto": "HTTP/2.0",
        "method": req.method,
        "host": host,
        "uri": uri,
        "headers": {"User-Agent": [req.user_agent], **HEADERS},
    }
    entry = {
        "level": "info",
        "ts": req.ts,
        "logger": "http.log.access.log0",
        "msg": "handled request",
        "request": request,
        "bytes_read": 0,
        "user_id": "",
        "duration": 0.0011,
        "size": 0 if req.status == 304 else 2048,
        "status": req.status,
        "resp_headers": {"Server": ["Caddy"]},
    }
    return json.dumps(entry)


def write_pair(
    directory: Path, name: str, sessions: Sequence[Sequence[Request]], notes: str
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    requests = sorted((req for session in sessions for req in session), key=lambda r: r.ts)
    log_path = directory / f"{name}.jsonl"
    log_path.write_text("".join(caddy_line(req) + "\n" for req in requests), encoding="utf-8")
    labels = {
        "source": name,
        "synthetic": True,
        "notes": notes,
        "sessions": {session[0].session_id: "human" for session in sessions if session},
    }
    (directory / f"{name}.labels.json").write_text(json.dumps(labels, indent=2) + "\n")
    return log_path
