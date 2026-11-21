# Budget App (demo copy)

A small self-hosted personal budgeting app: accounts, envelope budgets, transactions
with CSV import and splits, debts, savings goals, categorization rules, a calendar and
spending trends. This copy runs on **mock data only**. There is no real personal or
financial data in it.

**Stack:** Node.js, Express, SQLite (better-sqlite3), React (Vite, Tailwind), JWT auth
in an httpOnly cookie with bcrypt password hashes. Tests: Jest + supertest on the
server, Vitest on the client.

## Upstream and license

- Upstream: https://github.com/mitchelltrout/budget-app
- Pinned commit: `53202a477d7ed98fce1e72352eb105be4914bf92`
- License: MIT, Copyright (c) 2026 Mitchell Trout. See [LICENSE](LICENSE). Credit for the
  application goes to the upstream author.

### Changes from upstream

- `server/config.js` (new): `PORT` defaults to 3111, `DB_PATH` defaults to
  `data/budget.db`, `JWT_SECRET` comes from the environment. Without it a random secret
  is generated at start (outside production); with `NODE_ENV=production` the server
  refuses to start. The hard-coded fallback secrets were removed from `server/auth.js`,
  `docker-compose.yml` and the Windows script.
- An empty database is filled with the mock data at start (`server/seed-rich.js`, now an
  exported, transactional function with timezone-independent dates).
- The server serves `client/dist` whenever it has been built, not only in production.
- Dependencies were raised to the smallest versions without high or critical `npm audit`
  findings: `better-sqlite3` `^9.4.3` to `^12.11.1` (9.x does not compile on current
  Node), `bcrypt` `^5.1.1` to `^6.0.0` (drops the vulnerable `tar`), `vitest` `^1.6.0` to
  `^4.1.12` and `vite` `^5.2.11` to `^7.3.8` (drops the vulnerable `tinypool`), plus the
  in-range updates `npm audit fix` made to both lockfiles. The Docker base image is
  `node:22-alpine`.
- ESLint flat configs for `server/` and `client/` (pinned versions) and the code fixes
  they needed: literal byte-order marks written as `\uFEFF`, unused variables removed,
  empty `catch` blocks given a reason, `if` statements instead of expression ternaries,
  hook dependency lists completed in `Envelopes.jsx` and `Investments.jsx`.
- The Jest run uses an in-memory database (`server/jest.setup.js`) so tests never open
  `data/budget.db`.
- Port 3001 became 3111 in the Vite proxy, Dockerfile, docker-compose and Caddyfile.
- Three stale server tests were updated (date-range query shape, current-month trends).
  Tests were added for config, the JWT secret rule, seeding, real server start and
  restart, upload cleanup, and the client pages that changed.
- Removed `CLAUDE.md` (upstream agent notes), `start.bat` (Windows script with a
  hard-coded secret), `server/import-statement.js` (a one-off upstream script that held
  rows and names from the upstream author's own bank statement) and `server/seed.js`
  (an older seed script nothing used any more; `server/seed-rich.js` replaced it).
  Replaced `.gitignore`.
- Sign-up: `POST /api/auth/signup` and a `/signup` page, linked from the login page.
- Theme: a light/dark toggle in the top bar and on the login and sign-up pages. Tailwind
  now uses the `class` dark-mode strategy and the saved choice wins over the system
  setting (`client/src/ThemeContext.jsx` was already in upstream but never mounted).
  The Calendar, Investments and Debt pages, which only had one theme's colours, now have both.
- Error answers: a final error handler (`server/errors.js`) and input checks
  (`server/validate.js`). Bad input gets a short JSON 4xx and an unexpected failure gets a
  generic JSON 500; stack traces, file paths and SQL errors stay in the server log. Upstream
  only hid them when run with `NODE_ENV=production`.

## Run locally (port 3111)

Needs Node 20.19 or newer (developed on Node 26) and npm. This folder is not part of the
repository's pnpm workspace; use npm inside it.

```bash
cd demo-david
(cd server && npm ci)
(cd client && npm ci)
npm run build      # builds client/dist
npm start          # http://localhost:3111
```

On the first start the empty database `data/budget.db` is created and loaded with the
mock data. `data/` is gitignored.

For development, run both in separate terminals:

```bash
npm run dev:server   # API on :3111 with nodemon
npm run dev:client   # Vite on http://localhost:5173, proxies /api to :3111
```

### Test login

| Username | Password   |
|----------|------------|
| `admin`  | `changeme` |

It belongs to the mock data and exists only so the app can be explored locally.

### Sign up

The login page links to a sign-up page (`/signup`): a username of 3 to 32 letters,
numbers, dots, dashes or underscores (not case-sensitive, so `Admin` is taken) and a
password of at least 8 characters (72 bytes at most). A new account is signed in at once. The app has no per-user
data: every account sees and edits the same mock household, and there is no way to delete
an account in the app (delete the `data/` folder to start over).

### Theme

The top bar has a sun/moon button. Until it is used the app follows the system setting;
after that the choice is saved in the browser (`localStorage` key `theme`) and applied
before the first paint.

### Error answers

Errors come back as JSON such as `{"error":"Invalid request"}` (HTTP 400, for example for
malformed JSON, an unknown account type or a `due_day` of 40) or
`{"error":"Internal server error"}` (HTTP 500). The details are written to the server's
console only. Without `NODE_ENV=production` Express would otherwise answer with an HTML
page that contains the stack trace and local file paths.

### Configuration

| Variable     | Default                        | Purpose |
|--------------|--------------------------------|---------|
| `PORT`       | `3111`                         | Port the server listens on |
| `DB_PATH`    | `demo-david/data/budget.db`    | SQLite file (its folder is created if missing) |
| `JWT_SECRET` | random value generated at start | JWT signing key. Required when `NODE_ENV=production`. Set it to keep sessions across restarts |
| `NODE_ENV`   | unset                          | `production` makes `JWT_SECRET` mandatory. Error answers are the same JSON in both modes |

No secret is stored in the repository. Put real values in the environment or in an
untracked `.env`.

### Mock data

- Every start with an empty database loads the mock data once. Starting again on a
  database that already has users changes nothing.
- `npm run seed` wipes every table and reloads the mock data. Use it to reset the app.
  Stop the server first, or restart it afterwards.
- To start from scratch, delete the `data/` folder.
- The data is one fictional household: 5 accounts, 26 categories, about 250 transactions
  between December 2025 and May 2026, debts, savings goals and stock holdings. Dates are
  fixed, so the dashboard shows the last transaction date rather than "today".
- `GET /api/investments` asks Yahoo Finance for live prices of the mock tickers. Offline,
  the prices stay empty and everything else works.

### Docker

`Dockerfile` and `docker-compose.yml` come from upstream with the port changed to 3111.
The container runs with `NODE_ENV=production`, so it needs a secret:

```bash
JWT_SECRET="$(openssl rand -hex 32)" docker compose up --build
```

The data lives in the `budget-data` volume. These files have not been exercised in this
copy.

## Tests and lint

```bash
npm test                  # server (Jest) then client (Vitest)
(cd e2e && npm test)      # browser tests (Playwright), see e2e/README.md; needs npm run build first
(cd server && npm test)   # Jest + supertest, in-memory SQLite, plus real server starts
(cd client && npm test)   # Vitest + jsdom
npm run lint              # ESLint (flat config) in server/ and client/, 0 warnings allowed
```

The repository's oxlint run from the repository root also covers this folder:

```bash
pnpm lint                 # from the repository root, runs: oxlint .
```

Dependency check (no high or critical findings in either folder):

```bash
(cd server && npm audit)
(cd client && npm audit)
```
