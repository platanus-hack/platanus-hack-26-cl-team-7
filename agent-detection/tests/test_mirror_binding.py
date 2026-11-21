"""mirror.binding: which twin-born values may bind. Short ones, long ones and ones the real
database holds never do; nothing does while the real side cannot be asked."""

from __future__ import annotations

import logging
from collections.abc import Sequence

import pytest

from mirror.binding import bindable
from mirror.keys import MIN_TWIN_BORN_LEN, twin_born_key
from mirror.session_copy import MAX_VALUE_CHARS

SESSION, NAME, EMAIL = "twin-session-value-0001", "leo.espinoza68", "leo.espinoza68@yahoo.com"


def test_a_value_the_real_database_holds_is_dropped_and_the_others_keep_their_position() -> None:
    asked: list[list[str]] = []

    def real(values: Sequence[str]) -> frozenset[str]:
        asked.append(list(values))
        return frozenset({NAME})

    values = [SESSION, NAME, EMAIL]
    assert bindable(values, real) == [(0, twin_born_key(SESSION)), (2, twin_born_key(EMAIL))]
    assert asked == [values]


def test_values_too_short_or_too_long_to_check_are_neither_asked_nor_bound() -> None:
    asked: list[list[str]] = []

    def real(values: Sequence[str]) -> frozenset[str]:
        asked.append(list(values))
        return frozenset()

    values = ["x" * (MIN_TWIN_BORN_LEN - 1), "y" * (MAX_VALUE_CHARS + 1), SESSION]
    assert [n for n, _ in bindable(values, real)] == [2] and asked == [[SESSION]]


def test_the_real_side_is_not_asked_when_nothing_can_bind() -> None:
    def real(values: Sequence[str]) -> frozenset[str]:
        raise AssertionError("asked")

    assert bindable([], real) == [] and bindable(["abc"], real) == []


def test_nothing_binds_while_the_real_side_cannot_say(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        assert bindable([SESSION, NAME], lambda values: None) == []
    assert "not bound" in caplog.text
