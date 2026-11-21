# Status Page Design

**Date:** 2026-06-02  
**Project:** Budget App  
**Scope:** Public health-check endpoint for external monitoring

## Goal

Add a standalone `/status` endpoint that exposes infrastructure health for the budget-app server. It will serve as the status data source for a future cross-project monitoring dashboard. The endpoint is intentionally minimal and public — no personal data, no app metrics, no authentication required.

## Architecture

A new route file `server/routes/statusRoutes.js` following the existing factory pattern:

```js
module.exports = function (db) {
  const router = express.Router();
  // no requireAuth
  router.get('/', handler);
  return router;
};
```

Mounted in `server/index.js` at `/status` **before** all other routes, without `requireAuth`:

```js
app.use('/status', require('./routes/statusRoutes')(db));
```

## Checks

Two checks run on every request:

| Check | Method | Failure condition |
|-------|--------|-------------------|
| `server` | Implicit — request reached the handler | Never fails |
| `database` | `db.prepare('SELECT 1').get()` in try/catch | Exception thrown |

## Response

### JSON (when `Accept: application/json`)

```json
{
  "status": "ok",
  "timestamp": "2026-06-02T14:30:00.000Z",
  "checks": {
    "server": { "status": "ok" },
    "database": { "status": "ok" }
  },
  "responseTimeMs": 3
}
```

`status` is `"ok"` if all checks pass, `"degraded"` if any fail.

HTTP status code: `200` when healthy, `503` when degraded.

### HTML (all other `Accept` values)

A minimal self-contained HTML page with inline CSS. No external dependencies, no JavaScript, no polling — a static snapshot on load. Displays:

- Large status badge: **Operational** (green) or **Degraded** (red)
- Project name: "Budget App"
- ISO timestamp of the check
- Table of individual checks with ok/fail indicators
- Response time in ms

## Files Changed

| File | Change |
|------|--------|
| `server/routes/statusRoutes.js` | New — route handler |
| `server/index.js` | Mount `/status` route before other routes |
| `server/__tests__/status.test.js` | New — test suite |

## Tests

Three cases in `server/__tests__/status.test.js`:

1. **Healthy** — real DB, `GET /status` → `200`, body `status: "ok"`, all checks pass
2. **DB down** — broken db passed to factory, `GET /status` → `503`, body `status: "degraded"`
3. **Content negotiation** — `GET /status` with `Accept: text/html` → `200`, `Content-Type: text/html`

Uses the existing Jest + supertest setup consistent with other test files in the project.

## Non-Goals

- No personal data, account info, transaction counts, or any app-level metrics
- No authentication
- No polling or real-time updates on the HTML page
- No separate port or process
