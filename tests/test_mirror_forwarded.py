"""mirror.forwarded: the request Caddy forwards to /lane, and the keys it carries."""

from __future__ import annotations

import base64
from email.message import Message

import pytest

from mirror import forwarded as f
from mirror.contracts import MAX_KEY_VALUE, TrackKey
from mirror.forwarded import Forwarded
from mirror.keys import twin_born_key

UUID = "5f0c7c1e-3b9a-4d21-9a43-7c2b1e9f0a11"


def headers(**values: str) -> Message[str, str]:
    message: Message[str, str] = Message()
    for name, value in values.items():
        message[name.replace("_", "-")] = value
    return message


def make(**overrides: str) -> Forwarded:
    fields = {"request_id": "r1", "method": "GET", "path": "/", "query": "", "ip": "203.0.113.7"}
    fields |= {"user_agent": "agent/1.0"}
    return Forwarded(**(fields | overrides))


def test_from_headers_reads_every_forwarded_field() -> None:
    fwd = Forwarded.from_headers(
        headers(
            X_Forwarded_Method="POST",
            X_Forwarded_Uri="/login?next=%2Faccount",
            X_Client_Ip="2001:db8::7",
            User_Agent="python-httpx/0.27.0",
            Cookie="session=abc",
            Authorization="Bearer tok",
            X_Request_Id=UUID,
        )
    )
    assert (fwd.method, fwd.path, fwd.query) == ("POST", "/login", "next=%2Faccount")
    assert (fwd.ip, fwd.user_agent, fwd.request_id) == ("2001:db8::7", "python-httpx/0.27.0", UUID)
    assert (fwd.cookie, fwd.authorization) == ("session=abc", "Bearer tok")
    assert fwd.ip_key == TrackKey("ip", "2001:db8::7")
    assert fwd.ip_ua_key == TrackKey("ip_ua", "2001:db8::7|python-httpx/0.27.0")


def test_from_headers_fills_defaults_and_replaces_a_bad_request_id() -> None:
    fwd = Forwarded.from_headers(headers(X_Client_Ip="203.0.113.7", X_Request_Id="a b/c"))
    assert (fwd.method, fwd.path, fwd.query, fwd.user_agent) == ("GET", "/", "", "")
    assert fwd.request_id != "a b/c"
    assert len(fwd.request_id) == 32


@pytest.mark.parametrize("ip", ["", "not-an-ip", "fe80::1%en0"])
def test_a_missing_or_bad_client_ip_is_refused(ip: str) -> None:
    with pytest.raises(ValueError, match="track key"):
        Forwarded.from_headers(headers(X_Client_Ip=ip))


def test_ip_ua_key_is_cut_to_the_contract_limit() -> None:
    assert len(make(user_agent="A" * 5000).ip_ua_key.value) == MAX_KEY_VALUE


def test_twin_born_keys_come_from_cookies_credentials_and_query_values() -> None:
    basic = base64.b64encode(b"mallory.twin:pw").decode()
    fwd = make(
        cookie='session=tok-cookie-1; theme=dark; flag; quoted="tok-quoted-2"',
        authorization=f"Basic {basic}",
        query="token=tok-query-3&page=2&token=tok-query-3",
    )
    expected = ["tok-cookie-1", "tok-quoted-2", basic, "mallory.twin", "tok-query-3"]
    assert fwd.twin_born_keys() == [twin_born_key(raw) for raw in expected]


def test_bearer_and_bare_credentials() -> None:
    assert make(authorization="Bearer tok-bearer-9").twin_born_keys() == [
        twin_born_key("tok-bearer-9")
    ]
    assert make(authorization="tok-bare-value").twin_born_keys() == [
        twin_born_key("tok-bare-value")
    ]
    assert make(authorization="Basic !!!notbase64").twin_born_keys() == [
        twin_born_key("!!!notbase64")
    ]


def test_twin_born_candidates_are_capped() -> None:
    query = "&".join(f"v{n}=value-{n:04d}" for n in range(100))
    assert len(make(query=query).twin_born_keys()) == f.MAX_CANDIDATES
