# Account Balance Sync — Design Spec

**Date:** 2026-05-14

## Overview

Derive account current balances from transaction history rather than relying on a static stored value. Users set their balance once by entering their real bank balance; the app back-calculates the starting point and keeps current balance accurate as transactions are imported or added.

## Data Model

No schema change. `accounts.balance` is repurposed as `starting_balance` — the balance before the first tracked transaction. It is an implementation detail; the UI never surfaces the term "starting balance."

```
current_balance = accounts.balance + SUM(transactions.amount WHERE account_id = accounts.id)
```

All account types (checking, savings, credit) use the same formula. Credit cards will show a negative current balance when in debt.

## Backend

### `GET /accounts`

Add a computed `current_balance` field to every returned account row:

```sql
SELECT a.*,
  a.balance + COALESCE(
    (SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id),
    0
  ) AS current_balance
FROM accounts a
```

### `PUT /accounts/:id`

New endpoint. Accepts `{ current_balance: number }`.

Validation (400 on failure):
- `current_balance` must be a finite number

Logic:
```js
const { total } = db.prepare(
  'SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE account_id = ?'
).get(id);
const starting_balance = current_balance - total;
db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(starting_balance, id);
```

Returns the updated account row with `current_balance` included.

### Goals route (`GET /goals`)

Update the `account_balance` field from `a.balance` to the derived formula:

```sql
a.balance + COALESCE(
  (SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id),
  0
) AS account_balance
```

## Frontend

### Settings page — Accounts section

Each account row currently shows a static balance. Changes:
- Display `current_balance` (derived) labeled "Balance"
- Add a "Sync" button per row
- Clicking "Sync" expands an inline input field: "Enter your actual bank balance"
- Save calls `PUT /accounts/:id` with `{ current_balance }`; on success updates the displayed balance and collapses the input
- Cancel collapses without saving
- Show inline error text on failed save

### Dashboard

`displayBalance` computation reads from the accounts array. Switch from `a.balance` to `a.current_balance`.

## Edge Cases

- **No transactions on account:** `SUM` returns NULL → `COALESCE` to 0 → `current_balance = starting_balance`. Correct.
- **New account just created:** `balance = 0`, no transactions → `current_balance = 0`. User should sync immediately after first import.
- **Credit card:** Transactions are negative (spending), so `current_balance` will be negative when in debt. This is consistent with how chequing/savings work (negative = overdrawn or owed).
- **Account with no sync yet:** `balance = 0` (default) → `current_balance` will show the raw transaction sum, which may be wrong. The Settings page should make it clear a sync is needed (e.g. muted "Not synced" label if `balance === 0` and no prior sync).

## Tests (`server/__tests__/accounts.test.js`)

- `GET /accounts` returns `current_balance` as `starting_balance + SUM(transactions)`
- `GET /accounts` returns `current_balance = starting_balance` when account has no transactions
- `PUT /accounts/:id` with `current_balance` updates stored balance correctly
- `PUT /accounts/:id` with non-finite value returns 400
- Goals `GET /goals` returns updated `account_balance` reflecting transactions
