# Envelope Transfer — Design Spec

**Date:** 2026-05-14

## Overview

Allow users to move budget money between envelopes within the same month. Atomically decreases the "from" envelope's `allocated` and increases the "to" envelope's `allocated`. No audit trail — allocations are silently adjusted. Transfers that would make the "from" envelope go negative are blocked.

## Backend

**New endpoint:** `POST /budget/transfer`

Request body:
```json
{ "year": 2026, "month": 5, "fromCategoryId": 1, "toCategoryId": 2, "amount": 50 }
```

Validation (400 on failure):
- `amount` must be > 0
- `fromCategoryId` must not equal `toCategoryId`
- `from` envelope's current `allocated` must be >= `amount`

Logic:
1. Fetch `allocated` for the from envelope row `(year, month, fromCategoryId)`. If not found, return 400.
2. Check `allocated >= amount`. If not, return 400 with `{ error: "Insufficient allocated budget in source envelope" }`.
3. In a single transaction:
   - `UPDATE budget_months SET allocated = allocated - ? WHERE year=? AND month=? AND category_id=?` (from)
   - `UPDATE budget_months SET allocated = allocated + ? WHERE year=? AND month=? AND category_id=?` (to)
4. Return `{ from: { category_id, allocated }, to: { category_id, allocated } }` with the updated rows.

## Frontend

**Trigger:** A "Transfer" button added to the Envelopes page header, alongside the existing Copy, Rollover, and + Category buttons.

**Modal fields:**
- **From** — dropdown of all envelopes for the selected month, each labelled `"{name} (${allocated} available)"`
- **To** — same list, but excludes the currently selected From option
- **Amount** — number input, min 0

**Flow:**
1. User clicks "Transfer" → modal opens with From defaulting to first envelope, To defaulting to second.
2. User fills fields and clicks "Transfer".
3. POST to `/budget/transfer`. On 400, show the error message inline in the modal (do not close).
4. On success, close modal and call `loadData()`.

**State:** `showTransfer` boolean to control modal visibility. No persistent transfer state needed.

## Edge Cases

- **From === To:** blocked by backend (400) and avoided by UI (To dropdown excludes From selection).
- **Amount exceeds allocated:** blocked by backend with a clear error message shown inline.
- **Amount = 0:** blocked by backend (400).
- **Envelope not found:** backend returns 400 if the `budget_months` row doesn't exist for the given category/month.
