# Agent detection v0

Finds sessions that probe a site's endpoints. Caddy proxies the site and writes a JSON access log.
The engine reads that log, groups requests by IP + User-Agent and applies three rules:

- **R1 contract exits:** 5 or more requests outside the route list in 5 minutes.
- **R2 endpoint breadth:** more than 10 route patterns in 60 seconds.
- **R3 critical flag:** one request for a sensitive file or with a known attack payload.

Verdicts go to a webhook and show on a one-page dashboard.

Plan: `plans/ai-agent-detection-v0-plan.html`. Gates: `CONSTRAINTS.md`. Results: `eval/RESULTS.md`.

## Run

All commands run from this folder.

```bash
uv sync
make check                          # size, floor, lint, types, secrets, tests + changed-line coverage
make eval-ci                        # labeled replay, test-set lock, baseline
bash scripts/stack_local.sh start   # demo site :8081, Caddy :8080, dashboard :8090, engine
bash scripts/stack_local.sh stop
```

`deploy/docker-compose.yml` runs the same stack with Juice Shop as the demo site.

## Sentinel evidence demo

From the repository root, run `pnpm start` and open Sentinel. The panel has one page per protected
site (Bruma, Litoral, Surco, Banco Estero), each with the CVE its case is modelled on. A page reads
top to bottom: the result without and with Reaper, the replay of the attack, every request as raw
HTTP side by side (without Reaper | with Reaper | the retry, the proof highlighted, and what Reaper's
engine recorded), the vulnerability with its researched fix, and the limit. Out of the box it shows
the recording Sentinel bundles (`apps/sentinel/src/experiments/recorded-run.json`), so it works with
no VM and no keys. **Modo demo** (or `?demo=1`) walks the page with ←/→ and Esc; `?site=litoral`
opens a site. **Ejecutar prueba A/B** records a new run and the page follows it live.

On macOS, start the existing VM with `limactl start espejismo`.
The VM needs Python 3, Go, a running Docker engine, and `envoyproxy/envoy:v1.36.2`. On
Linux those dependencies run directly on the host. Sentinel needs a loopback bind for
live runs. Run `pnpm start` from the repository root. Provider credentials are read from
the root `.env` or the process environment.

Run `pnpm services` from the repository root to open the four interactive services at
`http://127.0.0.1:9120`. The A/B controls submit the same forms in isolated instances of
each service. The active runner and proxy live under `apps/sentinel/lab`. Historical
Último Paso results live under `related_experiments/ultimo-paso`.

One live run records both proxy arms for Bruma, Litoral, Surco, and Banco Estero. OpenRouter receives
only saved observation flags for the separate feedback comparison, and Firecrawl reads
approved advisory references. Choose a finished run and click **Reproducir** to play back
its stored event sequence or **Exportar JSON** to save its recording.

Select **Banco Estero** and use **Ejecutar proyecto A/B** to run only the bank. Expand a case to compare the requested
refund version, the approved version, and the service's eligibility decision in both arms.
Firecrawl attaches defensive guidance for CVE-2026-129289. The bank simulates approval decisions
and evidence exposure using safe HTTP fixtures. It does not execute payments or run PHP-FPM.

After changing either input, regenerate the bundled evidence from `agent-detection/` with
`uv run python -m scripts.evidence_demo`. Add `--check` to verify the bundle is current.

**Ejecutar evaluación asistida** uses `OPENROUTER_API_KEY` and `FIRECRAWL_API_KEY`
from the root `.env` or process environment. OpenRouter chooses the order of the fixed
detector inputs. The local detector needs `python3` with PyYAML. Firecrawl retrieves MITRE
CWE-22 mitigation guidance after confirming the saved backend execution and client disclosure.
