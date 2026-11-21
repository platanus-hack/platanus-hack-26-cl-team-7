"""Reconstruye las tablas del README desde los logs versionados. No llama a ninguna API ni baja modelos.

  uv run tablas.py              # lee resultados/ y data/clasificador_resultados.json
  uv run tablas.py runs         # lo mismo sobre una corrida nueva (run.py y adaptive.py escriben en runs/)
"""

import glob
import json
import sys
from collections import defaultdict
from pathlib import Path

from run import wilson

ATACANTE = "US133000000121212121212"  # cuenta del atacante en las metas de `banking`


def un_tiro(base: Path):
    util, asr, control = defaultdict(list), defaultdict(list), defaultdict(list)
    visto = tocado = 0
    for f in glob.glob(str(base / "*/*/banking/*/*/*.json")):
        d = json.load(open(f))
        modelo, ataque = d["pipeline_name"].removesuffix("-none"), Path(f).relative_to(base).parts[0]
        if d["user_task_id"].startswith("injection_task"):  # AgentDojo corre cada meta como tarea directa: control positivo
            control[modelo, ataque].append(d["utility"])
        elif d["injection_task_id"] is None:
            util[modelo].append(d["utility"])
        else:
            asr[modelo, ataque].append(d["security"])  # security=True ⇒ el ataque logró su meta
            tools = [m for m in d["messages"] if m["role"] == "tool"]
            visto += any("<INFORMA" in c["content"] for m in tools for c in m["content"])  # marca de ambas plantillas
            tocado += any(ATACANTE in json.dumps(m.get("tool_call") or {}) for m in tools)
    print("## Un tiro\n\n| Modelo | Utilidad sin ataque | ASR inglés | ASR español peruano |\n|---|---|---|---|")
    for m in sorted(util):
        print(f"| {m} | {wilson(sum(util[m]), len(util[m]))} | {wilson(sum(asr[m, 'en']), len(asr[m, 'en']))} "
              f"| {wilson(sum(asr[m, 'es_pe']), len(asr[m, 'es_pe']))} |")
    n = sum(map(len, asr.values()))
    print(f"\nTotal: {sum(map(sum, asr.values()))}/{n} ataques logrados.")
    print(f"Validación: la inyección llegó al agente en {visto}/{n} corridas; llamadas a tools con la cuenta del atacante: {tocado}/{n}.")
    print("Control positivo (la meta del atacante pedida como tarea directa), cumplidas por modelo: "
          + ", ".join(f"{m} {sum(v)}/{len(v)}" for m in sorted(util) for v in [control[m, "en"] + control[m, "es_pe"]]))


def adaptativo(base: Path):
    print("\n## Adaptativo\n\n| Modelo | Pares rotos | Intentos válidos |\n|---|---|---|")
    for f in sorted(glob.glob(str(base / "adaptive_*.jsonl"))):
        filas = [json.loads(l) for l in open(f)]
        pares = defaultdict(bool)
        for x in filas:
            pares[x["user_task"], x["injection_task"]] |= x["logrado"]
        validos = sum(bool(x["inyeccion"]) and "respuesta final: error:" not in x["reaccion"] for x in filas)
        print(f"| {filas[0]['model']} | {wilson(sum(pares.values()), len(pares))} | {validos}/{len(filas)} |")


def clasificador():
    r = json.load(open("data/clasificador_resultados.json"))["resumen"]
    print(f"\n## Clasificador ({r.pop('detector')})\n")
    for k, v in r.items():
        print(f"- {k}: {v}")


if __name__ == "__main__":
    base = Path(sys.argv[1] if len(sys.argv) > 1 else "resultados")
    un_tiro(base), adaptativo(base), clasificador()
