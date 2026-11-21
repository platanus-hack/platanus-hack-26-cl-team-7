"""mirror.patches: virtual patch signatures, matching by endpoint and R3 signature, persistence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from engine.routes import RouteTable
from mirror import patches as p
from mirror.patches import ANY_SIGNATURE, Patch, PatchBook, endpoint_of

REPO = Path(__file__).resolve().parent.parent
FINDING = "fnd_00000000000000f1"
SQLI = Patch(FINDING, "GET", "/search", "sql union select", "R3")
IDOR = Patch("fnd_00000000000000f2", "GET", "/api/users/{id}", ANY_SIGNATURE, "R2")


@pytest.fixture
def routes() -> RouteTable:
    return RouteTable.from_yaml(REPO / "config" / "routes.yaml")


@pytest.fixture
def book(tmp_path: Path, routes: RouteTable) -> PatchBook:
    return PatchBook.load(tmp_path / "patches.jsonl", routes)


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"finding_id": "fnd_1"}, "bad patch finding id"),
        ({"method": ""}, "bad patch endpoint"),
        ({"method": "X" * 17}, "bad patch endpoint"),
        ({"endpoint": ""}, "bad patch endpoint"),
        ({"signature": "made up"}, "unknown patch signature"),
        ({"rule": "R9"}, "bad patch rule"),
    ],
)
def test_patch_validates_every_field(changes: dict[str, str], message: str) -> None:
    fields: dict[str, Any] = {"finding_id": FINDING, "method": "GET", "endpoint": "/search"}
    fields |= {"signature": "sql union select", "rule": "R3"}
    with pytest.raises(ValueError, match=message):
        Patch(**(fields | changes))


def test_endpoint_is_the_route_pattern_or_the_raw_path(routes: RouteTable) -> None:
    assert endpoint_of(routes, "GET", "/api/users/42") == "/api/users/{id}"
    assert endpoint_of(routes, "GET", "/backup.zip") == "/backup.zip"


def test_signature_patch_matches_only_its_signature_on_its_endpoint(book: PatchBook) -> None:
    assert book.match("GET", "/search", "q=1+union+select+password") is None
    assert book.add(SQLI) is True
    assert book.match("GET", "/search", "q=1+union+select+password") == SQLI
    assert book.match("GET", "/search", "q=1%20UNION%20SELECT%20x") == SQLI
    assert book.match("GET", "/search", "q=shoes") is None
    assert book.match("GET", "/search", "q=1'+or+'1'='1") is None
    assert book.match("POST", "/search", "q=1+union+select+x") is None
    assert book.match("GET", "/products", "q=1+union+select+x") is None


def test_whole_endpoint_patch_matches_every_request_to_it(book: PatchBook) -> None:
    book.add(IDOR)
    assert book.match("GET", "/api/users/7", "") == IDOR
    assert book.match("GET", "/api/users/99", "fields=email") == IDOR
    assert book.match("GET", "/api/products/7", "") is None


def test_patch_on_a_post_endpoint_matches_its_query_string(book: PatchBook) -> None:
    login = Patch(FINDING, "POST", "/login", "sql comment break", "R3")
    book.add(login)
    assert book.match("POST", "/login", "username=admin%27--&password=x") == login
    assert book.match("POST", "/login", "username=alice&password=x") is None


def test_duplicate_signature_and_full_book_are_refused(
    book: PatchBook, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert book.add(SQLI) is True
    assert book.add(SQLI) is False
    other_finding = Patch("fnd_00000000000000f9", "GET", "/search", "sql union select", "R1")
    assert book.add(other_finding) is False
    assert len(book) == 1
    monkeypatch.setattr(p, "MAX_PATCHES", 2)
    assert book.add(IDOR) is True
    assert book.add(Patch(FINDING, "GET", "/cart", ANY_SIGNATURE, "R3")) is False
    assert len(book) == 2


def test_patches_persist_and_reload(tmp_path: Path, routes: RouteTable) -> None:
    path = tmp_path / "patches.jsonl"
    book = PatchBook.load(path, routes)
    book.add(SQLI)
    book.add(IDOR)
    book.close()
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"finding_id": "nope"}) + "\n")
        handle.write(json.dumps({"unexpected": 1}) + "\n")
        handle.write(json.dumps({**json.loads(path.read_text().splitlines()[0])}) + "\n")
    again = PatchBook.load(path, routes)
    assert len(again) == 2
    assert again.match("GET", "/api/users/3", "") == IDOR
    assert again.match("GET", "/search", "q=1+union+select+x") == SQLI
