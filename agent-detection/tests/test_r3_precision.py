"""R3 precision on shopper searches, linear-time matching, and lenient-server path variants."""

from __future__ import annotations

import time

import pytest

from engine.rules.r3_flags import flag, normalize_path
from engine.signatures import PAYLOAD_PATTERNS, match_payload

SHOPPER_SEARCHES = [
    "q=sleep+(eye+mask)",
    "q=sleep%20(eye%20mask)",
    "q=benchmark+(2024)",
    "q=sleep+(8+hours)+pillow",
    "q=sort|id",
    "q=toys+|+cat+bed",
    "q=dog;cat+toys",
    "q=%3Csvg+icons",
    "q=%3Cobject+storage",
    "q=6%27+--+tall",
    "q=5%27+--+6%27+range",
    "q=best+seller%27+%231",
]

STILL_ATTACKS = [
    ("q=1+AND+SLEEP(5)", "sql time delay"),
    ("q=1%27+AND+sleep(2.5)--", "sql time delay"),
    ("q=1+and+pg_sleep(5)", "sql time delay"),
    ("q=benchmark(5000000,md5(1))", "sql time delay"),
    ("q=1%3Bwaitfor+delay+%270%3A0%3A5%27", "sql time delay"),
    ("host=127.0.0.1|id", "command injection"),
    ("host=127.0.0.1+||+whoami", "command injection"),
    ("host=;id", "command injection"),
    ("host=%27;uname+-a", "command injection"),
    ("q=%3Csvg%3E", "xss dangerous tag"),
    ("q=%3Ciframe+src%3Dhttp://a.example%3E", "xss dangerous tag"),
    ("id=1%27--", "sql comment break"),
    ("user=admin%27--+-", "sql comment break"),
    ("user=admin%27%23&pwd=x", "sql comment break"),
    ("url=%0d%0a%20Set-Cookie%20:%20a=b", "crlf header injection"),
    ("q=%3C%20/%20script%3E", "xss script tag"),
    ("q=union/**/select+1", "sql union select"),
    ("q=%7B%7Bconfig.__class__%7D%7D", "template object access"),
    ("url=javascript:alert(1)", "xss javascript url"),
    ("q=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E", "xss event handler"),
]


@pytest.mark.parametrize("query", SHOPPER_SEARCHES)
def test_shopper_search_is_not_a_critical_flag(query: str) -> None:
    assert flag("/search", query) is None


@pytest.mark.parametrize(("query", "family"), STILL_ATTACKS)
def test_tightened_families_still_catch_attacks(query: str, family: str) -> None:
    assert flag("/search", query) == family


ADVERSARIAL = {
    "newlines": "\n" * 1500 + "x",
    "crlf pairs": "\r\n" * 1500,
    "open tags": "<a " * 15_000,
    "open braces": "{{" * 30_000,
    "spaced tag": "<" + " " * 60_000 + "x",
    "javascript urls": "javascript:" * 10_000,
    "open comments": "union/*" * 10_000,
}
BUDGET_SECONDS = 0.25


@pytest.mark.parametrize("name", sorted(ADVERSARIAL))
def test_payload_matching_is_linear_on_hostile_input(name: str) -> None:
    text = ADVERSARIAL[name]
    started = time.perf_counter()
    assert match_payload(text) is None
    assert time.perf_counter() - started < BUDGET_SECONDS


def test_encoded_newline_flood_in_a_query_is_fast() -> None:
    started = time.perf_counter()
    assert flag("/search", "q=" + "%0a" * 4000 + "x") is None
    assert time.perf_counter() - started < BUDGET_SECONDS


def test_every_payload_pattern_is_fast_on_each_hostile_input() -> None:
    for text in ADVERSARIAL.values():
        for name, pattern in PAYLOAD_PATTERNS:
            started = time.perf_counter()
            pattern.search(text)
            assert time.perf_counter() - started < BUDGET_SECONDS, name


SERVED_VARIANTS = [
    ("/.aws/credentials/", "aws credentials"),
    ("/.aws//credentials", "aws credentials"),
    ("/.aws/./credentials", "aws credentials"),
    ("/phpinfo.php/", "php info page"),
    ("/server-status/", "server status"),
    ("/.htpasswd/", "apache access file"),
    ("/web.config/", "iis web config"),
    ("/.DS_Store/", "macos metadata"),
    ("/.git;/config", "git metadata"),
    ("/.env;x", "dotenv file"),
    ("/actuator/env;x", "spring actuator"),
    ("/actuator/env/", "spring actuator"),
    ("//actuator//heapdump", "spring actuator"),
]


@pytest.mark.parametrize(("path", "family"), SERVED_VARIANTS)
def test_path_variants_that_servers_resolve_are_flagged(path: str, family: str) -> None:
    assert flag(path, "") == family


@pytest.mark.parametrize(
    "path", ["/products/12;jsessionid=abc", "/static/app.js/", "/search/", "/a/./b", "//"]
)
def test_normalized_ordinary_paths_stay_quiet(path: str) -> None:
    assert flag(path, "") is None


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/", "/"),
        ("//a///b/", "/a/b"),
        ("/a/./b/.", "/a/b"),
        ("/a;x/b;y=1", "/a/b"),
        ("/a/../b", "/a/../b"),
    ],
)
def test_normalize_path(path: str, expected: str) -> None:
    assert normalize_path(path) == expected
