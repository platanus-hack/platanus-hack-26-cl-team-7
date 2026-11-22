"""Latencia agregada por Reaper (modo revproxy) en loopback. Alterna directo y proxy para cancelar la deriva."""
import http.client, statistics, sys, time, json
from concurrent.futures import ThreadPoolExecutor
D, P = 9177, 9178
def una(port, path):
    t = time.perf_counter()
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("GET", path, headers={"User-Agent": "medicion-latencia"})
    r = c.getresponse(); body = r.read(); c.close()
    assert r.status == 200, r.status
    return (time.perf_counter() - t) * 1000, len(body)
def pct(xs, p): xs = sorted(xs); return xs[min(len(xs) - 1, int(len(xs) * p))]
def serie(path, n):
    d, p = [], []
    for _ in range(50): una(D, path); una(P, path)  # calentamiento
    for _ in range(n):
        d.append(una(D, path)[0]); p.append(una(P, path)[0])
    return d, p
def conc(port, path, n, hilos):
    with ThreadPoolExecutor(hilos) as ex: return [x[0] for x in ex.map(lambda _: una(port, path), range(n))]
out = {}
for nombre, path in [("json 164 B", "/bruma/service"), ("html 2 KB", "/bruma/"), ("css 5 KB", "/workspaces.css")]:
    d, p = serie(path, 2000)
    out[nombre] = {k: {"p50": round(pct(v, .5), 2), "p95": round(pct(v, .95), 2), "p99": round(pct(v, .99), 2)} for k, v in (("directo", d), ("reaper", p))}
    o = out[nombre]; o["agrega"] = {q: round(o["reaper"][q] - o["directo"][q], 2) for q in ("p50", "p95", "p99")}
d = conc(D, "/bruma/service", 2000, 20); p = conc(P, "/bruma/service", 2000, 20)
out["json, 20 en paralelo"] = {"directo": {"p50": round(pct(d, .5), 2), "p95": round(pct(d, .95), 2)}, "reaper": {"p50": round(pct(p, .5), 2), "p95": round(pct(p, .95), 2)}}
json.dump(out, open("/tmp/lat/resultado.json", "w"), indent=1, ensure_ascii=False)
for k, v in out.items(): print(k, json.dumps(v, ensure_ascii=False))
