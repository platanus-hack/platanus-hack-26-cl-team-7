# Spending Trends — Design Spec

**Date:** 2026-05-14

## Overview

A new "Trends" page showing a multi-envelope line chart of monthly spending over time. Users select which envelopes to include and how many months to display. All data is fetched in a single API call.

## Backend

**New endpoint:** `GET /budget/trends`

Query params:
- `months` — integer, default 12, max 36
- `category_ids` — comma-separated category IDs (e.g. `1,2,5`)

Response:
```json
{
  "labels": ["Jun '25", "Jul '25", "Aug '25", ...],
  "series": [
    { "id": 1, "name": "Groceries", "data": [234.50, 287.30, 0, ...] },
    { "id": 2, "name": "Dining",    "data": [120.00, 145.00, 0, ...] }
  ]
}
```

Logic:
1. Parse `category_ids` into an array of integers. If empty or missing, return `{ labels: [], series: [] }`.
2. Generate the last N month labels (same loop as `/category/:id/history`).
3. For each category ID, run the existing per-month spending query and collect `Math.abs(spent)` for each month.
4. Return `{ labels, series }`.

The endpoint uses the same `smartCombineFilter` exclusion logic as the rest of the budget routes (no account filter for now).

## Frontend

**New file:** `client/src/pages/Trends.jsx`

**Layout:**
- Page header: "Trends"
- Controls row: months dropdown (options: 6, 12, 24; default 12) + envelope checkboxes
- Envelope checkboxes: one per category fetched from `GET /categories`. Expense envelopes checked by default, income envelopes unchecked. Laid out as a wrapping row of small checkbox+label pairs.
- `LineChart` from recharts below: one `Line` per selected envelope, using the `PALETTE` array (same 12-colour array used in `SummaryModal.jsx`). `ResponsiveContainer` at 100% width, height 360. Axes, tooltip, and legend included.

**Data flow:**
1. On mount: fetch `GET /categories` to populate the checkbox list. Default-check all expense categories.
2. When `selectedIds` or `months` changes: if `selectedIds` is empty, show an empty state ("Select at least one envelope"). Otherwise fetch `GET /budget/trends?months=N&category_ids=X,Y,Z` and update chart data.
3. Transform response into recharts format:
```js
labels.map((label, i) => ({
  label,
  ...Object.fromEntries(series.map(s => [s.name, s.data[i]]))
}))
```

**Navigation:**
- Add "Trends" link to `client/src/components/Layout.jsx` nav list
- Add `<Route path="/trends" element={<Trends />} />` to `client/src/App.jsx`

## Edge Cases

- `category_ids` empty or missing → backend returns `{ labels: [], series: [] }`, frontend shows empty-state message.
- All envelopes deselected → frontend skips the fetch and shows empty-state message.
- A category has no transactions in a month → `data[i] = 0` (no gap in the line).
