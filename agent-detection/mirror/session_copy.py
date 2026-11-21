"""The router's two questions to the real-side sync service (demo.sync, on run/sync.sock).

Copy on flag: when a request opens a track, the router asks sync to copy that request's session,
and its own account (masked as the nightly mask masks it), to the twin, so the trigger request
already finds itself signed in there.

Real values: before the tap binds a value the twin gave out to a track, it asks sync which of
the values the real database holds as a username, email or session token (mirror.binding).

The twin never connects to the real side; only sync writes to it.
"""

from __future__ import annotations

import http.client
import json
import logging
from collections.abc import Sequence
from http import HTTPStatus
from pathlib import Path

from mirror.sockets import UnixHTTPConnection

COPY_PATH = "/copy"
VALUES_PATH = "/real-values"
COPY_TIMEOUT = 0.5  # a copy takes about 40 ms with 400 users; the lane answer waits for it
VALUES_TIMEOUT = 1.0  # asked after the answer is out, so it delays only the recording
MAX_VALUE_CHARS = 512  # sync refuses a longer value; no username, email or token is that long
JSON_HEADERS = {"Content-Type": "application/json"}

log = logging.getLogger(__name__)


def copy_session(sync_socket: Path, session: str, timeout: float = COPY_TIMEOUT) -> None:
    """POST /copy {"cookie": session}: a Cookie header or a bare session token. A failure is
    logged: the track stays mirrored, the twin just lacks that session."""
    connection = UnixHTTPConnection(sync_socket, timeout)
    body = json.dumps({"cookie": session}).encode()
    try:
        connection.request("POST", COPY_PATH, body, JSON_HEADERS)
        response = connection.getresponse()
        response.read()
        if response.status >= HTTPStatus.MULTIPLE_CHOICES:
            log.warning("copy on flag: sync answered %d", response.status)
    except (OSError, http.client.HTTPException) as err:
        log.warning("copy on flag failed: %s", err)
    finally:
        connection.close()


def real_values(
    sync_socket: Path, values: Sequence[str], timeout: float = VALUES_TIMEOUT
) -> frozenset[str] | None:
    """POST /real-values {"values": values}: the values the real database holds, or None when
    sync cannot say (down, slow or refusing), so the caller treats every value as unchecked."""
    connection = UnixHTTPConnection(sync_socket, timeout)
    body = json.dumps({"values": list(values)}).encode()
    try:
        connection.request("POST", VALUES_PATH, body, JSON_HEADERS)
        response = connection.getresponse()
        data = json.loads(response.read())
    except (OSError, http.client.HTTPException, ValueError) as err:
        log.warning("real values: sync failed: %s", err)
        return None
    finally:
        connection.close()
    found = data.get("real") if isinstance(data, dict) else None
    if response.status != HTTPStatus.OK or not isinstance(found, list):
        log.warning("real values: sync answered %d", response.status)
        return None
    return frozenset(v for v in found if isinstance(v, str))
