"""Which values belong to the real shop: the username or email of a real user, or a real session
token. The router asks the sync service (POST /real-values) before it binds a value the twin gave
out to a track, so a real user is never routed to the twin by their own identity. The real file is
only read.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterable
from pathlib import Path

from demo import db

IS_REAL = (
    "SELECT 1 FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)"
    " UNION ALL SELECT 1 FROM sessions WHERE token = ? LIMIT 1"
)


def real_values(real: Path, values: Iterable[str]) -> list[str]:
    """The values, as given, that the real database holds as a username, email or session token
    (a username or email is compared without regard to case)."""
    with contextlib.closing(db.connect(real, db.READ_ONLY)) as conn:
        return [v for v in values if conn.execute(IS_REAL, (v, v, v)).fetchone() is not None]
