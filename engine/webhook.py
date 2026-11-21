"""Posts a verdict to the dashboard webhook as JSON. Never raises on network failure."""

from __future__ import annotations

import http.client
import json
import sys
from urllib.parse import SplitResult, urlsplit

from engine.models import Verdict

_CONNECTIONS: dict[str, type[http.client.HTTPConnection]] = {
    "http": http.client.HTTPConnection,
    "https": http.client.HTTPSConnection,
}


def post_verdict(url: str, verdict: Verdict, timeout: float = 2.0) -> bool:
    """POST the verdict to url. True on a 2xx answer, False (logged to stderr) otherwise."""
    body = json.dumps(verdict.to_dict()).encode("utf-8")
    try:
        status = _post(urlsplit(url), body, timeout)
    except (OSError, http.client.HTTPException, ValueError) as err:
        _log(f"webhook {url} failed: {err!r}")
        return False
    if 200 <= status < 300:
        return True
    _log(f"webhook {url} answered HTTP {status}")
    return False


def _post(target: SplitResult, body: bytes, timeout: float) -> int:
    connection_type = _CONNECTIONS.get(target.scheme)
    if connection_type is None or not target.hostname:
        raise ValueError(f"webhook URL must be http(s)://host/...: {target.geturl()!r}")
    connection = connection_type(target.hostname, target.port, timeout=timeout)
    try:
        connection.request("POST", _path(target), body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def _path(target: SplitResult) -> str:
    path = target.path or "/"
    return f"{path}?{target.query}" if target.query else path


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)
