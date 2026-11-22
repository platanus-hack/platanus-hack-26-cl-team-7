"""mirror.markers: one marker per identity, who received it, and the robots.txt line."""

from __future__ import annotations

import re

import pytest

from mirror.markers import CODE_HEX, PREFIX, TTL, Markers, with_marker

ALICE, BOB = "203.0.113.7|scout/1.0", "198.51.100.9|worker/1.0"
SHAPE = re.compile(rf"{re.escape(PREFIX)}[0-9a-f]{{{CODE_HEX}}}/")


class Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


def test_an_identity_keeps_its_marker_and_two_identities_differ() -> None:
    markers = Markers(b"secret")
    first = markers.path_for(ALICE)
    assert SHAPE.fullmatch(first)
    assert markers.path_for(ALICE) == first
    assert markers.path_for(BOB) != first
    assert len(markers) == 2


def test_another_process_gives_other_markers() -> None:
    assert Markers().path_for(ALICE) != Markers().path_for(ALICE)


@pytest.mark.parametrize("tail", ["", "db.sql", "a/b/c.zip"])
def test_a_marker_names_who_received_it_and_how_long_ago(clock: Clock, tail: str) -> None:
    markers = Markers(b"secret", clock=clock)
    path = markers.path_for(ALICE)
    clock.now += 90
    issued = markers.issued(path + tail)
    assert issued is not None
    assert (issued.identity, issued.age) == (ALICE, 90)


def test_the_marker_matches_without_its_trailing_slash(clock: Clock) -> None:
    markers = Markers(b"secret", clock=clock)
    assert markers.issued(markers.path_for(ALICE).rstrip("/")) is not None


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/products/1",
        "/admin-backup-/",
        "/admin-backup-0123456789ab/",  # the right shape, but nobody was given it
        "/admin-backup-0123456789AB/",
        "/admin-backup-0123456789abc/",
        "/x/admin-backup-0123456789ab/",
    ],
)
def test_a_path_nobody_was_given_names_no_one(path: str) -> None:
    markers = Markers(b"secret")
    markers.path_for(ALICE)
    assert markers.issued(path) is None


def test_a_marker_inside_a_longer_path_is_not_a_marker() -> None:
    markers = Markers(b"secret")
    assert markers.issued("/static" + markers.path_for(ALICE)) is None


def test_a_marker_expires_after_the_ttl_and_a_new_read_renews_it(clock: Clock) -> None:
    markers = Markers(b"secret", clock=clock)
    path = markers.path_for(ALICE)
    clock.now += TTL
    assert markers.issued(path) is not None
    clock.now += 1
    assert markers.issued(path) is None
    assert len(markers) == 0
    assert markers.path_for(ALICE) == path
    assert markers.issued(path) is not None


def test_reading_again_keeps_a_marker_alive_but_never_makes_it_look_new(clock: Clock) -> None:
    markers = Markers(b"secret", clock=clock)
    old, kept = markers.path_for(BOB), markers.path_for(ALICE)
    for _ in range(7):  # a crawler that reads its robots.txt every day for a week
        clock.now += TTL - 60
        assert markers.path_for(ALICE) == kept
    clock.now += 60
    assert markers.issued(old) is None
    issued = markers.issued(kept)
    assert issued is not None and issued.age == 7 * (TTL - 60) + 60


def test_a_marker_that_expired_starts_anew_on_the_next_read(clock: Clock) -> None:
    markers = Markers(b"secret", clock=clock)
    path = markers.path_for(ALICE)
    clock.now += TTL + 1
    assert markers.path_for(ALICE) == path
    clock.now += 5
    issued = markers.issued(path)
    assert issued is not None and issued.age == 5


def test_the_ledger_is_bounded_and_drops_the_oldest_first() -> None:
    markers = Markers(b"secret", limit=3)
    paths = [markers.path_for(f"203.0.113.{n}|ua") for n in range(5)]
    assert len(markers) == 3
    assert [markers.issued(path) is not None for path in paths] == [False, False, True, True, True]


@pytest.mark.parametrize(
    ("robots", "expected"),
    [
        (b"", b"User-agent: *\nDisallow: /m/\n"),
        (b"User-agent: *\nAllow: /\n", b"User-agent: *\nAllow: /\nDisallow: /m/\n"),
        (b"User-agent: *\nAllow: /", b"User-agent: *\nAllow: /\nDisallow: /m/\n"),
        (
            b"user-agent:  * \r\nDisallow: /ftp\r\n",
            b"user-agent:  * \r\nDisallow: /ftp\r\nDisallow: /m/\n",
        ),
        (
            b"User-agent: *\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /\n",
            b"User-agent: *\nDisallow: /a\n\nUser-agent: GPTBot\nDisallow: /\n"
            b"\nUser-agent: *\nDisallow: /m/\n",
        ),
        (b"# nothing here\n", b"# nothing here\n\nUser-agent: *\nDisallow: /m/\n"),
    ],
)
def test_the_marker_rule_joins_the_group_for_every_crawler(robots: bytes, expected: bytes) -> None:
    assert with_marker(robots, "/m/") == expected


def test_the_shops_own_bytes_are_kept_as_they_are() -> None:
    odd = b"User-agent: *\nDisallow: /caf\xe9\n"
    assert with_marker(odd, "/m/").startswith(odd)
