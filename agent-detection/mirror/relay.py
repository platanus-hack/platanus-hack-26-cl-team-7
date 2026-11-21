"""The callback relay on 127.0.0.1:8097: the twin's --egress-proxy and its only way out.

The planted server-side fetch sends its proxy request here: an absolute-form GET or HEAD for an
http URL, a CONNECT for https. Per request the relay:

1. takes the grant of the in-flight mirror-lane request that named this host (mirror.egress);
   without one the request is refused;
2. looks the host up within the deadline. That DNS lookup is the callback an out-of-band test
   sees. A CONNECT stops here: tunnels are refused, so an https callback is DNS only;
3. checks every address (mirror.egress.Policy) and sends the one GET or HEAD to the first, with
   the twin's headers. The answer goes back as it came, at most MAX_ANSWER body bytes, with no
   redirect followed, all within RELAY_TIMEOUT;
4. logs the attempt and reports it as a track.action of the granting track (part "egress"),
   before the twin gets the answer, so it comes before the action of the request that asked.

Every refusal and failure answers 502 with no body. The shop shows that as a network it could not
reach, which is how every fetch fails on the real lane: it has no egress at all.
"""

from __future__ import annotations

import http.client
import logging
import socket
import socketserver
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import TYPE_CHECKING, Any

from mirror.contracts import MAX_BODY, MAX_URI, STATUS_RANGE, TrackAction, event_id
from mirror.egress import TUNNEL, Grant, Grants, Policy, Resolve, Target, parse_target, resolve
from mirror.lane import Emit

if TYPE_CHECKING:
    from mirror.cli import Router

RELAY_TIMEOUT = 2.0  # seconds for the lookup, the connection and the whole answer
MAX_ANSWER = 64 * 1024  # what the shop's fetch reads at most
READ_CHUNK = 16 * 1024
EGRESS_PART = "egress"
BAD_GATEWAY = int(HTTPStatus.BAD_GATEWAY)
HOP_BY_HOP = frozenset(
    {"connection", "keep-alive", "proxy-connection", "proxy-authorization", "proxy-authenticate"}
    | {"te", "trailer", "transfer-encoding", "upgrade", "content-length"}
)

log = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Outcome:
    note: str  # what the record and the log say
    status: int = BAD_GATEWAY
    reason: str = HTTPStatus.BAD_GATEWAY.phrase
    headers: tuple[tuple[str, str], ...] = ()
    body: bytes = b""


@dataclass(frozen=True, slots=True)
class Relay:
    grants: Grants
    policy: Policy
    emit: Emit
    resolve: Resolve = resolve
    timeout: float = RELAY_TIMEOUT

    def serve(self, handler: BaseHTTPRequestHandler) -> None:
        started, ts = time.monotonic(), int(time.time() * 1000)
        target = parse_target(handler.command, handler.path)
        grant = None if target is None else self.grants.take(target.host)
        if target is None or grant is None:
            log.warning("relay: refused %s %.200s (no grant)", handler.command, handler.path)
            _answer(handler, Outcome("refused"))
            return
        outcome = self._reach(handler, target, started + self.timeout)
        log.info(
            "relay: %s %s for %s: %s", target.method, target.shown, grant.track_id, outcome.note
        )
        self._record(grant, target, outcome, ts, started)
        _answer(handler, outcome)

    def _reach(self, handler: BaseHTTPRequestHandler, target: Target, deadline: float) -> Outcome:
        try:
            addresses = self.resolve(target.host, target.port, _left(deadline))
        except (OSError, UnicodeError) as err:  # getaddrinfo raises UnicodeError on a bad name
            return Outcome(f"no address for {target.host}: {err}")
        why = self.policy.refuses(target.host, addresses)
        if why:
            return Outcome(f"blocked: {why}")
        if target.method == TUNNEL:
            return Outcome(f"{target.host} is {', '.join(addresses)}; tunnels are refused")
        return _fetch(handler, target, addresses[0], deadline)

    def _record(
        self, grant: Grant, target: Target, outcome: Outcome, ts: int, started: float
    ) -> None:
        answer = outcome.body[:MAX_BODY].decode("utf-8", "replace")
        self.emit(
            TrackAction(
                event_id=event_id("track.action", grant.request_id, EGRESS_PART),
                track_id=grant.track_id,
                ts=ts,
                method=target.method,
                path=target.shown[:MAX_URI],
                query=target.query[:MAX_URI],
                status=outcome.status,
                duration_ms=int((time.monotonic() - started) * 1000),
                request_body="",
                response_body=f"relay: {outcome.note}\n{answer}"[:MAX_BODY],
            )
        )


def _fetch(
    handler: BaseHTTPRequestHandler, target: Target, address: str, deadline: float
) -> Outcome:
    connection = http.client.HTTPConnection(address, target.port, timeout=_left(deadline))
    try:
        connection.putrequest(
            target.method, target.target, skip_host=True, skip_accept_encoding=True
        )
        for name, value in handler.headers.items():
            if name.lower() not in HOP_BY_HOP:
                connection.putheader(name, value)
        connection.endheaders()
        _limit(connection, deadline)
        response = connection.getresponse()
        body = bytearray()
        while len(body) < MAX_ANSWER:
            _limit(connection, deadline)
            chunk = response.read1(min(READ_CHUNK, MAX_ANSWER - len(body)))
            if not chunk:
                break
            body += chunk
    except (OSError, http.client.HTTPException, ValueError) as err:
        return Outcome(f"{address}: {str(err) or type(err).__name__}")
    finally:
        connection.close()
    if response.status not in STATUS_RANGE:  # http.client takes up to 999; no shop answers it
        return Outcome(f"{address}: answered status {response.status}")
    headers = tuple((k, v) for k, v in response.msg.items() if k.lower() not in HOP_BY_HOP)
    note = f"{response.status} from {address}"
    return Outcome(note, response.status, response.reason, headers, bytes(body))


def _limit(connection: http.client.HTTPConnection, deadline: float) -> None:
    left = _left(deadline)
    if left <= 0:
        raise TimeoutError("the answer took longer than the relay allows")
    if connection.sock is not None:
        connection.sock.settimeout(left)


def _left(deadline: float) -> float:
    return deadline - time.monotonic()


def _answer(handler: BaseHTTPRequestHandler, outcome: Outcome) -> None:
    handler.send_response_only(outcome.status, outcome.reason)
    for name, value in outcome.headers:
        handler.send_header(name, value)
    handler.send_header("Content-Length", str(len(outcome.body)))
    handler.send_header("Connection", "close")
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(outcome.body)


def handler_for(relay: Relay) -> type[BaseHTTPRequestHandler]:
    class RelayHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            relay.serve(self)

        do_HEAD = do_CONNECT = do_GET

        def log_message(self, format: str, *args: Any) -> None:
            log.debug(format, *args)

    return RelayHandler


class RelayServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], handler: type[BaseHTTPRequestHandler]) -> None:
        if ":" in address[0]:
            self.address_family = socket.AF_INET6
        super().__init__(address, handler)


def relay_listener(router: Router) -> socketserver.BaseServer:
    config = router.config
    if not config.relay_block_host:
        log.warning("relay: no --relay-block-host; only private addresses count as our own")
    own = Policy.build(config.relay_block_host, config.relay_allow_cidr, resolve, RELAY_TIMEOUT)
    return RelayServer(config.relay, handler_for(Relay(router.grants, own, router.reporter.emit)))
