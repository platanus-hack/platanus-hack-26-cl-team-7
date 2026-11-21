"""mirror.egress: proxy targets, the one-egress-per-request grants and the public-address policy."""

from __future__ import annotations

import ipaddress
import socket
import threading
import time
from typing import Any

import pytest

from mirror.egress import Grants, Policy, Target, parse_target, resolve

TRACK, OTHER = "trk_0123456789abcdef", "trk_fedcba9876543210"
LOOPBACK = ipaddress.ip_network("127.0.0.0/8")


@pytest.mark.parametrize(
    ("method", "raw", "target"),
    [
        (
            "GET",
            "http://User:pw@Callback.Example.:8080/a/b?c=1",
            Target(
                "GET",
                "callback.example",
                8080,
                "/a/b?c=1",
                "http://Callback.Example.:8080/a/b",
                "c=1",
            ),
        ),
        (
            "HEAD",
            "http://198.51.100.4",
            Target("HEAD", "198.51.100.4", 80, "/", "http://198.51.100.4/"),
        ),
        (
            "CONNECT",
            "oast.example:443",
            Target("CONNECT", "oast.example", 443, "", "oast.example:443"),
        ),
        (
            "CONNECT",
            "[2001:db8::5]:8443",
            Target("CONNECT", "2001:db8::5", 8443, "", "[2001:db8::5]:8443"),
        ),
    ],
)
def test_parse_target_reads_absolute_urls_and_tunnels(
    method: str, raw: str, target: Target
) -> None:
    assert parse_target(method, raw) == target


@pytest.mark.parametrize(
    ("method", "raw"),
    [
        ("GET", "/origin-form"),
        ("GET", "https://tls.example/"),
        ("POST", "http://callback.example/"),
        ("GET", "http://callback.example:99999/"),
        ("GET", "http:///no-host"),
        ("CONNECT", "oast.example"),
        ("CONNECT", "oast.example:0"),
        ("CONNECT", "oast.example:65536"),
        ("CONNECT", ":443"),
        ("CONNECT", "oast.example:https"),
    ],
)
def test_parse_target_refuses_what_the_relay_does_not_take(method: str, raw: str) -> None:
    assert parse_target(method, raw) is None


def test_a_grant_is_taken_once_by_a_host_it_names() -> None:
    grants = Grants()
    grants.grant(TRACK, "req-1", ["Callback.Example.", "second.example"])
    assert grants.take("other.example") is None
    taken = grants.take("callback.example")
    assert taken is not None and (taken.track_id, taken.request_id) == (TRACK, "req-1")
    assert grants.take("second.example") is None  # one egress per request, whatever the host
    assert len(grants) == 0


def test_the_newest_live_grant_wins_and_revoke_drops_one() -> None:
    grants = Grants()
    grants.grant(TRACK, "req-1", ["cb.example"])
    grants.grant(OTHER, "req-2", ["cb.example"])
    taken = grants.take("cb.example")
    assert taken is not None and taken.track_id == OTHER
    grants.revoke("req-1")
    grants.revoke("req-unknown")
    assert grants.take("cb.example") is None


def test_a_grant_without_hosts_is_not_kept() -> None:
    grants = Grants()
    grants.grant(TRACK, "req-1", ["", " . "])
    assert len(grants) == 0


def test_an_expired_grant_is_dropped() -> None:
    grants = Grants(ttl=0.0)
    grants.grant(TRACK, "req-1", ["cb.example"])
    assert grants.take("cb.example") is None
    assert len(grants) == 0


def test_the_oldest_grant_goes_when_the_table_is_full() -> None:
    grants = Grants(max_live=2)
    for n in range(3):
        grants.grant(TRACK, f"req-{n}", [f"h{n}.example"])
    assert len(grants) == 2
    assert grants.take("h0.example") is None
    assert grants.take("h2.example") is not None


def test_grants_are_safe_from_many_threads() -> None:
    grants = Grants()
    for n in range(50):
        grants.grant(TRACK, f"req-{n}", ["cb.example"])
    taken: list[str] = []
    barrier = threading.Barrier(10)

    def take() -> None:
        barrier.wait()
        for _ in range(10):
            grant = grants.take("cb.example")
            if grant is not None:
                taken.append(grant.request_id)

    pool = [threading.Thread(target=take) for _ in range(10)]
    for thread in pool:
        thread.start()
    for thread in pool:
        thread.join()
    assert sorted(taken) == sorted(f"req-{n}" for n in range(50))


@pytest.mark.parametrize(
    ("address", "why"),
    [
        ("10.1.2.3", "not a public address"),
        ("192.168.1.10", "not a public address"),
        ("172.16.0.1", "not a public address"),
        ("100.64.0.1", "not a public address"),
        ("127.0.0.1", "not a public address"),
        ("169.254.169.254", "not a public address"),
        ("0.0.0.0", "not a public address"),
        ("224.0.1.1", "not a public address"),
        ("240.0.0.1", "not a public address"),
        ("::1", "not a public address"),
        ("fe80::1%en0", "not a public address"),
        ("fc00::1", "not a public address"),
        ("ff02::1", "not a public address"),
        ("::ffff:127.0.0.1", "not a public address"),
        ("203.0.113.9", "our own address"),
    ],
)
def test_the_policy_blocks_every_address_that_is_not_public(address: str, why: str) -> None:
    policy = Policy(frozenset(), frozenset({ipaddress.ip_address("203.0.113.9")}))
    assert why in policy.refuses("target.example", [address])


def test_one_private_address_blocks_a_host_with_public_ones() -> None:
    policy = Policy(frozenset(), frozenset())
    assert policy.refuses("rebind.example", ["93.184.216.34", "2606:2800:220:1::1"]) == ""
    assert "127.0.0.1" in policy.refuses("rebind.example", ["93.184.216.34", "127.0.0.1"])
    assert "no address" in policy.refuses("empty.example", [])


def test_an_allowed_network_counts_as_public_but_our_own_hosts_stay_blocked() -> None:
    own = frozenset({ipaddress.ip_address("127.0.0.9")})
    policy = Policy(frozenset({"shop.example"}), own, (LOOPBACK,))
    assert policy.refuses("localhost", ["127.0.0.1"]) == ""
    assert "our own address" in policy.refuses("x.example", ["127.0.0.9"])
    assert "our own host" in policy.refuses("Shop.Example.", ["93.184.216.34"])
    assert "not a public address" in policy.refuses("x.example", ["10.0.0.1"])


def test_build_looks_our_own_hosts_up_once_and_keeps_a_name_it_cannot_look_up() -> None:
    def lookup(host: str, port: int, timeout: float) -> list[str]:
        if host == "gone.example":
            raise OSError("no such host")
        return {"shop.example": ["198.51.100.7", "::ffff:198.51.100.8"]}.get(host, [host])

    policy = Policy.build(
        ["Shop.Example", "gone.example", "203.0.113.4", ""], [LOOPBACK], lookup, 1.0
    )
    assert policy.own_hosts == {"shop.example", "gone.example", "203.0.113.4"}
    assert policy.own_addresses == {
        ipaddress.ip_address(a) for a in ("198.51.100.7", "198.51.100.8", "203.0.113.4")
    }
    assert policy.allow == (LOOPBACK,)


def test_resolve_gives_each_address_once() -> None:
    assert resolve("127.0.0.1", 80, 2.0) == ["127.0.0.1"]
    infos: list[Any] = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.51.100.1", 80)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("198.51.100.1", 80)),
        (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:db8::1", 80, 0, 0)),
    ]
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(socket, "getaddrinfo", lambda *_args, **_kw: infos)
        assert resolve("cb.example", 80, 2.0) == ["198.51.100.1", "2001:db8::1"]


def test_resolve_raises_a_lookup_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_args: object, **_kw: object) -> list[Any]:
        raise socket.gaierror(socket.EAI_NONAME, "unknown host")

    monkeypatch.setattr(socket, "getaddrinfo", fail)
    with pytest.raises(socket.gaierror):
        resolve("nowhere.example", 80, 2.0)


def test_resolve_gives_up_after_the_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    release = threading.Event()

    def slow(*_args: object, **_kw: object) -> list[Any]:
        release.wait(5.0)
        return []

    monkeypatch.setattr(socket, "getaddrinfo", slow)
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        resolve("slow.example", 80, 0.1)
    release.set()
    assert time.monotonic() - started < 1.0
