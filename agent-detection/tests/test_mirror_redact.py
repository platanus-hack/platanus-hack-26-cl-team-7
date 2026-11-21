"""mirror.redact: a field whose name looks like a secret keeps its name and loses its value (with
the length as a hint), in form text, JSON and multipart, whatever the Content-Type says. Every
other field, the SQL payload in a username included, stays as it was."""

from __future__ import annotations

import time
from dataclasses import replace

import pytest

from mirror.exchange import Exchange
from mirror.redact import is_secret, redact_body, redact_query, redacted

FORM = "application/x-www-form-urlencoded"
JSON = "application/json"
MULTIPART = "multipart/form-data; boundary=XyZ"


def clean(content_type: str, body: str) -> str:
    return redact_body(content_type, body.encode()).decode()


@pytest.mark.parametrize(
    "name",
    ["password", "PassWord", "pass", "pwd", "secret", "client_secret", "token", "csrf-token"]
    + ["card", "card_number", "cardNumber", "cvv", "CVC", "cc_num", "api_key", "apiKey"]
    + ["new_password", "password[confirm]"],
)
def test_names_that_look_like_a_secret(name: str) -> None:
    assert is_secret(name)


@pytest.mark.parametrize("name", ["username", "email", "name", "avatar_url", "invoice", "id", ""])
def test_ordinary_names_are_not_secrets(name: str) -> None:
    assert not is_secret(name)


def test_a_form_password_keeps_its_name_and_a_length_hint() -> None:
    assert clean(FORM, "username=maria.perez&password=Hunter2-real%21") == (
        "username=maria.perez&password=[redacted 13]"
    )
    # the hint is the typed length, not the encoded one; names are read decoded
    assert clean(FORM, "pass%77ord=a+b&q=1") == "pass%77ord=[redacted 3]&q=1"


def test_every_secret_looking_field_of_a_form_is_redacted_and_the_rest_is_not() -> None:
    body = "username=ana&PASS=abc&pwd=1&Secret=zz&card_number=4111111111111111&cvv=123&token=t"
    assert clean(FORM, body) == (
        "username=ana&PASS=[redacted 3]&pwd=[redacted 1]&Secret=[redacted 2]"
        "&card_number=[redacted 16]&cvv=[redacted 3]&token=[redacted 1]"
    )


def test_the_sql_payload_in_a_username_is_evidence_not_a_secret() -> None:
    body = "username=%27+OR+1%3D1+--&password=x"
    assert clean(FORM, body) == "username=%27+OR+1%3D1+--&password=[redacted 1]"
    sql = '{"username": "\' OR 1=1 --", "password": "x"}'
    assert clean(JSON, sql) == '{"username": "\' OR 1=1 --", "password": "[redacted 1]"}'


def test_a_secret_field_is_redacted_even_when_it_holds_an_attack_payload() -> None:
    assert clean(FORM, "password=%27+OR+1%3D1+--") == "password=[redacted 11]"


def test_json_secrets_at_any_depth_and_of_any_kind() -> None:
    body = (
        '{"username":"a","password":"hunter2","n":{"cvv":123,"card":{"number":"4111","exp":"1"}},'
        '"x":[{"token":"t1"},{"token":true}],"ok":false}'
    )
    assert clean(JSON, body) == (
        '{"username":"a","password":"[redacted 7]","n":{"cvv":"[redacted 3]",'
        '"card":"[redacted 27]"},"x":[{"token":"[redacted 2]"},{"token":"[redacted 4]"}],'
        '"ok":false}'
    )


def test_json_keys_with_escapes_and_a_truncated_body_are_still_read() -> None:
    assert clean(JSON, '{"pa\\u0073sword":"abc"}') == '{"pa\\u0073sword":"[redacted 3]"}'
    assert clean(JSON, '{"username":"a","password":"hunter2-cut') == (
        '{"username":"a","password":"[redacted 11]"'
    )
    assert clean(JSON, '{"token":{"a":[1,2') == '{"token":"[redacted 9]"'
    assert clean(JSON, '{"pass\\x":"abc"}') == '{"pass\\x":"[redacted 3]"}'
    assert clean(JSON, '{"token":}') == '{"token":}'


def test_the_content_type_does_not_decide() -> None:
    assert clean("text/plain", '{"password":"abc"}') == '{"password":"[redacted 3]"}'
    assert clean("", "password=abc") == "password=[redacted 3]"
    assert clean(JSON, "password=abc") == "password=[redacted 3]"
    assert clean("text/html", '<b>x</b><script>{"token":"abc"}</script>') == (
        '<b>x</b><script>{"token":"[redacted 3]"}</script>'
    )


def test_a_page_keeps_its_form_markup() -> None:
    page = '<input name="password" value="x"> a=b&token=y'
    assert clean("text/html; charset=utf-8", page) == page


def test_a_json_value_that_holds_form_text_is_left_alone() -> None:
    body = '{"note": "a password=x here"}'
    assert clean(JSON, body) == body


def part(name: str, content: str, extra: str = "") -> str:
    head = f'Content-Disposition: form-data; name="{name}"{extra}'
    return f"--XyZ\r\n{head}\r\n\r\n{content}\r\n"


def test_multipart_parts_named_like_a_secret_keep_their_headers() -> None:
    body = (
        part("username", "bob")
        + part("password", "hunter2")
        + part("avatar", "xxx", '; filename="password.txt"')
        + part("api_key", "k" * 40)
        + "--XyZ--\r\n"
    )
    assert clean(MULTIPART, body) == (
        part("username", "bob")
        + part("password", "[redacted 7]")
        + part("avatar", "xxx", '; filename="password.txt"')
        + part("api_key", "[redacted 40]")
        + "--XyZ--\r\n"
    )


def test_a_truncated_or_odd_multipart_body_does_not_break_the_redaction() -> None:
    cut = part("password", "hunter2")[:-2]
    assert clean(MULTIPART, cut) == part("password", "[redacted 7]")[:-2]
    assert clean('multipart/form-data; boundary="XyZ"', part("token", "t")) == part(
        "token", "[redacted 1]"
    )
    nothing = part("password", "")
    assert clean(MULTIPART, nothing) == nothing
    assert clean("multipart/form-data", "password=abc") == "password=[redacted 3]"


def test_a_body_without_a_secret_comes_back_as_the_same_bytes() -> None:
    body = b"username=ana&n=1"
    assert redact_body(FORM, body) is body
    assert redact_body(FORM, b"") == b""


def test_bytes_that_are_not_text_do_not_raise() -> None:
    assert redact_body(FORM, b"\xff\xfepassword=abc") == "��password=[redacted 3]".encode()


def test_the_query_is_form_text_too() -> None:
    assert redact_query("id=3&password=abc&next=/a?x=1") == "id=3&password=[redacted 3]&next=/a?x=1"
    assert redact_query("") == ""


def exchange(**fields: object) -> Exchange:
    base = Exchange(
        track_id="trk_0123456789abcdef",
        request_id="req-1",
        method="POST",
        path="/login",
        query="token=abc",
        content_type=FORM,
        request_body=b"username=x&password=hunter2",
        credentials="session=value\n",
        status=200,
        response_type=JSON,
        response_body=b'{"token": "twin-session-value-0001"}',
        response_size=35,
    )
    return replace(base, **fields)


def test_the_redacted_exchange_hides_the_request_secrets_and_keeps_the_answer() -> None:
    ex = exchange()
    shown = redacted(ex)
    assert shown.request_body == b"username=x&password=[redacted 7]"
    assert shown.query == "token=[redacted 3]"
    assert shown.body_form == "username=x&password=[redacted 7]"
    assert (shown.response_body, shown.credentials) == (ex.response_body, ex.credentials)
    assert ex.request_body == b"username=x&password=hunter2"


@pytest.mark.parametrize(
    "payload",
    [b'{"token":{' * 30_000, b'"token":"x",' * 20_000, b"password=a&" * 20_000, b'"a"' * 80_000],
)
def test_hostile_bodies_of_the_largest_size_are_redacted_in_bounded_time(payload: bytes) -> None:
    started = time.monotonic()
    for kind in (FORM, JSON, MULTIPART, "text/html"):
        redact_body(kind, payload)
    assert time.monotonic() - started < 5.0
