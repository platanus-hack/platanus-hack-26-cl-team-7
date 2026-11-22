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

From the repository root, run `pnpm start` and open **Demo de evidencia** in Sentinel. The
recorded mock-bank A/B and the synthetic detector replay have separate run IDs. The replay
works without a proxy, a target service, or any provider credentials.

Sentinel opens on **Experimentos** with a saved run. Select a project to see its outcome,
compare the two connected paths, or start an independent run with **Ejecutar proyecto A/B**.
Use **Ejecutar todos** for the full suite. On macOS, start the existing VM with `limactl start espejismo`.
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
