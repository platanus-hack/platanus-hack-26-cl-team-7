"""The rows of one account in a projection: its user row, its orders, and their items and history.

Copy on flag takes these from the masked projection (demo.masking), never from the real
database, so what reaches the twin is what the nightly mask would write for the same account.
"""

from __future__ import annotations

from demo.masking import Projection, Row

Tables = dict[str, dict[int, Row]]


def own_rows(projection: Projection, user_id: int) -> Tables:
    """Per table the projection lists, the rows of this account. `users` is empty when the
    projection has no such user. Only tables the policy lists appear."""
    own: Tables = {}
    if "users" in projection.tables:
        user = projection.tables["users"].get(user_id)
        own["users"] = {} if user is None else {user_id: user}
    if "orders" in projection.tables:
        own["orders"] = _matching(projection, "orders", "user_id", {user_id})
    orders: set[object] = set(own.get("orders", {}))
    for table in ("order_items", "order_events"):
        if table in projection.tables:
            own[table] = _matching(projection, table, "order_id", orders)
    return own


def _matching(
    projection: Projection, table: str, column: str, wanted: set[object]
) -> dict[int, Row]:
    """The rows of `table` whose `column` holds one of `wanted`."""
    index = projection.columns[table].index(column)
    return {i: row for i, row in projection.tables[table].items() if row[index] in wanted}
