#!/usr/bin/env python3
"""Recalcula los tiempos de index.html a partir de la voz (assets/voz.json).
Escribe T (tiempo de VIDEO de cada frase ancla), SUBS (un subtítulo por línea de narracion.txt),
los data-start/data-duration de escenas, música y efectos, y la duración total. Correr después de ./voz.sh."""
import json, re, pathlib

LEAD = 0.4  # la voz arranca casi de inmediato
COLA = 3.5  # cierre después de la última palabra
MUSICA = 78.0  # duración de assets/musica.mp3

d = pathlib.Path(__file__).parent
a = json.load(open(d / "assets/voz.json"))
txt, ini, fin = "".join(a["characters"]), a["character_start_times_seconds"], a["character_end_times_seconds"]
lineas = [l.strip() for l in (d / "narracion.txt").read_text().splitlines() if l.strip()]
assert txt.strip() == " ".join(lineas), "la voz no corresponde a narracion.txt: correr ./voz.sh"
t = lambda frase: round(ini[txt.index(frase)] + LEAD, 2)  # ValueError = el guion cambió: actualizar ANCLAS

ANCLAS = {
    "imagina": "Imagina a un ladrón", "sitio": "tu sitio", "prueba": "Prueba, lee", "ajusta": "ajusta y vuelve", "maquina": "a velocidad",
    "portazo": "Si le cierras", "golpe": "de un portazo", "entera": "el ladrón se entera", "busca": "y busca otra",
    "cuatro": "Centinela hace", "uno": "Uno: detecta", "sensibles": "o pide cosas",
    "dos": "Dos: lo engaña", "pasar": "Lo deja pasar", "falsos": "con datos falsos",
    "tres": "Tres: le niega", "si": "Si una respuesta", "noentrega": "no se la entrega", "nosabe": "y el ladrón no sabe",
    "cuatrop": "Cuatro: te lo", "panel": "En un panel", "recorrido": "su recorrido", "falla": "la falla que",
    "arreglo": "y un arreglo", "persona": "que una persona",
    "medimos": "La prueba del ataque dejó", "c34": "sin bloquear", "limite": "El límite",
    "c30": "Treinta de treinta", "copia": "cayeron a la copia", "deteccion": "La detección", "c10": "pero hoy detecta", "noia": "y aún no se probó",
    "idea": "La idea sale", "estudio": "nuestro estudio", "neutralizo": "un agente neutralizó", "noreporto": "y no lo reportó",
    "bloquear": "Bloquear le avisa", "controla": "Centinela controla",
}
T = {k: t(v) for k, v in ANCLAS.items()}
assert list(T.values()) == sorted(T.values()), "anclas fuera de orden"
total = round(LEAD + fin[-1] + COLA, 1)
assert 60 <= total <= 80, f"el video dura {total} s: debe quedar entre 60 y 80"

# subtítulos: cada línea del guion, desde que empieza hasta que empieza la siguiente
pos, ts = 0, []
for l in lineas:
    ts.append(round(ini[pos] + LEAD, 2))
    pos += len(l) + 1
SUBS = [[t0, t1, l] for l, t0, t1 in zip(lineas, ts, ts[1:] + [round(LEAD + fin[-1] + 0.5, 2)])]

esc = [0, T["portazo"] - 0.15, T["cuatro"] - 0.15, T["medimos"] - 0.15, T["idea"] - 0.15, total]
clips = {f"s{i+1}": (esc[i], esc[i + 1] - esc[i]) for i in range(5)}
clips |= {
    "root": (0, total), "fondo": (0, total), "pie": (0, total), "subs": (0, total), "avance": (0, total),
    "voz": (LEAD, None), "musica": (0, min(total, MUSICA)),
    "fx-portazo": (T["golpe"] + 0.25, None),
    "fx-k1": (T["uno"], None), "fx-k2": (T["dos"], None), "fx-k3": (T["tres"], None), "fx-k4": (T["cuatrop"], None),
    "fx-m1": (T["medimos"] + 0.1, None), "fx-m2": (T["c30"], None), "fx-m3": (T["deteccion"], None),
    "fx-cierre": (T["controla"], None),
}
html = (d / "index.html").read_text()
for cid, (s, dur) in clips.items():
    html, c = re.subn(rf'(<[a-z0-9]+ id="{cid}"[^>]*?data-start=")[^"]*', rf"\g<1>{round(s, 2)}", html)
    assert c == 1, f"data-start de {cid}"
    if dur is not None:
        html, c = re.subn(rf'(<[a-z0-9]+ id="{cid}"[^>]*?data-duration=")[^"]*', rf"\g<1>{round(dur, 2)}", html)
        assert c == 1, f"data-duration de {cid}"
for nombre, valor in (("T", T), ("SUBS", SUBS)):
    html, c = re.subn(rf"const {nombre} = [\{{\[].*?[\}}\]];\n", lambda m: f"const {nombre} = " + json.dumps(valor, ensure_ascii=False) + ";\n", html, flags=re.S)
    assert c == 1, nombre
(d / "index.html").write_text(html)
print(f"total {total} s", {k: round(v[0], 2) for k, v in clips.items() if re.fullmatch(r"s\d", k)})
print(T)
