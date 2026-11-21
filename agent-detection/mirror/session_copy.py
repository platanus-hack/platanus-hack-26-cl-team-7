"""Copy on flag: when a request opens a track, the router asks the real-side sync service
(demo.sync, on run/sync.sock) to copy that request's session, and its own account, to the twin,
so the trigger request already finds itself signed in there. The twin never connects to the
real side; only sync writes to it.
"""

from __future__ import annotations

import http.client
import json
import logging
from http import HTTPStatus
from pathlib import Path

from mirror.sockets import UnixHTTPConnection

COPY_PATH = "/copy"
COPY_TIMEOUT = 0.5  # a copy takes about 11 ms; the lane answer waits for it

log = logging.getLogger(__name__)


def copy_session(sync_socket: Path, session: str, timeout: float = COPY_TIMEOUT) -> None:
    """POST /copy {"cookie": session}: a Cookie header or a bare session token. A failure is
    logged: the track stays mirrored, the twin just lacks that session."""
    connection = UnixHTTPConnection(sync_socket, timeout)
    body = json.dumps({"cookie": session}).encode()
    try:
        connection.request("POST", COPY_PATH, body, {"Content-Type": "application/json"})
        response = connection.getresponse()
        response.read()
        if response.status >= HTTPStatus.MULTIPLE_CHOICES:
            log.warning("copy on flag: sync answered %d", response.status)
    except (OSError, http.client.HTTPException) as err:
        log.warning("copy on flag failed: %s", err)
    finally:
        connection.close()
