# End-to-end tests

Playwright tests (Chromium) for every feature of the budget app: login, logout and
sign-up, the API with and without a session, the error answers (JSON 4xx without stack
traces or file paths), dashboard, transactions (add, edit, split,
delete, filters, infinite scroll), envelopes (allocations, transfer, categories,
copy, rollover), debts and the payoff planner, goals, rules, CSV import,
investments, calendar, trends, settings (password, accounts), the status page and
the theme (toggle, saved choice, and a readability check of every page in both themes).

## Run

```bash
cd demo-david
npm run build                 # the server serves client/dist
cd e2e
npm ci
npx playwright install chromium   # once per machine
npm test
```

By default the run starts its own server on port 3111 with a fresh database in
`e2e/.tmp/`, so port 3111 must be free. Other options:

| Variable        | Effect |
|-----------------|--------|
| `E2E_PORT`      | Port for the server the run starts (default 3111) |
| `E2E_BASE_URL`  | Test an app that is already running (for example `http://localhost:3111` after `npm start`); no server is started |
| `E2E_SHOTS_DIR` | Folder for the screenshots the tests take (default: each test's output folder) |

The tests create their own uniquely named records and delete them again, so they
can also run against a database that is in use. The exception is sign-up: the app has no
way to delete a user, so the sign-up tests leave users named `user...` and `api...`
behind. The default run starts from a fresh database, so this only matters with
`E2E_BASE_URL`. One test changes the admin
password and changes it back; the tests run one at a time.

`tests/known-bugs.spec.js` describes correct behaviour the app does not have yet.
Those tests are marked `test.fail()`: the run stays green while the bug exists,
and a fixed bug shows up as an unexpected pass.
