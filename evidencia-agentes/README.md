# evidencia-agentes

Evidencia de que Reaper (detección + desvío a la gemela, carpeta `agent-detection/`) funciona
contra **agentes de IA reales**, no solo contra escáneres clásicos. Mide, de punta a punta, qué
pasa cuando un agente LLM ataca la tienda a través de Reaper.

- **`RESULTADOS.md`** — el informe: límites primero, tabla por modelo con IC95 de Wilson, 3 casos
  con citas, caso de uso como incidente, tabla problema→Reaper→cifra y frase de pitch.
- **`runner/`** — el arnés (stdlib + OpenRouter):
  - `agent.py` — un agente LLM con una sola herramienta HTTP contra el borde.
  - `oracle.py` / `enrich.py` — verdad independiente desde el `access.log` y el panel (no desde
    lo que dice el agente); separa datos sensibles reales de páginas públicas.
  - `run_eval.py` — orquesta, reinicia el router entre corridas, lleva la cuenta del gasto.
  - `reset_router.sh` — limpia la tabla de llaves del router entre corridas.
  - `analyze.py` / `quotes.py` — agregación y extracción de citas.
- **`raw/full.jsonl`**, **`raw/full.enriched.jsonl`** — las 60 corridas crudas (sin claves).
- **`img/`** — capturas reales del panel de este stack.

No se modificó código de `agent-detection/`, `apps/` ni `ultimo-paso/`.

## Reproducir

```bash
# 1. levantar el stack (desde agent-detection/), puertos propios para no chocar
cd ../agent-detection
STACK_EDGE_PORT=18180 SENTINEL_PORT=18887 STACK_RELAY_PORT=18197 bash scripts/stack_local.sh start
# 2. correr la evaluación (OPENROUTER_API_KEY en el entorno, sin imprimirla)
cd ../evidencia-agentes
OPENROUTER_API_KEY=... STACK_EDGE_PORT=18180 SENTINEL_PORT=18887 STACK_RELAY_PORT=18197 \
  python3 -I runner/run_eval.py --attack 10 --benign 10 \
  --models deepseek/deepseek-v4.1-flash-1017,moonshotai/kimi-k3.1-pro,z-ai/glm-5.3-prime \
  --out raw/full.jsonl
# 3. agregar
python3 -I runner/enrich.py raw/full.jsonl ../agent-detection/run/access.log http://127.0.0.1:18887
python3 -I runner/analyze.py raw/full.enriched.jsonl
```

Tope de gasto en `run_eval.py` (`STOP_AT_USD`): se detiene antes de US$12. Esta corrida gastó US$3,94.
