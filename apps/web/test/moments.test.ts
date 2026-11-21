import { describe, expect, it } from "vitest";
import type { Finding, TrackAction, TrackKey } from "@sentinel/contracts";
import { agentName, answerOf, buildMoments, category, chainTo, disguises, kindOf, vulnOf } from "../src/mirror/moments";

let seq = 0;
function action(p: Partial<TrackAction>): TrackAction {
  seq++;
  return {
    eventId: `track.action:r${seq}`, trackId: "trk_0123456789abcdef", ts: 1_000 + seq, method: "GET", path: "/",
    query: "", status: 200, durationMs: 1, requestBody: "", responseBody: "", ...p,
  };
}
function finding(p: Partial<Finding>): Finding {
  return {
    findingId: "fnd_0123456789abcdef", trackId: "trk_0123456789abcdef", kind: "signature_success", endpoint: "GET /search",
    evidence: "GET /search with signature 'sql tautology' got 200", ts: 0, proposal: null, proposalStatus: "pending", ...p,
  };
}

describe("category", () => {
  it("names what a request tried in plain Spanish", () => {
    expect(category({ path: "/.env", query: "" })).toBe("Buscó archivos secretos");
    expect(category({ path: "/server-status", query: "" })).toBe("Buscó herramientas de administración");
    expect(category({ path: "/search", query: "q=juice%27+OR+%271%27%3d%271" })).toBe("Intentó engañar al buscador");
    expect(category({ path: "/search", query: "q=juice%27" })).toBe("Intentó engañar al buscador");
    expect(category({ path: "/search", query: "q=juice%27%27" })).toBe("Intentó engañar al buscador");
    expect(category({ path: "/search", query: "q=juice%5c" })).toBe("Intentó engañar al buscador");
    expect(category({ path: "/", query: "x=\"><script>alert('a')</script>" })).toBe("Intentó meter código en una página");
    expect(category({ path: "/login", query: "" })).toBe("Probó las páginas de cuenta");
    expect(category({ path: "/products", query: "" })).toBe("Navegó la tienda como un cliente");
    expect(category({ path: "/zzz", query: "" })).toBe("Adivinó páginas que podrían existir");
  });

  it("does not call ordinary text an attack", () => {
    expect(category({ path: "/search", query: "q=men's+shoes" })).toBe("Navegó la tienda como un cliente");
    expect(category({ path: "/search", query: "q=description" })).toBe("Navegó la tienda como un cliente");
  });

  it("survives a query that is not valid percent encoding", () => {
    expect(category({ path: "/search", query: "q=%E0%A4%A" })).toBe("Navegó la tienda como un cliente");
  });
});

describe("kindOf", () => {
  it("treats a 4xx as nothing found and anything else as a find", () => {
    expect(kindOf(404)).toBe("none");
    expect(kindOf(401)).toBe("none");
    expect(kindOf(200)).toBe("fooled");
    expect(kindOf(302)).toBe("fooled");
    expect(kindOf(500)).toBe("fooled");
  });
});

describe("buildMoments", () => {
  it("orders newest-first input by time and merges runs of nothing found", () => {
    const acts = [
      action({ path: "/a", status: 404 }),
      action({ path: "/.env", status: 404 }),
      action({ path: "/admin", status: 404 }),
      action({ path: "/products", status: 200 }),
      action({ path: "/products", status: 200 }),
    ].reverse();
    const ms = buildMoments(acts, []);
    expect(ms.map((m) => [m.kind, m.count])).toEqual([["none", 3], ["fooled", 2]]);
    expect(ms[0]!.hint).toBe("GET /a");
    expect(ms[1]!.tried).toBe("Navegó la tienda como un cliente");
  });

  it("makes the proving request its own moment", () => {
    const before = action({ path: "/search", query: "q=a", status: 200 });
    const hit = action({ path: "/search", query: "q=%27+OR+1%3d1", status: 200 });
    const acts = [before, hit, action({ path: "/search", query: "q=b", status: 200 })];
    const ms = buildMoments(acts, [finding({ ts: hit.ts + 2, evidence: "GET /search got 200. Request: GET /search?q=%27+OR+1%3d1" })]);
    expect(ms.map((m) => m.kind)).toEqual(["fooled", "win", "fooled"]);
    expect(ms[1]!.finding?.endpoint).toBe("GET /search");
    expect(ms[1]!.count).toBe(1);
  });

  it("keeps a proof whose request is no longer stored, at its time", () => {
    const acts = [action({ path: "/a", status: 404 }), action({ path: "/b", status: 404 })];
    const ms = buildMoments(acts, [finding({ ts: 1 })]);
    expect(ms[0]!.kind).toBe("win");
    expect(ms[0]!.hint).toBe("GET /search");
    expect(ms).toHaveLength(2);
  });

  it("matches a proof on a route pattern, and a login redirect", () => {
    const item = action({ path: "/api/products/7", query: "x=1", status: 200 });
    const login = action({ method: "POST", path: "/login", status: 302 });
    const ms = buildMoments([item, login], [
      finding({ findingId: "fnd_1111111111111111", endpoint: "GET /api/products/{id}", ts: item.ts + 1 }),
      finding({ findingId: "fnd_2222222222222222", kind: "auth_flip", endpoint: "POST /login", ts: login.ts + 1 }),
    ]);
    expect(ms.map((m) => m.kind)).toEqual(["win", "win"]);
    expect(ms.map((m) => m.id)).toEqual([item.eventId, login.eventId]);
  });

  it("prefers the request the evidence quotes over a nearer one", () => {
    const hit = action({ path: "/search", query: "q=%27+OR+1%3d1", status: 200 });
    const near = action({ path: "/search", query: "q=a", status: 200 });
    const ms = buildMoments([hit, near], [finding({ ts: near.ts + 1, evidence: "x. Request: GET /search?q=%27+OR+1%3d1" })]);
    expect(ms[0]!.kind).toBe("win");
    expect(ms[0]!.line).toBe("GET /search?q=' OR 1=1");
  });

  it("returns no moments for no requests and no proofs", () => {
    expect(buildMoments([], [])).toEqual([]);
  });
});

describe("vulnOf and answerOf", () => {
  it("names the vulnerability and its weak point in plain Spanish", () => {
    expect(vulnOf({ kind: "signature_success", evidence: "GET /search with signature 'sql tautology' got 200" }).name).toBe("Inyección SQL");
    expect(vulnOf({ kind: "signature_success", evidence: "GET / with signature 'xss script tag' got 200" }).severity).toBe("Alta");
    expect(vulnOf({ kind: "auth_flip", evidence: "x" }).name).toBe("Salto del inicio de sesión");
    expect(vulnOf({ kind: "signature_success", evidence: "no signature" }).name).toBe("Ataque que funcionó");
    const sig = (name: string) => vulnOf({ kind: "signature_success", evidence: `GET /x with signature '${name}' got 200` }).name;
    expect(sig("dotenv file")).toBe("Archivo privado expuesto");
    expect(sig("sql dump")).toBe("Archivo privado expuesto");
    expect(sig("shell path")).toBe("Archivo privado expuesto");
    expect(sig("sql union select")).toBe("Inyección SQL");
    expect(sig("path traversal to secret")).toBe("Acceso a archivos fuera de la carpeta");
    expect(sig("server status")).toBe("Panel interno expuesto");
    expect(sig("log4shell")).toBe("Ejecución de comandos");
  });

  it("says what the decoy answer proved", () => {
    expect(answerOf({ evidence: "GET /search with signature 's' got 200, 1332 bytes; the 404 page has 10." })).toBe(
      "Respondió 200 con 1332 bytes de contenido; una página que no existe ocupa 10 bytes.",
    );
    expect(answerOf({ evidence: "other" })).toBe("La copia falsa respondió como si el ataque hubiera funcionado.");
  });
});

describe("chainTo", () => {
  it("lists the catch, the last steps before the proof and the proof", () => {
    const acts = Array.from({ length: 7 }, (_, i) => action({ path: `/p${i}`, status: i % 2 ? 404 : 200 }));
    const hit = action({ path: "/search", query: "q=%27+OR+1%3d1", status: 200 });
    const ms = buildMoments([...acts, hit], [finding({ ts: hit.ts + 1 })]);
    const steps = chainTo({ rule: "R1", reason: "r", openedAt: 5, actions: 8 }, ms, "fnd_0123456789abcdef");
    expect(steps[0]).toMatchObject({ kind: "caught", ts: 5, text: "Detectado y desviado a la copia falsa", note: "Buscó páginas que no existen" });
    expect(steps[1]).toMatchObject({ kind: "gap", text: "2 intentos anteriores" });
    expect(steps).toHaveLength(1 + 1 + 5 + 1);
    expect(steps[steps.length - 1]).toMatchObject({ kind: "win", cat: "sql", code: "GET /search?q=' OR 1=1" });
    expect(chainTo({ rule: "R1", reason: "r", openedAt: 5, actions: 8 }, ms, "fnd_ffffffffffffffff")).toEqual([]);
    const more = chainTo({ rule: "R1", reason: "r", openedAt: 5, actions: 5000 }, ms, "fnd_0123456789abcdef");
    expect(more[1]).toMatchObject({ kind: "gap", text: "Más intentos antes", note: "No todos se muestran aquí." });
  });
});

describe("disguises", () => {
  const ipUa = (n: number): TrackKey[] => Array.from({ length: n }, (_, i) => ({ kind: "ip_ua", value: `1.2.3.4|ua${i}` }));
  it("counts other browser identities", () => {
    expect(disguises({ keys: ipUa(1) })).toBe("");
    expect(disguises({ keys: ipUa(2) })).toBe("1 disfraz");
    expect(disguises({ keys: ipUa(4) })).toBe("3 disfraces");
    expect(disguises({ keys: ipUa(16) })).toBe("15 disfraces");
    expect(disguises({ keys: ipUa(64) })).toBe("más de 63 disfraces");
  });
});

describe("agentName", () => {
  it("names an agent by its browser or tool", () => {
    expect(agentName("curl/8.7.1")).toBe("curl 8.7.1");
    expect(agentName("python-httpx/0.28")).toBe("python-httpx 0.28");
    expect(agentName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.6280.45 Safari/537.36")).toBe("Chrome 142 · Windows");
    expect(agentName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0")).toBe("Firefox 135 · macOS");
    expect(agentName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0")).toBe("Edge 120 · Windows");
    expect(agentName("")).toBe("Agente sin nombre");
    expect(agentName("() { :; }; echo x")).toBe("Agente sin nombre");
  });

});
