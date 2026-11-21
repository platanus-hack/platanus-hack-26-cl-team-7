# Trends Page: Global Select/Deselect All

## Summary

Add a single toggle button to the Trends page filter controls that selects or deselects all category filters at once.

## Design

**Component:** `client/src/pages/Trends.jsx` — no new files.

**Button placement:** Inline with the Range dropdown in the existing controls row, pushed to the right via `ml-auto`.

**Label logic:**
- "Deselect All" — when all categories are selected (`selectedIds.size === categories.length && categories.length > 0`)
- "Select All" — in all other states (partial or none selected)

**Click behavior:**
- "Select All" → `setSelectedIds(new Set(categories.map(c => c.id)))`
- "Deselect All" → `setSelectedIds(new Set())`

**Style:** Small, text-weight button. No heavy border or fill. Consistent with existing muted label styling (`text-sm text-indigo-500 hover:text-indigo-400`).

**Edge cases:**
- Categories not yet loaded: button is not rendered (categories array is empty)
- Zero categories: button is not rendered

## Scope

Single file edit. No new state, no new components, no API changes.
