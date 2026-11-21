# Auto-Categorization Rules — Design Spec

**Date:** 2026-05-14

## Overview

Allow users to define explicit keyword-based rules that map transaction descriptions to envelope categories. Rules take priority over history-based suggestions during CSV import and manual categorization.

## Data Model

### New table

```sql
CREATE TABLE IF NOT EXISTS categorization_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (date('now'))
);
```

A rule fires when the transaction description contains the keyword (case-insensitive). One account can have multiple rules. `ON DELETE CASCADE` ensures rules are removed if their category is deleted.

## Backend

### New file: `server/routes/rulesRoutes.js`

Mounted at `/api/rules` in `server/index.js`.

#### `GET /rules`

Returns all rules ordered by `created_at DESC`, joined with category name:

```sql
SELECT r.*, c.name AS category_name
FROM categorization_rules r
JOIN categories c ON c.id = r.category_id
ORDER BY r.created_at DESC
```

#### `POST /rules`

Creates a rule. Required fields: `keyword`, `category_id`.

Validation (400 on failure):
- `keyword` must be a non-empty string
- `category_id` must reference an existing category

Returns the created row with `category_name`.

#### `DELETE /rules/:id`

Deletes the rule. Returns `{ ok: true }`. 404 if not found.

### Schema migration

Add `categorization_rules` table to the `SCHEMA` string in `server/db.js`. Uses `CREATE TABLE IF NOT EXISTS` — created automatically on next server start.

### Import route changes (`server/routes/importRoutes.js`)

#### `POST /import/suggest`

Rules are checked before history-based matching. For each description:

1. Load all rules: `SELECT * FROM categorization_rules`
2. Check if any rule's keyword is contained in the description (case-insensitive): `description.toLowerCase().includes(rule.keyword.toLowerCase())`
3. If matched → use that rule's `category_id` (rule wins)
4. If no rule matches → fall back to existing history-based exact/substring matching

#### `POST /import/confirm`

Auto-categorization (when no user assignment provided) checks rules before recurring transactions:

1. Check rules first (same case-insensitive contains logic)
2. If no rule matches → check recurring transactions (existing logic)

## Frontend

### New page: `client/src/pages/Rules.jsx`

Fetches `GET /api/rules` and `GET /api/categories` on mount.

**Layout:**
- Page header: "Categorization Rules"
- Add form at top: keyword text input + category dropdown + "Add Rule" button
- Rule list below: each row shows keyword (monospace/badge style) · category name · Delete button
- Empty state: "No rules yet. Add one above to auto-categorize future imports."

**Add form behavior:**
- Keyword input: plain text, trimmed before save
- Category dropdown: populated from categories (expense + income both shown)
- On save: POST to `/api/rules`, prepend to list, clear form
- Inline error on failed save

**Delete:** calls `DELETE /api/rules/:id`, removes row from local state. No confirmation needed (rules are easy to recreate).

### Import page (`client/src/pages/Import.jsx`)

Add a "Manage rules →" link near the auto-categorization step (step 3, the category assignment UI). Styled as an indigo text link, opens `/rules`.

### Routing

- `client/src/App.jsx`: add `import Rules from './pages/Rules'` and `<Route path="rules" element={<Rules />} />`
- No nav link added

## Edge Cases

- **Duplicate keywords:** Allowed — if two rules match, the first one returned (by `created_at DESC`) wins. Users can delete duplicates.
- **Category deleted:** `ON DELETE CASCADE` removes the rule automatically.
- **Empty keyword:** Rejected with 400.
- **Rule matches but user overrides during import:** User assignment in the import UI always wins over rules (rules only apply when no user assignment exists).

## Tests (`server/__tests__/rules.test.js`)

- `GET /rules` returns empty array initially
- `POST /rules` creates a rule with category_name
- `POST /rules` returns 400 for empty keyword
- `POST /rules` returns 400 for missing category_id
- `DELETE /rules/:id` removes the rule
- `DELETE /rules/:id` returns 404 for unknown id
- All endpoints require auth (401 without cookie)

### Import suggest tests (add to `server/__tests__/import.test.js`)

- Rule match takes priority over history suggestion
- Falls back to history when no rule matches
- Case-insensitive rule matching
