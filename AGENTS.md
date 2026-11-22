# AGENTS.md

Rules for every agent and human who changes this repository. Each rule is a contract. If you cannot
follow one, stop and say why in the PR. Do not work around it quietly.

Each rule says how it is enforced: **[gate]** means a command fails, **[CI]** means the GitHub workflow
fails, **[review]** means only a reviewer catches it.

## 1. Map

| Path | What it is | Status |
|---|---|---|
| `apps/sentinel` | Reaper server (Node, `node src/index.ts`), report agents (`src/reports`), experiments | Product |
| `apps/sentinel/lab` | Go engine (ext_proc, revproxy, containment), Python test services (`targets/businesses`), scoreboard. No README: this file is its guide | Product |
| `apps/web` | Reaper dashboard (React + Vite) | Product |
| `packages/contracts` | zod contracts for every body and frame that `apps/sentinel` or `apps/web` sends or receives | Product |
| `tools/simulator` | Demo traffic generator (typecheck only, no tests) | Product |
| `agent-detection/` | Detection engine, mirror lane (router, twin, tap, relay), demo shop, eval. Has its own `CONSTRAINTS.md` | Product |
| `apps/sentinel/src/reports/skills/` | AppSec playbooks the report agent loads. A change here changes model behavior | Product, prompt |
| `.agents/skills/` | Skills for coding agents (vendored `mastra`). The product never loads them | Tooling |
| `evidencia-agentes/`, `experiments/` | Recorded evidence and benchmark data | Data, read-only |
| `related_experiments/` | Archived research, including `demo-david/`. Published numbers come from it | Archive, read-only |
| `landing/`, `media/`, `reports/` | Web, pitch video and research (notes in `reports/notes/`) | Content |

The product is **Reaper**. In code it is still `sentinel` (`@sentinel/*`, `apps/sentinel`, `SENTINEL_*`).
Do not rename packages, env variables or routes for branding.

**Language.** User-facing text (`apps/web`, `landing/`, `README.md`) is Spanish (Chile). Code,
identifiers, log lines, commit messages, PR text and this file are English. [review]

## 2. Ground rules

1. **Own your folder.** Change another person's folder only through a PR they can review. [review]
2. **Repositories, not remote names.** The team repo is `harold18m/platanus-hack-26`. Never push to the
   official `platanus-hack/platanus-hack-26-cl-team-7`; only Harold publishes there. In clones that have
   both, the team repo is the remote `harold` and the official one is `origin`. [review]
3. **No direct pushes to `main`** for code. Branch, PR, gates, review, merge. Force-push only your own
   branch, with `--force-with-lease`. [review]
4. **No real secrets in git.** Real keys live only in the environment or a gitignored `.env`
   (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY`,
   `SENTINEL_INGEST_TOKEN`).
   `gitleaks` scans `agent-detection/` only [gate][CI]. Everywhere else, run `gitleaks dir <path> --redact`
   on what you touch and paste the result [review]. A leaked key is rotated, not just deleted.
5. **Bait is not a secret, and a secret is never bait.** Canaries and planted credentials
   (`mirror/canaries.py`, the engine's `--canary`, demo targets) are fake, useless outside the twin or the
   target, and live only there. Do not delete or "clean up" bait. New bait must not use a real provider's
   live-key format (the existing AKIA-format lab canary is listed in section 9). [review]
6. **Archives and data are read-only:** `related_experiments/`, `evidencia-agentes/`, `experiments/`. [review]
7. **Never hand-edit a generated file.** Rerun its generator in the same PR as the input change and paste the check:

   | File | Generator / check |
   |---|---|
   | `apps/sentinel/src/evidence-demo/bundle.json` | `cd agent-detection && uv run python -m scripts.evidence_demo` (write), then the same with `--check` |
   | `packages/contracts/test/fixtures/deception-batch.json` | Shared with `agent-detection/tests/test_mirror_contracts.py`; both test suites must pass |
   | `apps/sentinel/src/experiments/recorded-run.json` | A recorded lab run; replace it only with a new recording, never edit it |
   | `agent-detection/eval/baseline.json`, `eval/testset.lock` | `make lock` / `make baseline`, only after an approved rule change |

8. **No committed conflict markers.** Run `git grep -nE '^(<<<<<<<|>>>>>>>)'` before you push. [review]

## 3. Before you write code

1. Read the folder's README and, in `agent-detection/`, `CONSTRAINTS.md`. They are binding.
2. Run the area's gate (section 6) on the base. **Know whether the base is green before you change it.**
   Save the base output: you need it if a gate is already red (section 6).
3. Find every caller. `git grep` the whole repo, including scripts, `Caddyfile`, Dockerfiles, `deploy/`,
   `.github/workflows/`, docs with commands, and string or dynamic references.

## 4. Coding rules

**Design** [review]
- **Delete before you add.** Dead code, unused exports, pass-through wrappers, speculative flags and
  "just in case" branches go. The best diff makes concepts disappear.
- **Deep modules.** A small interface over real logic. If deleting a module only moves its code into its
  callers, it was a pass-through: inline it. Add a seam only when two adapters exist.
- **Logic lives in the layer that owns the concept.** No feature checks scattered through shared paths.
  Replace condition chains with a typed model or a dispatcher.
- **Accept dependencies, return results.** Pass clocks, stores, RNGs and model clients in. Keep side
  effects at the edges.

**Contracts** [review]
- Every body or frame that `apps/sentinel` or `apps/web` sends or receives is defined in
  `packages/contracts`, and both import it. Never retype a shape by hand.
- A producer in another language mirrors the contract and is pinned by a shared fixture. Today that is
  `agent-detection/mirror/contracts.py` with `deception-batch.json`. Change the zod schema, the Python twin
  and the fixture in the **same PR**.
- Other wire formats (demo shop API, twin sync, engine webhook, Go ext_proc and event log, scoreboard)
  are interfaces too. A route, status code, stored schema, CLI flag, env variable, `--help` text or log
  line that another part reads does not change silently: say it in the PR title.

**Types and errors**
- TypeScript `strict` [gate: `pnpm typecheck`]. Python in `agent-detection`: mypy strict [gate: `make types`].
  Go: `go vet` [gate]. The Python in `apps/sentinel/lab` has no type gate: keep it typed anyway. [review]
- No `@ts-ignore`, no `any`. Do not cast untrusted data: DB rows, `JSON.parse` output, request bodies and
  tool input are parsed with zod (`as const` is fine). [review: oxlint runs with default rules only]
- No new `# type: ignore`, `# noqa` or `# pragma: no cover` in `agent-detection` [gate: `make floor`].
- Validate at the boundary, trust inside. No defensive checks for states the types already exclude.
- Fail loudly. No silent fallback that hides a broken invariant.

**Security invariants** (a change to any of these needs a reviewer who checks only security) [review]
- *Twin isolation.* The twin never opens a connection to the real side. Only real-side jobs write into
  it: `demo/mask.py` (initial masked build) and `demo/sync.py` / `demo/replica.py` (live sync). The router
  asks for copies through `mirror/session_copy.py`. The twin holds no real PII and no real secrets, with
  one deliberate exception: the flagged session's own token, which the twin's SQL cannot read (`demo/db.py`).
- *Egress.* Outbound traffic from the twin goes only through the relay (`mirror/egress.py`): one grant per
  request, public addresses only, our own hosts always blocked. `--relay-allow-cidr` exists for tests only.
- *Redaction.* Every exchange goes through `mirror/redact.py` before it leaves the tap for Sentinel, the
  dashboard or a fix proposal. Do not narrow what it redacts.
- *Containment claims.* "Neutralizada" / "Contenida" / "neutralized" is shown only from a state the server
  wrote. The web app never derives it. (Known violation: section 9.)
- *Planted weaknesses.* The weaknesses in `agent-detection/demo` and `apps/sentinel/lab/targets` are the
  experiment. Do not fix them. Do not add weaknesses anywhere else.
- *Attack scope.* Attack fixtures, scanners, the simulator and lab or experiment runs target only
  loopback, the lab VM or the bundled fictional services. Never a third-party host without written
  authorization in the PR.
- *Exposure.* Sentinel binds to `127.0.0.1` by default (`SENTINEL_HOST`). A non-loopback bind needs
  `SENTINEL_INGEST_TOKEN`, `SENTINEL_ALLOWED_HOSTS` and `SENTINEL_ALLOWED_ORIGINS`.

**LLM calls** (`apps/sentinel/src/ai.ts`, `fixes.ts`, `reports/`, `experiments/providers.ts`,
`experiments/patch.ts`, `evidence-demo/`) [review]
- Attacker-derived text reaches a model only in fields prefixed `untrusted_`, and the system prompt says
  to treat them as data. (Known violation: the verdict prompt, section 9.)
- Tools are read-only. In `reports/` the scope (IP, time window) is set by code (`reports/scope.ts`),
  never by model input. The copilot tools in `ai.ts` take an IP and a range from the model, but read only
  the local store.
- Model output is `unknown` until it is parsed with a zod schema (the `packages/contracts` one when the
  value crosses to `apps/web`). In `reports/`, evidence IDs that do not resolve in the log stores are
  dropped (`reports/evidence.ts`).
- Fix proposals and report hypotheses are never applied, executed or sent to a target without a human
  decision (approve / refuse). There are two automatic effects; do not add others without review:
  1. The AI verdict settles an event's status (`killed` / `active`).
  2. The experiment patch step (`experiments/patch.ts`, `lab/scoreboard/patch_verify.py`) applies the
     model's edits to a **throwaway copy** of `apps/sentinel/lab/targets/businesses` and replays the lab
     fixtures against it on loopback. It is **not wired** in `index.ts` today: its verifier knows only the
     fictional Python services, and the pipeline now measures Vulhub targets. Bounds, each a contract: at
     most 3 exact replacements in `targets/businesses/*.py`; a static check refuses import changes, file,
     process, network, frame and reflection names and deep module chains; the canary refs are pinned from
     the original files; the patched child only serves HTTP, and the trusted parent sends the requests and
     counts the result; the child gets an allowlisted env, a deadline and a killed process group, and on
     macOS runs under `sandbox-exec` (no network except loopback, no writes outside the copy); its output
     never reaches the event, the panel or the model. The repository targets and any real service are never
     changed: moving a patch to a real service stays a human decision.
- Provider keys never reach lab, target or experiment subprocesses. `experiments/worker.ts` strips them.
  (Known gaps: section 9.)
- Tests use a fake model (`apps/sentinel/test/reports-helpers.ts`). No test calls a real provider.

**Size and style**
- `agent-detection`: 200 lines per source file, 300 per test file [gate: `make size`]. Exceptions only as
  `CONSTRAINTS.md` allows (owner and end date).
- Elsewhere: no new or changed source file (`ts`, `tsx`, `py`, `go`, `css`) above 1000 lines. Data and
  fixtures are excluded. [review]
- Lint checks that gate: `ruff check` (`make lint`) and `oxlint .` (`pnpm lint`) [gate].
  `gofmt -l` prints nothing for the Go files you touch [review: it always exits 0]. `ruff format` is not a
  gate: do not reformat files you do not otherwise change.
- Comments state **why** or an invariant. Delete comments that repeat the code. [review]
- Source modules take domain names (attacker, track, lane, twin, finding, verdict), not `utils` or
  `manager`. Test helpers under `test/` or `tests/` are fine. [review]

## 5. Testing rules

- **Test through the interface.** If a test needs private internals, the module has the wrong shape. [review]
- **A bug fix starts with a failing test** that reproduces the bug. [review]
- **No traffic leaves the host.** Loopback servers and local subprocesses (Caddy, the engine) are fine.
  External hosts and real model or provider APIs are not. [review]
- **New tests are deterministic.** Inject the clock and the RNG seed. A wait on a real process polls a
  condition with a bounded deadline; it never sleeps a fixed time. (Existing sleeps: section 9.) [review]
- **Never weaken a test to get green.** What machines check, in `agent-detection`: `check_floor.py`
  rejects added suppressions, `skip`/`xfail` markers, `importorskip`, `collect_ignore` and
  `NotImplementedError` stubs; `pytest_floor.py` fails any skipped or xfailed test at run time;
  `check_size.py` rejects raised size limits [gate]. Everything else is review: removed assertions,
  loosened thresholds, `.only` / `.skip` in vitest, deleted tests. [review]
- Delete a test only with the code it tests. When you merge modules, move their tests. [review]
- Changed lines in `agent-detection` are at least 80% covered [gate: `make test`, through `diff-cover`].
- Detection quality is a gate: precision and recall stay within 0.5 points of
  `agent-detection/eval/baseline.json` [gate][CI: `make eval-ci`]. Never regenerate the baseline or the
  lock to pass.

## 6. Gates

Run the gates of every area you touch and paste the commands and results into the PR.

| Area | Command (from repo root) | CI |
|---|---|---|
| TypeScript (`apps/`, `packages/`, `tools/`) | `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm lint && pnpm build` | no |
| `agent-detection/` | `cd agent-detection && UV_PYTHON=3.12 make check BASE=harold/main REQUIRE_BASE=1; make eval-ci` | yes, on `agent-detection/**` |
| `apps/sentinel/lab` (Go) | `cd apps/sentinel/lab && gofmt -l . ; go vet ./... && go test ./...` | no |
| `apps/sentinel/lab` (Python) | `cd apps/sentinel/lab && uv run --no-project --python 3.12 python -m unittest scoreboard.test_pipeline_eval` | no |

Notes:
- `BASE` must name the team repo's `main` (here `harold/main`). The Makefile default `origin/main` is
  the official repo in a dual-remote clone and checks the wrong diff.
- `UV_PYTHON=3.12` matches CI. Python 3.13 hides a failure that CI sees (section 9).
- While that known test fails, `make test` stops before `diff-cover`. Run the coverage step yourself:
  `cd agent-detection && uv run diff-cover coverage.xml --compare-branch=harold/main --include-untracked --fail-under=80`.
- `gofmt -l .` must print nothing for files your PR touches.
- `pnpm build` builds `@sentinel/web` only. `tools/simulator` has a typecheck and no tests.
- CI only runs the `agent-detection` row. The other rows are enforced by the pasted output and review.

**Red gates.** A red gate blocks the merge, unless the same failure is listed in section 9 and fails the
same way on the base. Then paste the base result next to the PR result.

## 7. Review rules

- **Every change gets an independent review.** Self-review does not count. An agent never approves its
  own diff. [review]
- Review with two lenses, one after the other:
  1. **Behavior.** Assume the change broke something and try to prove it. Grep every deleted or renamed
     symbol. Check the interfaces and invariants of section 4. Run the gates yourself.
  2. **Quality.** New indirection, casts, optional parameters, flags or special-case branches need a reason.
- Severity:
  - **blocking**: an unannounced behavior change, a broken caller, a weakened gate, a red gate not covered
    by section 6, a broken security or LLM invariant.
  - **major**: a missing test for changed behavior, new indirection with one caller, new dead code or
    exports, a hand-duplicated shape.
  - **minor**: everything else, including "a simpler design exists". File it as a follow-up.
- Merge with zero blocking and zero major findings and green gates.

## 8. Commits and PRs

- One concern per commit. Subject: `<area>: <imperative summary>`, at most 72 characters. The body says
  what moved and why. Example: `mirror: share one request-id parser between tap and lane`.
- Rebase on `harold18m/platanus-hack-26` `main` before you open or merge a PR. Resolve conflicts by
  keeping both intents. Never drop a teammate's change.
- The PR body states what changed, what did not change in behavior, the gates run with their results, and
  known limits. No claim without evidence.
- Agent-written commits end with a `Co-Authored-By:` trailer that names the real model.

## 9. Known debt

Seen on 2026-11-22. Remove an entry in the PR that fixes it.

- `agent-detection` CI is red on `main`: `tests/test_mirror_relay.py::test_a_malformed_request_line_is_refused_by_the_server`
  fails on Python 3.12 and passes on 3.13. While it fails, `diff-cover` does not run, and CI skips
  `make eval-ci`, `gitleaks git` and `make deps`.
- `gofmt -l` reports `internal/engine/rules.go` and `internal/research/research.go` in `apps/sentinel/lab`.
- `apps/web/src/mirror/FindingCard.tsx` falls back to `"Neutralizada"` when the server sent no state.
- `README.md` has committed conflict markers.
- `apps/web/src/index.css` (1129 lines) and `landing/assets/system.css` (1328) are above 1000 lines.
- About 40 `as` casts on DB rows and parsed JSON in `apps/sentinel/src` (most in `deception.ts`,
  `store.ts`, `reports/repo.ts`) where zod parsing should be.
- `agent-detection/tests` has about 15 fixed `time.sleep` waits (for example `test_cli.py`,
  `test_logreader.py`). Poll loops with a deadline are fine.
- The verdict prompt in `apps/sentinel/src/ai.ts` sends `method`, `path`, `user_agent` and `payload`
  without the `untrusted_` prefix.
- `apps/sentinel/src/evidence-demo/evaluate.ts` runs `python3` with the full `process.env`.
- The patch step's replay child runs model-written Python on the host as the current user. On Linux
  (and the Lima VM) it has no OS sandbox: only the static check, the env allowlist and the deadline bound
  it. On macOS it can still read the user's files, spawn binaries, reach loopback services, signal
  same-user processes and escape the group kill with `setsid`. "Verified" means the answers to the fixed
  fixture requests no longer carry the private ref: a patch can special-case those requests. A container
  sandbox and requests the child cannot recognize are the fix.
- The lab engine canary uses the AWS key format (`AKIA...`, `apps/sentinel/lab/cmd/engine/main.go`).
- `ruff format --check` would reformat 15 files in `agent-detection`.
