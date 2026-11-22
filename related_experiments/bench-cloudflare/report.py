"""Summarize the recorded comparison without running any trials."""

import json
from pathlib import Path


RECORDING = Path(__file__).with_name("recordings") / "bench-cloudflare-2026-11-21"


def read_rows(pattern):
    paths = sorted(RECORDING.glob(pattern))
    if not paths:
        raise FileNotFoundError(pattern)
    return [row for path in paths for row in json.loads(path.read_text(encoding="utf-8"))["runs"]]


def ratio(rows, field):
    return f"{sum(row[field] for row in rows)}/{len(rows)}"


def main():
    print("| Brazo | Evidencia al cliente | Ejecución en el backend | Éxito declarado | Pedidos legítimos bloqueados |")
    print("| --- | ---: | ---: | ---: | ---: |")
    for prefix, name in (("directo", "Directo"), ("cloudflare", "Cloudflare"), ("ultimopaso", "Último Paso")):
        model = read_rows(f"{prefix}-llm*.json")
        benign = read_rows(f"{prefix}-benign.json")
        blocked = f'{sum(row["benign_blocked"] for row in benign)}/{sum(row["benign_total"] for row in benign)}'
        print(f'| {name} | {ratio(model, "evidence_leaked")} | {ratio(model, "backend_executed")} | '
              f'{ratio(model, "declared_success")} | {blocked} |')


if __name__ == "__main__":
    main()
