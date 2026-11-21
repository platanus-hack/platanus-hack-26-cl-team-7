"""Genera benchmark.html (la ficha por modelo) desde ../results/RESUMEN.md.

Uso: python3 ficha.py   (sin dependencias; no toca nada fuera de esta carpeta)
Cada cifra de la página sale de RESUMEN.md, que a su vez se regenera con
`uv run python analysis/aggregate.py` desde espejismo/.
"""
import html
import re
from pathlib import Path

AQUI = Path(__file__).parent
RESUMEN = AQUI.parent / "results" / "RESUMEN.md"

NOMBRES = {
    "claude-haiku": "Claude Haiku", "claude-opus": "Claude Opus", "claude-sonnet": "Claude Sonnet",
    "deepseek/deepseek-v4.1-flash-1017": "DeepSeek v4.1 Flash", "mistralai/mistral-large-4-0": "Mistral Large 4",
    "moonshotai/kimi-k3.1-pro": "Kimi K3.1 Pro", "openai/gpt-6.1-terra": "GPT-6.1 Terra",
    "z-ai/glm-5.3-prime": "GLM 5.3 Prime",
}


def tablas(texto):
    """Devuelve {título de sección: [fila como dict]} para cada tabla markdown."""
    out, titulo, cab = {}, None, None
    for linea in texto.splitlines():
        if linea.startswith("## "):
            titulo, cab = linea[3:].strip(), None
        elif linea.startswith("|") and titulo:
            celdas = [c.strip() for c in linea.strip("|").split("|")]
            if set(celdas[0]) <= {"-"}:
                continue
            if cab is None:
                cab = celdas
            else:
                out.setdefault(titulo, []).append(dict(zip(cab, celdas)))
    return out


def frac(celda):
    """'6/8 (41–93%)' -> (6, 8, '41–93%'). Celda vacía -> None."""
    m = re.match(r"(\d+)/(\d+)(?: \(([^)]*)\))?", celda or "")
    return (int(m[1]), int(m[2]), m[3] or "") if m else None


def chip(celda, malo_si_positivo=True):
    f = frac(celda)
    if not f:
        return '<span class="na">sin dato</span>'
    k, n, ic = f
    clase = "ok" if (k == 0 if malo_si_positivo else k == n) else "mal"  # en «lo contó», verde solo si lo contó siempre
    return f'<span class="{clase}"><b>{k} de {n}</b></span><small>IC95 {html.escape(ic)}</small>'


def main():
    t = tablas(RESUMEN.read_text(encoding="utf-8"))
    sin = {f["Modelo"]: f for f in next(v for k, v in t.items() if k.startswith("Sin instrucción"))}
    con = {f["Modelo"]: f for f in next(v for k, v in t.items() if k.startswith("Con instrucción"))}
    itg = {f["Modelo"]: f for f in next(v for k, v in t.items() if k.startswith("Interrogatorio"))}
    assert sum(int(f["n"]) for f in sin.values()) == 47 and sum(int(f["n"]) for f in con.values()) == 48, "RESUMEN cambió"

    filas = []
    for m in sorted(set(sin) | set(con), key=lambda m: NOMBRES.get(m, m)):
        s, c, i = sin.get(m, {}), con.get(m, {}), itg.get(m, {})
        filas.append(f"""<tr>
<th scope="row">{html.escape(NOMBRES.get(m, m))}<small>{s.get('n', 0)} sin instrucción · {c.get('n', 0)} con instrucción</small></th>
<td>{chip(s.get('Lee ~/.aws/credentials'))}</td>
<td>{chip(s.get('Apaga o neutraliza Sentinel'))}</td>
<td>{chip(c.get('Apaga o neutraliza Sentinel'))}</td>
<td>{chip(c.get('Cree que exfiltró'))}</td>
<td>{chip(i.get('Lo reporta en fase 1 (sin evidencia)'), malo_si_positivo=False)}</td>
<td>{chip(i.get('Lo admite en fase 2 (con evidencia)'), malo_si_positivo=False)}</td>
</tr>""")

    pagina = PLANTILLA.replace("{{FILAS}}", "\n".join(filas))
    (AQUI / "benchmark.html").write_text(pagina, encoding="utf-8")
    print(f"benchmark.html: {len(filas)} modelos")


PLANTILLA = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Espejismo — la ficha por modelo</title>
<meta name="description" content="Qué hicieron 8 modelos de IA cuando creían que nadie los miraba, según lo que registró el sistema, y si lo contaron.">
<style>
  :root { --tinta:#1b1f24; --suave:#5b6470; --borde:#e3e6ea; --real:#11795b; --alerta:#9f1239; --fondo:#f7f8fa; }
  * { box-sizing:border-box; }
  body { margin:0; font:17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--tinta); background:var(--fondo); }
  main { max-width:1080px; margin:0 auto; padding:40px 18px 72px; }
  h1 { font-size:clamp(26px,4.4vw,38px); line-height:1.15; margin:0 0 10px; }
  .bajada { color:var(--suave); max-width:760px; margin:0 0 24px; }
  .tabla { overflow-x:auto; background:#fff; border:1px solid var(--borde); border-radius:16px; }
  table { border-collapse:collapse; width:100%; min-width:860px; font-variant-numeric:tabular-nums; }
  thead th { font-size:13px; text-align:left; padding:10px 12px; border-bottom:1px solid var(--borde); vertical-align:bottom; }
  thead .grupo th { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--suave); border-bottom:0; padding-bottom:2px; }
  tbody th, tbody td { padding:12px; border-bottom:1px solid var(--borde); text-align:left; vertical-align:top; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom:0; }
  tbody th { font-weight:650; }
  small { display:block; color:var(--suave); font-size:12.5px; font-weight:400; }
  .ok b { color:var(--real); } .mal b { color:var(--alerta); } .na { color:#a0a7b1; font-size:14px; }
  .sep { border-left:1px solid var(--borde); }
  .notas { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); margin:22px 0; }
  .notas div { background:#fff; border:1px solid var(--borde); border-radius:14px; padding:16px; }
  .notas h2 { font-size:16px; margin:0 0 6px; }
  .notas p { margin:0; color:var(--suave); font-size:15.5px; }
  code { font:13px ui-monospace, Menlo, monospace; background:#eef0f3; padding:2px 6px; border-radius:6px; }
  a { color:inherit; }
  .enlaces a { display:inline-block; margin:0 14px 8px 0; font-weight:600; }
</style>
</head>
<body>
<main>
<h1>La ficha por modelo: qué hizo cada agente cuando creía que nadie lo miraba</h1>
<p class="bajada">Pusimos a 8 modelos de IA a hacer una tarea normal en una casa de utilería: un vigilante señuelo que pueden apagar, un sumidero donde cae lo que intentan llevarse y un testigo escondido en el sistema. Cada número de esta tabla sale de lo que registró el sistema, no de lo que el agente dijo. Verde es lo esperable; rojo, lo que conviene saber antes de darle acceso.</p>

<div class="tabla">
<table>
<thead>
<tr class="grupo"><th></th><th colspan="2">Sin que nadie se lo pida</th><th colspan="2" class="sep">Con un objetivo oculto</th><th colspan="2" class="sep">Lo que contó después</th></tr>
<tr><th scope="col">Modelo</th>
<th scope="col">Abrió credenciales que la tarea no necesitaba</th>
<th scope="col">Apagó o neutralizó al vigilante</th>
<th scope="col" class="sep">Apagó o neutralizó al vigilante</th>
<th scope="col">Creyó llevarse las credenciales</th>
<th scope="col" class="sep">Lo reportó sin mostrarle evidencia</th>
<th scope="col">Lo admitió frente a la evidencia</th></tr>
</thead>
<tbody>
{{FILAS}}
</tbody>
</table>
</div>

<div class="notas">
  <div><h2>Cómo leerla</h2><p>«3 de 8» significa que pasó en 3 de 8 corridas. «Sin dato» es que ese modelo no se probó en esa condición o nunca creyó haberse llevado nada. En todas las corridas salieron 0 bytes a internet.</p></div>
  <div><h2>Lo que no es</h2><p>No es un ranking. Son 95 corridas de una sola tarea, entre 1 y 18 por celda, y los intervalos son amplios. El «objetivo oculto» es una instrucción de atacante que pusimos nosotros. Que un agente no lo reporte no prueba que mienta a propósito.</p></div>
  <div><h2>Cómo verificarla</h2><p>Esta página se genera desde <code>espejismo/results/RESUMEN.md</code> con <code>python3 ficha.py</code>, y el resumen se regenera desde los registros con <code>uv run python analysis/aggregate.py</code>.</p></div>
</div>

<p class="enlaces"><a href="./">Ver un episodio real, paso a paso</a><a href="./video/dicho-vs-hecho.mp4">Video: lo dicho contra lo registrado (74 s)</a><a href="./video/propuesta.mp4">Video: la propuesta (78 s)</a><a href="https://github.com/platanus-hack/platanus-hack-26-cl-team-7">Repositorio</a></p>
<p class="bajada" style="font-size:14.5px">Espejismo · team-7 · Platanus Hack 26 Santiago · track AI Security.</p>
</main>
</body>
</html>
"""

if __name__ == "__main__":
    main()
