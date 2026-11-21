"""PLANTED FLAW 4 (server-side fetch): the account page fetches a picture from any URL it is given.

The fetch only ever goes out through the instance's --egress-proxy (the twin's is the callback
relay, which decides what may leave). It never opens a direct connection: without a proxy every
fetch fails the way an unreachable network does. No proxy bypass list, no environment proxies.
A proxy that refuses a tunnel, drops the connection or answers 502 or 504 (its own "could not
reach it") gives that same failure, so a blocked fetch looks like a dead network on both lanes.
"""

from __future__ import annotations

import http.client
import ssl
from dataclasses import dataclass
from urllib.parse import urlsplit

FETCH_TIMEOUT = 3.0
MAX_FETCH_BYTES = 64 * 1024
USER_AGENT = "FreshJuice-ImageFetcher/1.2"
SCHEMES = {"http": 80, "https": 443}
GATEWAY_FAILURES = frozenset({502, 504})  # a proxy's answers for an upstream it could not reach


@dataclass(frozen=True)
class Fetched:
    status: int
    content_type: str
    body: bytes


class FetchError(Exception):
    """The fetch did not get an HTTP answer. The message is what the shop shows."""


def unreachable(host: str) -> FetchError:
    return FetchError(f"could not connect to {host}")


def fetch(url: str, proxy: str | None) -> Fetched:
    target = urlsplit(url)
    host = target.hostname
    if target.scheme not in SCHEMES or not host:
        raise FetchError("only http and https picture URLs are supported")
    gateway = urlsplit(proxy) if proxy else None
    if gateway is None or not gateway.hostname:
        raise unreachable(host)
    try:
        port = target.port or SCHEMES[target.scheme]
    except ValueError as exc:
        raise FetchError("that URL has a bad port") from exc
    conn = _connection(target.scheme, gateway.hostname, gateway.port, host, port)
    path = target.path or "/"
    path += f"?{target.query}" if target.query else ""
    request_target = url if target.scheme == "http" else path
    headers = {"Host": target.netloc.rpartition("@")[2], "User-Agent": USER_AGENT, "Accept": "*/*"}
    try:
        conn.request("GET", request_target, headers=headers)
        answer = conn.getresponse()
        if answer.status in GATEWAY_FAILURES:
            raise unreachable(host)
        body = answer.read(MAX_FETCH_BYTES)
        return Fetched(answer.status, answer.getheader("Content-Type") or "", body)
    except (OSError, http.client.HTTPException) as exc:
        raise unreachable(host) from exc
    finally:
        conn.close()


def _connection(
    scheme: str, proxy_host: str, proxy_port: int | None, host: str, port: int
) -> http.client.HTTPConnection:
    """http: absolute-form GET to the proxy. https: a CONNECT tunnel through the proxy."""
    if scheme == "http":
        return http.client.HTTPConnection(proxy_host, proxy_port, timeout=FETCH_TIMEOUT)
    context = ssl.create_default_context()
    conn = http.client.HTTPSConnection(
        proxy_host, proxy_port, timeout=FETCH_TIMEOUT, context=context
    )
    conn.set_tunnel(host, port)
    return conn
