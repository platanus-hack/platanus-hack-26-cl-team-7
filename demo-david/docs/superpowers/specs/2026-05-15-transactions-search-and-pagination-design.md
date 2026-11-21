# Transactions Search, Date Range & Infinite Scroll

## Summary

Overhaul the Transactions page to support full-text search, flexible date range selection, and infinite scroll pagination. All filtering moves server-side so pagination composes correctly with filters.

## Server Changes (`server/routes/transactionRoutes.js`)

Replace `year`/`month` params with the following optional query params on `GET /transactions`:

| Param | Type | Purpose |
|---|---|---|
| `start` | ISO date string | Range start (inclusive) |
| `end` | ISO date string | Range end (inclusive) |
| `q` | string | Case-insensitive LIKE search on `description` |
| `type` | `all`\|`income`\|`expense` | Sign filter (replaces client-side sign filter) |
| `category_id` | id or `"none"` | Envelope filter (`"none"` = uncategorized) |
| `account_id` | id | Account filter |
| `limit` | integer | Page size, default 50 |
| `offset` | integer | Pagination offset, default 0 |

**Response shape** changes from a plain array to:
```json
{ "transactions": [...], "hasMore": true }
```

`hasMore` is determined by fetching `limit + 1` rows — if the extra row exists, `hasMore: true` and only `limit` rows are returned.

**SQL notes:**
- `q` → `AND t.description LIKE '%' || ? || '%'` (case-insensitive via SQLite default collation)
- `type=income` → `AND t.amount > 0`; `type=expense` → `AND t.amount < 0`
- `category_id=none` → `AND t.category_id IS NULL`
- `start`/`end` → `AND t.date >= ?` / `AND t.date <= ?`

## Client Utility (`client/src/utils/datePreset.js`)

Pure function `datePresetToRange(preset, customStart, customEnd, now = new Date())` returns `{ start, end }` (ISO date strings) or `{}` (all_time).

| Preset | `start` | `end` |
|---|---|---|
| `all_time` | — | — |
| `this_month` | First day of current month | Last day of current month |
| `last_month` | First day of previous month | Last day of previous month |
| `last_3_months` | Same day 3 months prior (e.g. May 15 → Feb 15) | Today |
| `last_6_months` | Same day 6 months prior (e.g. May 15 → Nov 15) | Today |
| `this_year` | Jan 1 of current year | Dec 31 of current year |
| `custom` | `customStart` | `customEnd` |

## Client State (`client/src/pages/Transactions.jsx`)

Remove `year`, `month` state. Add:

- `datePreset` — string, default `"all_time"`
- `customStart`, `customEnd` — ISO date strings, used only when preset is `"custom"`
- `query` — string, search text, default `""`
- `transactions` — array, accumulated across pages
- `offset` — integer, current pagination offset, default 0
- `hasMore` — boolean from server response
- `loading` — boolean, true during initial/filter-change fetch
- `loadingMore` — boolean, true during subsequent page fetches

Existing `filterSign`, `filterEnvelope`, `filterAccount` remain but are now sent to the server instead of applied client-side.

**Filter change behavior:** Any change to `datePreset`, `customStart`, `customEnd`, `query`, `filterSign`, `filterEnvelope`, or `filterAccount` resets `transactions → []`, `offset → 0`, and triggers a fresh fetch.

## UI (`client/src/pages/Transactions.jsx`)

Replace the year/month dropdowns with:
- A **preset dropdown**: All Time, This Month, Last Month, Last 3 Months, Last 6 Months, This Year, Custom
- When "Custom" is selected: two `<input type="date">` fields appear inline (From / To)
- A **search input** (`flex-1`) with placeholder "Search transactions…" — debounced 300ms before triggering fetch

Filter row layout (left to right): preset dropdown → [custom date inputs if custom] → search input (flex-1) → type dropdown → envelope dropdown → account dropdown.

## Infinite Scroll

A sentinel `<div ref={sentinelRef}>` sits below `<TransactionList>`. A `useEffect` creates an `IntersectionObserver` that fires when the sentinel enters the viewport. On intersection: if `hasMore && !loading && !loadingMore`, fetch next page (current offset), append to `transactions`, increment `offset`.

The observer is torn down and re-created whenever filters change (which also resets to page 1).

- While `loadingMore`: show "Loading more…" at the sentinel
- When `!hasMore && transactions.length > 0`: show "All transactions loaded"

## Testing

**`client/src/utils/datePreset.test.js`** — unit tests for `datePresetToRange`:
- Each preset returns correct `{start, end}` for a fixed `now`
- `all_time` returns `{}`
- `custom` passes through `customStart`/`customEnd`
- Month boundary edge cases (e.g. last month from January)

**`client/src/__tests__/Transactions.test.jsx`** — component tests:
- Initial load fetches with no date params (all_time default)
- Changing preset triggers refetch with correct params and resets list
- Typing in search input (after debounce) triggers refetch
- Selecting "Custom" reveals date inputs
- `IntersectionObserver` mocked via `vi.fn()` to simulate scroll trigger

## Scope

- `server/routes/transactionRoutes.js` — extend GET endpoint, remove year/month params
- `client/src/utils/datePreset.js` — new utility (pure function)
- `client/src/utils/datePreset.test.js` — new unit tests
- `client/src/pages/Transactions.jsx` — state, fetch logic, UI overhaul
- `client/src/__tests__/Transactions.test.jsx` — new component tests
