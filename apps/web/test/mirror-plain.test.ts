import { describe, expect, it } from "vitest";
import { caughtFor } from "../src/mirror/moments";

describe("caughtFor", () => {
  it("says why the router caught an agent in plain Spanish", () => {
    expect(caughtFor({ rule: "R1", reason: "5 requests outside the route list within 300 s" })).toBe("Buscó páginas que no existen");
    expect(caughtFor({ rule: "R1", reason: "swarm link: asked for a decoy path that only another identity was given" })).toBe("Usó una ruta señuelo que solo recibió otro agente");
    expect(caughtFor({ rule: "R2", reason: "12 distinct endpoints within 60 s" })).toBe("Revisó muchas páginas muy rápido");
    expect(caughtFor({ rule: "R3", reason: "critical flag: dotenv file" })).toBe("Envió un patrón de ataque (dotenv file)");
    expect(caughtFor({ rule: "R3", reason: "critical flag: sql tautology (login body)" })).toBe("Envió un patrón de ataque (sql tautology)");
    expect(caughtFor({ rule: "R3", reason: "" })).toBe("Envió un patrón de ataque");
  });
});
