import { describe, expect, it } from "vitest";
import type { Finding, Track } from "@sentinel/contracts";
import { findingText } from "../src/mirror/FindingCard";
import { vulnOf, type Step } from "../src/mirror/moments";

const f: Finding = {
  findingId: "fnd_0123456789abcdef", trackId: "trk_0123456789abcdef", kind: "signature_success", endpoint: "GET /search",
  evidence: "GET /search with signature 'sql tautology' got 200", ts: Date.UTC(2026, 10, 21, 13, 16), proposal: null, proposalStatus: "pending",
};
const track = { userAgent: "curl/8.7.1" } as Track;

describe("findingText", () => {
  it("writes the finding, the trace and the request as plain text", () => {
    const steps: Step[] = [
      { ts: 1, text: "Detectado y desviado a la copia falsa", note: "Buscó páginas que no existen", kind: "caught", cat: null, code: null },
      { ts: 2, text: "Ataque confirmado en la copia falsa", note: "", kind: "win", cat: "sql", code: "GET /search?q=' OR 1=1" },
    ];
    expect(findingText(f, track, vulnOf(f), steps)).toBe(
      [
        "CRÍTICA · Inyección SQL",
        "Endpoint: GET /search",
        "Punto débil: El texto que escribe el usuario llega directo a la base de datos.",
        "Agente: curl 8.7.1",
        "Confirmada: 2026-11-21T13:16:00.000Z",
        "",
        "Traza:",
        "- Detectado y desviado a la copia falsa — Buscó páginas que no existen",
        "- Ataque confirmado en la copia falsa",
        "  GET /search?q=' OR 1=1",
        "",
        "Evidencia: GET /search with signature 'sql tautology' got 200",
      ].join("\n"),
    );
  });
});
