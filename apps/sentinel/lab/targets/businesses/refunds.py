"""Read-only refund records for the fictional bank. No payments are executed."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Refund:
    requested_version: int
    approved_version: int | None

    def receipt(self):
        return {
            "requestedVersion": self.requested_version,
            "approvedVersion": self.approved_version,
            "eligible": self.approved_version == self.requested_version,
        }


REFUNDS = {
    "stale-approval": Refund(2, 1),
    "missing-approval": Refund(2, None),
    "reapproved": Refund(2, 2),
}
