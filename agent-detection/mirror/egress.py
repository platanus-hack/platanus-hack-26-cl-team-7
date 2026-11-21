"""What the callback relay lets out of the twin: the target, the grants and the address policy.

The target is what a proxy request asks for: an http URL for GET or HEAD, host:port for CONNECT.
A grant is the one egress the tap allows while it proxies one mirror-lane request: to a host that
request names, for its track. The relay takes the grant on the first attempt to such a host, and
the tap revokes it once the twin has answered, so each attacker request gets at most one egress
and only while it runs. A host passes only when every address it resolves to is public (not
private, loopback, link-local, multicast, reserved or unspecified) and none is one of our own
hosts. Addresses in an allowed network (--relay-allow-cidr, for tests only) count as public; our
own hosts stay blocked.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
import threading
import time
from collections import OrderedDict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from urllib.parse import urlsplit

from mirror.exchange import normal_host

GRANT_TTL = 30.0  # seconds; the tap revokes a grant sooner, when the twin has answered
MAX_GRANTS = 4096  # live grants; the oldest goes first
FETCH_METHODS = frozenset({"GET", "HEAD"})
TUNNEL = "CONNECT"
HTTP_PORT = 80
MAX_PORT = 2**16

Address = ipaddress.IPv4Address | ipaddress.IPv6Address
Network = ipaddress.IPv4Network | ipaddress.IPv6Network
Resolve = Callable[[str, int, float], list[str]]  # host, port, timeout -> addresses

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Grant:
    track_id: str
    request_id: str
    hosts: frozenset[str]
    expires: float  # time.monotonic() seconds


@dataclass(frozen=True, slots=True)
class Target:
    method: str
    host: str
    port: int
    target: str  # the upstream request target: path and query ("" for a tunnel)
    shown: str  # the URL without its query, or host:port for a tunnel
    query: str = ""


def parse_target(method: str, raw: str) -> Target | None:
    """The proxy request's target, or None for one the relay does not take."""
    if method == TUNNEL:
        host, sep, digits = raw.rpartition(":")
        if not sep or not host.strip("[]") or not digits.isdigit():
            return None
        if not 0 < int(digits) < MAX_PORT:
            return None
        return Target(method, normal_host(host.strip("[]")), int(digits), "", raw)
    url = urlsplit(raw)
    try:
        port = url.port or HTTP_PORT
    except ValueError:
        return None
    if method not in FETCH_METHODS or url.scheme.lower() != "http" or not url.hostname:
        return None
    target = (url.path or "/") + (f"?{url.query}" if url.query else "")
    shown = f"http://{url.netloc.rpartition('@')[2]}{url.path or '/'}"
    return Target(method, normal_host(url.hostname), port, target, shown, url.query)


class Grants:
    """Thread-safe: the tap grants and revokes, the relay takes."""

    def __init__(self, ttl: float = GRANT_TTL, max_live: int = MAX_GRANTS) -> None:
        self._ttl, self._max = ttl, max_live
        self._live: OrderedDict[str, Grant] = OrderedDict()  # by request id, oldest first
        self._lock = threading.Lock()

    def grant(self, track_id: str, request_id: str, hosts: Iterable[str]) -> None:
        names = frozenset(normal_host(host) for host in hosts) - {""}
        if not names:
            return
        with self._lock:
            self._live[request_id] = Grant(
                track_id, request_id, names, time.monotonic() + self._ttl
            )
            self._live.move_to_end(request_id)
            while len(self._live) > self._max:
                self._live.popitem(last=False)

    def take(self, host: str) -> Grant | None:
        """The newest live grant that names `host`, removed so it cannot be used again."""
        name = normal_host(host)
        with self._lock:
            now = time.monotonic()
            for grant in reversed(self._live.values()):
                if grant.expires > now and name in grant.hosts:
                    del self._live[grant.request_id]
                    return grant
            expired = [rid for rid, grant in self._live.items() if grant.expires <= now]
            for request_id in expired:
                del self._live[request_id]
        return None

    def revoke(self, request_id: str) -> None:
        with self._lock:
            self._live.pop(request_id, None)

    def __len__(self) -> int:
        return len(self._live)


@dataclass(frozen=True, slots=True)
class Policy:
    own_hosts: frozenset[str]
    own_addresses: frozenset[Address]
    allow: tuple[Network, ...] = ()

    @classmethod
    def build(
        cls, own: Sequence[str], allow: Sequence[Network], resolve: Resolve, timeout: float
    ) -> Policy:
        """Our own hosts are names or addresses; a name's addresses are looked up once, here."""
        names = frozenset(normal_host(host) for host in own) - {""}
        addresses: set[Address] = set()
        for name in names:
            try:
                addresses.update(_address(a) for a in resolve(name, 0, timeout))
            except (OSError, ValueError) as err:
                log.warning(
                    "relay: no address for our own host %s (%s); blocked by name", name, err
                )
        return cls(names, frozenset(addresses), tuple(allow))

    def refuses(self, host: str, addresses: Sequence[str]) -> str:
        """Why this host may not be reached at these addresses; "" when it may."""
        if normal_host(host) in self.own_hosts:
            return f"{host} is our own host"
        if not addresses:
            return f"{host} has no address"
        for text in addresses:
            address = _address(text)
            if address in self.own_addresses:
                return f"{text} is our own address"
            if any(address in network for network in self.allow):
                continue
            if not _public(address):
                return f"{text} is not a public address"
        return ""


def resolve(host: str, port: int, timeout: float) -> list[str]:
    """Every address of `host` (an IP literal is its own), without repeats. The lookup runs on a
    daemon thread, so a slow resolver costs at most `timeout`. Raises OSError on failure."""
    found: list[list[str] | OSError] = []
    done = threading.Event()

    def lookup() -> None:
        try:
            infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            found.append(list(dict.fromkeys(str(info[4][0]) for info in infos)))
        except OSError as err:
            found.append(err)
        finally:
            done.set()

    threading.Thread(target=lookup, name="relay-dns", daemon=True).start()
    if not done.wait(timeout):
        raise TimeoutError(f"no DNS answer for {host} within {timeout}s")
    result = found[0]
    if isinstance(result, OSError):
        raise result
    return result


def _address(text: str) -> Address:
    address = ipaddress.ip_address(text.partition("%")[0])  # drop an IPv6 zone id
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def _public(address: Address) -> bool:
    return address.is_global and not (
        address.is_multicast or address.is_reserved or address.is_unspecified
    )
