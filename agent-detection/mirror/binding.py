"""Which twin-born values may bind to a track.

A value the twin gave out (a session cookie, a token, a username, an email) binds to the track
that read it and then follows that client from any IP (mirror.keys). A value the real database
holds (a real user's username or email, a real session token) must never bind: that real user
would be routed to the twin by their own identity. The twin should not hold such a value (the
copy on flag masks the account), but a real user may register with a name the twin shows for
someone else, so the tap asks the real side (demo.sync, mirror.session_copy) for every value.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence

from mirror.contracts import TrackKey
from mirror.keys import twin_born_key
from mirror.session_copy import MAX_VALUE_CHARS

RealValues = Callable[[Sequence[str]], "frozenset[str] | None"]  # None: the real side cannot say

log = logging.getLogger(__name__)


def bindable(values: Sequence[str], real_values: RealValues) -> list[tuple[int, TrackKey]]:
    """(position in `values`, key) of each value that may bind: long enough to tell a twin apart,
    short enough to check, and not held by the real database. Nothing binds when the real side
    cannot answer: an unchecked value is never bound."""
    keyed = [
        (n, key)
        for n, value in enumerate(values)
        if len(value) <= MAX_VALUE_CHARS and (key := twin_born_key(value)) is not None
    ]
    if not keyed:
        return []
    real = real_values([values[n] for n, _ in keyed])
    if real is None:
        log.warning("twin-born values not bound: the real side could not check them")
        return []
    return [(n, key) for n, key in keyed if values[n] not in real]
