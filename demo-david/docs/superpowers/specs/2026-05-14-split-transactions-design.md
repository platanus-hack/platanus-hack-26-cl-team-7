# Split Transactions — Design Spec

**Date:** 2026-05-14

## Overview

Allow a single transaction to be split across multiple envelope categories for budget purposes. The original transaction row is untouched (one line in the transaction list); splits only affect how the budget charges each envelope.

## Backend

### New table

```sql
CREATE TABLE transaction_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  amount REAL NOT NULL
);
```

Added to the schema in `server/db.js` and migrated at startup.

### New endpoint

**`PUT /transactions/:id/splits`**

Replaces all splits for a transaction atomically.

Request body: `[{ category_id, amount }, ...]`

- An empty array clears all splits (returns to single-category mode).
- Validation (400 on failure):
  - Transaction must exist.
  - Each `amount` must be > 0.
  - Sum of amounts must equal the transaction's `amount` within $0.01 tolerance (`Math.abs(sum - Math.abs(tx.amount)) <= 0.01`).
- On success: deletes existing splits, inserts new ones in a single transaction, returns the new split rows.

**`GET /transactions/:id/splits`**

Returns the split rows for a transaction: `[{ id, transaction_id, category_id, amount, category_name }]`. Returns `[]` if no splits exist.

### Budget query changes

All three spending queries — `GET /budget/:year/:month`, `GET /budget/category/:id/history`, and `GET /budget/trends` — must be updated to treat split amounts as the authoritative categorization when splits exist.

Pattern for each query (replace the existing `SUM(t.amount) WHERE t.category_id = ?`):

```sql
SELECT COALESCE(SUM(amount), 0) FROM (
  -- Non-split transactions directly assigned to this category
  SELECT t.amount AS amount
  FROM transactions t
  WHERE t.category_id = ?
    AND NOT EXISTS (SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id)
    AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = printf('%02d', ?)
    <account_filter> <smart_combine_filter>

  UNION ALL

  -- Split portions assigned to this category
  SELECT ts.amount AS amount
  FROM transaction_splits ts
  JOIN transactions t ON t.id = ts.transaction_id
  WHERE ts.category_id = ?
    AND strftime('%Y', t.date) = ? AND strftime('%m', t.date) = printf('%02d', ?)
    <account_filter> <smart_combine_filter>
)
```

The `smartCombineFilter` in the split branch checks `t.account_id` and `ts.category_id` (same logic as the non-split branch).

## Frontend

### TransactionForm.jsx

Loads splits on mount when editing an existing transaction (`GET /transactions/:id/splits`).

**When no splits exist:** normal category dropdown is shown, plus a small **"+ Split"** button beside it.

**When splits are active:** the category dropdown is hidden. Split rows are shown instead — each row contains:
- Category dropdown (same options as the main category field)
- Amount input (positive number, `step="0.01"`)
- Remove button (×)

Below the rows:
- Running total: `$X of $Y allocated` — turns red when the sum does not equal the transaction amount.
- **"Add row"** link to append a new split row.

Removing all rows returns to single-category mode (re-shows the main category dropdown).

**On save:** if splits exist, call `PUT /transactions/:id/splits` after the main `PUT /transactions/:id`. If the split amounts don't sum correctly, show an inline error and block save.

### TransactionList.jsx

For transactions that have splits, display **"Split"** in the category column instead of the category name.

The list query (`GET /transactions`) needs to know which transactions have splits. Add a `has_splits` flag to the list response using a subquery:

```sql
CASE WHEN EXISTS (SELECT 1 FROM transaction_splits WHERE transaction_id = t.id) THEN 1 ELSE 0 END AS has_splits
```

### Split state in the form

```js
const [splits, setSplits] = useState([]);      // [{ category_id, amount }]
const [splitsLoaded, setSplitsLoaded] = useState(false);
```

On mount (edit mode only): fetch `/transactions/:id/splits`, set `splits` from response, set `splitsLoaded = true`.

The "+ Split" button initialises splits with two rows: the first pre-filled with the existing `category_id` and full amount, the second blank.

## Edge Cases

- **Empty split array:** `PUT /transactions/:id/splits` with `[]` deletes all splits. Transaction reverts to single-category via its `category_id`.
- **Amounts don't sum to total:** blocked by backend (400) and by frontend inline validation.
- **Category deleted after split:** `category_id` becomes `null` (ON DELETE SET NULL). Budget treats it as uncategorized for that portion.
- **Import:** imported transactions can be split the same way as manual ones — no special handling needed.
- **Split transaction edited (amount changed):** if a split transaction's total amount changes, existing splits may no longer sum correctly. The edit form should detect this and show a warning prompting the user to re-split.
