# Savings Goals — Design Spec

**Date:** 2026-05-14

## Overview

Allow users to define named savings targets linked to existing accounts. Progress is derived automatically from the account's current balance. A pace estimate is computed from recent transaction history so users can see whether they are on track to hit a target date.

## Data Model

### New table

```sql
CREATE TABLE IF NOT EXISTS savings_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  target_amount REAL NOT NULL,
  target_date TEXT,        -- ISO date string (YYYY-MM-DD), nullable
  completed_at TEXT,       -- ISO date string, set when marked complete, nullable
  created_at TEXT NOT NULL DEFAULT (date('now'))
);
```

One account can have multiple goals. Goals are independent — two goals on the same account both reflect the same account balance but track toward different targets.

## Backend

### New file: `server/routes/goalRoutes.js`

Mounted at `/api/goals` in `server/index.js`.

#### `GET /goals`

Returns all goals ordered by `completed_at IS NOT NULL, created_at DESC` (active first). Each row is enriched with computed fields via SQL:

- `account_name` — from `accounts.name`
- `account_balance` — from `accounts.balance`
- `avg_monthly_net` — average monthly net transaction amount on the linked account over the last 6 complete calendar months. Computed as:

```sql
SELECT COALESCE(
  SUM(t.amount) / 6.0,
  0
) AS avg_monthly_net
FROM transactions t
WHERE t.account_id = g.account_id
  AND t.date >= date('now', '-6 months')
```

- `projected_date` — computed in JavaScript after the query:
  - If `avg_monthly_net <= 0` or goal is already reached: `null`
  - Otherwise: `today + (target_amount - account_balance) / avg_monthly_net` months, formatted as ISO date

Full response shape per goal:

```json
{
  "id": 1,
  "name": "Emergency Fund",
  "account_id": 2,
  "account_name": "TFSA Savings",
  "account_balance": 4200.00,
  "target_amount": 5000.00,
  "target_date": "2026-12-01",
  "completed_at": null,
  "created_at": "2026-01-15",
  "avg_monthly_net": 420.50,
  "projected_date": "2026-11-12"
}
```

#### `POST /goals`

Creates a goal. Required fields: `name`, `target_amount`. Optional: `account_id`, `target_date`.

Validation (400 on failure):
- `name` must be a non-empty string
- `target_amount` must be a finite number > 0

Returns the created row (without computed fields — client can refetch or derive).

#### `PUT /goals/:id`

Updates `name`, `target_amount`, `target_date`, `account_id`. Same validation as POST. Returns the updated row.

#### `PUT /goals/:id/complete`

Toggles completion:
- If `completed_at` is null → set to today's ISO date (`date('now')`)
- If already set → clear it (set to null)

Returns the updated row.

#### `DELETE /goals/:id`

Deletes the goal. Returns `{ ok: true }`.

### Schema migration

Add `savings_goals` table to the `SCHEMA` string in `server/db.js`. Because `db.js` uses `CREATE TABLE IF NOT EXISTS`, the table is created automatically on next server start with no explicit migration step needed.

### Tests: `server/__tests__/goals.test.js`

- POST creates a goal
- GET returns goals with `account_name` and `account_balance`
- GET computes `avg_monthly_net` from transactions (with and without transaction history)
- PUT updates a goal
- PUT /complete marks complete; second call unmarks
- DELETE removes goal
- POST validation: missing name → 400, target_amount ≤ 0 → 400
- All endpoints require auth (401 without cookie)

## Frontend

### New page: `client/src/pages/Goals.jsx`

Fetches `GET /api/goals` on mount and on any mutation.

**Layout:** Full-width list. Active goals first, then a "Completed" section divider, then completed goals in a muted style.

**Add/edit form** (inline at top of page, same pattern as Debt Planner):
- Name (text input)
- Account (dropdown from `GET /api/accounts`)
- Target amount (number input)
- Target date (date input, optional — labelled "Target date (optional)")
- Save / Cancel buttons

**Goal card** (active):
- Header row: goal name (bold) · account name (muted)
- Progress bar: indigo, transitions to green when `account_balance >= target_amount`
- Amount row: `$4,200 / $5,000 · 84%`
- Pace line (shown when `avg_monthly_net > 0`):
  - With target date: `Saving ~$420/mo · on track` (green, when `projected_date <= target_date`) or `Saving ~$420/mo · 4 months behind` (amber, when `projected_date > target_date`; months = round((projected - target) / 30))
  - Without target date: `Saving ~$420/mo · projected Nov 2026`
  - If `avg_monthly_net <= 0`: `No recent savings activity` (muted)
- Actions: "Edit" (pencil icon or link), "Mark complete" button, "Delete" (trash icon)

**Goal card** (completed):
- Same layout but muted (`opacity-60`)
- Shows `Completed [date]` badge in green
- "Unmark" button instead of "Mark complete"
- Still shows progress bar (may be over 100% — cap bar at 100%, show actual percentage)

**Error handling:** Show inline error text on failed saves. No full-page error state.

### Dashboard widget — `client/src/pages/Dashboard.jsx`

Added as a new card section (same styling as the Debt widget). Shows active goals only, capped at 5. Each row:

```
Emergency Fund  [====-------]  84%
Vacation Fund   [===========]  ✓
New Car         [===--------]  31%
```

Name on the left, slim indigo/green progress bar in the middle, percentage (or ✓) on the right. "View all →" link to `/goals` at the bottom if there are goals.

If no active goals exist (none at all, or all completed), the widget is hidden entirely (not shown as empty state).

### Routing and navigation

- `client/src/components/Layout.jsx`: add `{ to: '/goals', label: 'Goals' }` after Trends
- `client/src/App.jsx`: add `import Goals from './pages/Goals'` and `<Route path="goals" element={<Goals />} />`

## Edge Cases

- **Account deleted:** `ON DELETE CASCADE` removes the goal. No orphan goals.
- **No transactions on linked account:** `avg_monthly_net = 0`, pace line shows "No recent savings activity".
- **Balance already exceeds target:** Progress bar shows 100% (capped), card shows "Target reached — mark as complete?" prompt above actions.
- **No account linked:** Goal can still be created with `account_id = null`; balance and pace fields show `—`.
- **Progress over 100%:** Cap bar width at 100%, show actual percentage as text (e.g., `$6,200 / $5,000 · 124%`).
