"""mirror.exchange: what the tap reads from a request (username, form text, named hosts) and from
the twin's answer (the twin-born values that bind to the track)."""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any
from urllib.parse import quote, quote_plus

import pytest

from mirror import exchange
from mirror.exchange import (
    Exchange,
    body_form,
    login_username,
    named_hosts,
    normal_host,
    twin_born_values,
)

FORM = "application/x-www-form-urlencoded"
JSON = "application/json"
TWIN_SESSION = "twin-session-value-0002"  # long and without separators, as a token is


def answer(body: str | bytes = b"", kind: str = "text/html", **fields: Any) -> Exchange:
    raw = body.encode() if isinstance(body, str) else body
    base = Exchange(
        track_id="trk_0123456789abcdef",
        request_id="req-1",
        method="GET",
        path="/account",
        query="",
        content_type="",
        request_body=b"",
        credentials="\n",
        status=200,
        response_type=kind,
        response_body=raw,
        response_size=len(raw),
    )
    return replace(base, **fields)


def test_a_form_body_is_its_own_form_text() -> None:
    assert body_form(FORM, b"username=%27+OR+1%3D1+--&password=x") == (
        "username=%27+OR+1%3D1+--&password=x"
    )


def test_a_json_object_becomes_form_text_the_way_the_shop_reads_it() -> None:
    body = json.dumps({"username": "' OR 1=1 --", "n": 3, "deep": {"a": "b"}}).encode()
    assert body_form(JSON, body) == ("username=%27+OR+1%3D1+--&n=3&deep=%7B%27a%27%3A+%27b%27%7D")


def test_a_json_list_or_broken_json_stays_text() -> None:
    assert body_form(JSON, b"[1, 2]") == "[1, 2]"
    assert body_form(JSON + "; charset=utf-8", b"{broken") == "{broken"
    assert body_form("text/xml", b"<a>' or 1=1</a>") == "<a>' or 1=1</a>"


@pytest.mark.parametrize(
    ("kind", "body", "user"),
    [
        (FORM, b"username=+mara.quint+&password=x", "mara.quint"),
        (FORM, b"password=x", ""),
        ("", b"username=leo.espinoza68", "leo.espinoza68"),
        (JSON, b'{"username": " leo.espinoza68 ", "password": "x"}', "leo.espinoza68"),
        (JSON, b'{"username": 12345678}', ""),
        (JSON, b"username=leo.espinoza68", ""),  # the shop reads a JSON body only as JSON
        ("Application/JSON", b'["username"]', ""),
    ],
)
def test_login_username_reads_the_body_as_the_shop_does(kind: str, body: bytes, user: str) -> None:
    assert login_username(kind, body) == user


def test_named_hosts_come_from_the_query_and_the_body() -> None:
    query = "next=" + quote("http://Callback.Example.:8080/x?y=1", safe="")
    body = (
        "avatar_url=" + quote_plus("https://oast.example/p") + "&x=ftp://files.example/"
    ).encode()
    assert named_hosts(query, body) == ["callback.example", "oast.example"]


def test_named_hosts_read_double_encoding_and_json_slashes() -> None:
    twice = quote(quote("http://twice.example/a", safe=""), safe="")
    body = b'{"avatar_url": "http:\\/\\/json.example\\/a.png"}'
    assert named_hosts(f"u={twice}", body) == ["twice.example", "json.example"]


def test_named_hosts_skip_bad_hosts_and_stop_at_the_cap() -> None:
    assert named_hosts("u=http://[not-v6]/x&v=http:///nohost", b"") == []
    many = "&".join(f"u{n}=http://h{n}.example/" for n in range(exchange.MAX_HOSTS + 4))
    hosts = named_hosts(many, b"")
    assert hosts == [f"h{n}.example" for n in range(exchange.MAX_HOSTS)]
    assert named_hosts("", b"http://[2001:db8::1]:80/") == ["2001:db8::1"]


def test_normal_host_lowercases_and_drops_the_root_dot() -> None:
    assert normal_host(" Shop.Example. ") == "shop.example"


def test_a_token_like_set_cookie_value_is_twin_born_but_a_cart_is_not() -> None:
    cookies = (
        f"session={TWIN_SESSION}; HttpOnly; Path=/; SameSite=Lax",
        "cart=1:2,3:1,4:1,5:2,6:1; Path=/; SameSite=Lax",
        "session=; Max-Age=0; Path=/",
        "pref=short",
    )
    assert twin_born_values(answer(set_cookies=cookies)) == [TWIN_SESSION]


def test_json_identity_fields_and_tokens_are_twin_born_at_any_depth() -> None:
    body = {
        "user": "leo.espinoza68",
        "token": TWIN_SESSION,
        "profile": {"Email": "leo.espinoza68@yahoo.com", "name": "Leo Espinoza"},
        "items": [{"username": "mara.quint"}, "not-a-field"],
        "id": 1,
    }
    found = twin_born_values(answer(json.dumps(body), JSON))
    assert found == ["leo.espinoza68", TWIN_SESSION, "leo.espinoza68@yahoo.com", "mara.quint"]


def test_a_short_or_spaced_json_token_is_not_a_token() -> None:
    body = json.dumps({"token": "abc", "other": {"token": "has spaces in it, not a token"}})
    assert twin_born_values(answer(body, JSON)) == []


def test_emails_in_any_answer_are_twin_born() -> None:
    page = "<dt>Email</dt><dd>vera.soto12@proton.me</dd><p>write to help@freshjuice.cl</p>"
    assert twin_born_values(answer(page)) == ["vera.soto12@proton.me", "help@freshjuice.cl"]


def test_json_deeper_than_the_limit_is_not_read() -> None:
    nested: object = {"username": "deep.user.name"}
    for _ in range(exchange.MAX_JSON_DEPTH + 1):
        nested = {"next": nested}
    assert twin_born_values(answer(json.dumps(nested), JSON)) == []


def test_a_value_the_request_sent_is_not_twin_born() -> None:
    sent = answer(
        json.dumps({"user": "my.own.name", "token": TWIN_SESSION, "email": "x.y@mail.example"}),
        JSON,
        method="POST",
        request_body=b"username=my.own.name&password=x",
        query="email=" + quote_plus("x.y@mail.example"),
        credentials=f"session={TWIN_SESSION}\n",
    )
    assert twin_born_values(sent) == []


def test_twin_born_values_stop_at_the_cap() -> None:
    page = " ".join(f"user{n}@mail.example" for n in range(exchange.MAX_TWIN_BORN + 5))
    found = twin_born_values(answer(page))
    assert found == [f"user{n}@mail.example" for n in range(exchange.MAX_TWIN_BORN)]


def test_the_exchange_exposes_its_body_as_form_text() -> None:
    sent = answer(content_type=JSON, request_body=b'{"q": "1 union select 2"}')
    assert sent.body_form == "q=1+union+select+2"


def test_json_nested_past_the_parser_limit_is_read_as_text() -> None:
    deep = b"[" * 200_000 + b"]" * 200_000
    assert body_form(JSON, deep) == deep.decode()
    assert login_username(JSON, deep) == ""
    assert twin_born_values(answer(deep, JSON)) == []
