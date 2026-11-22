import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { EvidenceDemoBundle, type EvidenceDemoEvaluation } from "@sentinel/contracts";
import { fail } from "../http.ts";

const bundledEvidence = new URL("./bundle.json", import.meta.url);

export function evidenceDemoRoutes(
  readBundle = () => readFileSync(bundledEvidence, "utf8"),
  evaluate?: (bundle: EvidenceDemoBundle) => Promise<EvidenceDemoEvaluation>,
) {
  const app = new Hono();
  let active: Promise<EvidenceDemoEvaluation> | undefined;

  function load() {
    try {
      const parsed = EvidenceDemoBundle.safeParse(JSON.parse(readBundle()));
      if (parsed.success) return parsed.data;
    } catch {
      // A missing or unreadable replay must leave the rest of the app available.
    }
    return undefined;
  }

  app.get("/evidence-demo", (c) => {
    const bundle = load();
    return bundle ? c.json(bundle) : fail(c, 503, "evidence_demo_unavailable", "The evidence demo could not be loaded.");
  });
  app.post("/evidence-demo/evaluate", async (c) => {
    if (!evaluate) return fail(c, 503, "evidence_evaluation_unavailable", "Local evaluation is unavailable.");
    const bundle = load();
    if (!bundle) return fail(c, 503, "evidence_demo_unavailable", "The evidence demo could not be loaded.");
    active ??= evaluate(bundle).finally(() => { active = undefined; });
    return c.json(await active);
  });
  return app;
}
