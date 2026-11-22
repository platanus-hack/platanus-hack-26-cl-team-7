# Budget Copy — Design Spec

**Date:** 2026-05-14

## Overview

Add a "Copy from [Month]" button to the Envelopes page that overwrites the current month's `allocated` values with those from the previous month. Distinct from rollover (which applies carry-over logic); this is a direct copy with no side effects.

## Backend

**New endpoint:** `POST /budget/copy`

Request body:
```json
{ "fromYear": 2026, "fromMonth": 4, "toYear": 2026, "toMonth": 5 }
```

Logic:
1. Fetch all `budget_months` rows for `(fromYear, fromMonth)`.
2. For each row, run `UPDATE budget_months SET allocated = ? WHERE year = ? AND month = ? AND category_id = ?` against the target month.
3. Return `{ updated: N }` where N is the number of rows changed.

The target month rows must already exist (they are auto-created on first load by `GET /budget/:year/:month`). No inserts are needed.

## Frontend

**Location:** Envelopes page header, alongside the existing "Rollover to next month" button.

**Label:** "Copy from [Month Name]" — month name is derived from the calendar month before the currently selected year/month.

**Flow:**
1. User clicks the button.
2. `window.confirm("Copy allocations from [Month Year]? This will overwrite current values.")` — if cancelled, do nothing.
3. On confirm, call `POST /budget/copy` with the previous month as source and current selection as target.
4. If `updated === 0`, show `alert("Nothing to copy — previous month has no allocations.")`.
5. On success, call `loadData()` to refresh the envelope list.

## Edge Cases

- **Source month has no data:** endpoint returns `{ updated: 0 }`, UI shows the nothing-to-copy alert.
- **Copying to the earliest month in the DB:** no special handling needed — rows exist from auto-creation.
- **fromYear/fromMonth rollback across year boundary:** handled by computing previous month arithmetically (`month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }`).
