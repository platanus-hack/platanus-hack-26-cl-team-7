# Status Page Spec

Copy this file to any project. When you run Claude on the project, say:
> "Implement the status page defined in STATUS_PAGE_SPEC.md"

Claude will create a `/status` endpoint that conforms to this contract so all projects can be monitored uniformly.

---

## Contract

### Endpoint

```
GET /status
```

- **Public** — no authentication, no API key, no session required
- **No sensitive data** — no user info, no account data, no business metrics
- **Two response formats** — JSON or HTML, selected by `Accept` header

---

### JSON Response

Returned when the request includes `Accept: application/json`.

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

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"ok"` \| `"degraded"` | Overall health. `"degraded"` if any check fails. |
| `timestamp` | ISO 8601 string | When the check ran (UTC) |
| `checks` | object | One key per check, each with a `status` field |
| `checks.<name>.status` | `"ok"` \| `"fail"` | Result of that individual check |
| `responseTimeMs` | integer | Milliseconds from request start to response |

**HTTP status codes:**

| Condition | Code |
|-----------|------|
| All checks pass | `200 OK` |
| Any check fails | `503 Service Unavailable` |

---

### HTML Response

Returned for all other `Accept` values (e.g., browser requests).

Requirements:
- Self-contained — no external CSS, JS, or font dependencies
- No JavaScript, no polling — static snapshot on page load
- Displays: project name, overall status badge, timestamp, per-check table, response time
- Visual treatment: green for operational, red for degraded

Suggested layout:

```
┌─────────────────────────────┐
│  Project Name               │
│                             │
│  ● OPERATIONAL              │  ← green badge, or red "DEGRADED"
│                             │
│  Checked: 2026-06-02 14:30Z │
│  Response time: 3ms         │
│                             │
│  server    ✓ ok             │
│  database  ✓ ok             │
└─────────────────────────────┘
```

---

## Required Checks

Every project must implement at minimum:

### `server`
Always `"ok"` — if the handler ran, the server is up. No logic needed.

### `database`
Run a minimal no-op query against the primary database:
- SQLite: `SELECT 1`
- PostgreSQL / MySQL: `SELECT 1`
- MongoDB: `db.command({ ping: 1 })`
- Redis: `PING`
- No database: omit this check entirely

Wrap in try/catch. Any exception → `"fail"`.

### Additional checks (optional)
Projects may add extra checks (e.g., `cache`, `storage`, `external_api`) using the same `{ "status": "ok" | "fail" }` shape. The overall `status` degrades if any check fails.

---

## Implementation Notes by Stack

### Node.js / Express
- New file: `routes/statusRoutes.js`, factory pattern `(db) => Router`
- Mount at `/status` without auth middleware, before protected routes
- Use `Date.now()` before/after checks for `responseTimeMs`
- Content-type: check `req.accepts(['json', 'html'])`

### Python / FastAPI
- New file: `routers/status.py`
- Router with `prefix="/status"`, no auth dependency
- Return `JSONResponse(content=..., status_code=200 or 503)`
- For HTML: `HTMLResponse(content=html_string, status_code=...)`

### Python / Flask
- Blueprint: `status_bp = Blueprint('status', __name__)`
- Register without auth decorator
- Check `request.accept_mimetypes.best` for content negotiation

### Go / net/http or Gin
- Handler func, registered before auth middleware group
- JSON: `json.NewEncoder(w).Encode(payload)`
- HTML: `fmt.Fprintf(w, htmlTemplate, ...)`

### Ruby / Rails
- Controller: `StatusController < ApplicationController`, skip `before_action :authenticate!`
- Route: `get '/status', to: 'status#show'`, outside authenticated scope

### PHP / Laravel
- Controller: `StatusController`, route in `routes/web.php` outside `auth` middleware group
- Return `response()->json(...)` or `response()->view(...)`

---

## Monitoring Integration

A monitoring project can poll `GET /status` with `Accept: application/json` on a schedule and:
- Use HTTP status code (`200` / `503`) for up/down detection without parsing the body
- Parse `checks` for granular failure attribution
- Store `responseTimeMs` for latency tracking
- Display `timestamp` to show when the last check ran

---

## Non-Goals

- No app-level metrics (user counts, transaction totals, storage used)
- No environment details (server version, dependency versions, env vars)
- No recent error logs
- No authentication
- No WebSocket or real-time updates
