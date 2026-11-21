"""HTTP over AF_UNIX sockets. The shops, the router (lane and tap) and sync listen on run/*.sock.

UnixHTTPServer is a threading socketserver for http.server handlers, bound to a socket path:
it removes a stale socket file left by a dead process, refuses a path that a live server owns
or that is not a socket, makes the socket owner-only (0600) before it listens, listens with the
system's longest queue, and removes its own socket file on close. UnixHTTPConnection is
http.client over such a path.
"""

from __future__ import annotations

import contextlib
import http.client
import os
import socket
import socketserver
import stat
from http.server import BaseHTTPRequestHandler
from pathlib import Path

SOCKET_MODE = 0o600
DEFAULT_TIMEOUT = 5.0
# What handlers see as client_address: AF_UNIX peers have no address, but http.server's
# address_string() and log_message() index client_address[0].
LOCAL_PEER = ("local", 0)
# HTTP/1.1 needs a Host header; a Unix socket has no host name of its own.
LOCAL_HOST = "localhost"


class UnixHTTPServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    # A Unix socket refuses a connect once its listen queue is full (TCP would retry), and Caddy
    # opens many at once: socketserver's default queue of 5 turns a burst into refused dials.
    request_queue_size = socket.SOMAXCONN

    def __init__(
        self,
        path: str | os.PathLike[str],
        handler: type[BaseHTTPRequestHandler],
        bind_and_activate: bool = True,
    ) -> None:
        self.socket_path = Path(path)
        self._inode: int | None = None
        super().__init__(str(self.socket_path), handler, bind_and_activate)

    def server_bind(self) -> None:
        _clear_stale(self.socket_path)
        self.socket.bind(str(self.socket_path))
        os.chmod(self.socket_path, SOCKET_MODE)
        self._inode = self.socket_path.stat().st_ino
        self.server_address = str(self.socket_path)

    def get_request(self) -> tuple[socket.socket, tuple[str, int]]:
        conn, _ = self.socket.accept()
        return conn, LOCAL_PEER

    def server_close(self) -> None:
        super().server_close()
        with contextlib.suppress(FileNotFoundError):
            if self._inode is not None and self.socket_path.stat().st_ino == self._inode:
                self.socket_path.unlink()
        self._inode = None


class UnixHTTPConnection(http.client.HTTPConnection):
    """http.client.HTTPConnection that connects to a socket path. Requests carry
    `Host: localhost` unless the caller sends its own Host header."""

    def __init__(self, path: str | os.PathLike[str], timeout: float = DEFAULT_TIMEOUT) -> None:
        super().__init__(LOCAL_HOST, timeout=timeout)
        self.socket_path = Path(path)

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.settimeout(self.timeout)
            sock.connect(str(self.socket_path))
        except OSError:
            sock.close()
            raise
        self.sock = sock


def _clear_stale(path: Path) -> None:
    """Remove a socket file that no process listens on. A live socket or a non-socket file
    stays, and binding fails with FileExistsError instead of taking over someone else's path."""
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(mode):
        raise FileExistsError(f"{path} exists and is not a socket")
    if _is_live(path):
        raise FileExistsError(f"{path} is in use by a running server")
    path.unlink()


def _is_live(path: Path) -> bool:
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.connect(str(path))
    except OSError:
        return False
    finally:
        probe.close()
    return True
