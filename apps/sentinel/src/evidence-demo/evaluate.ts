import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { SyntheticDetectorRun, type EvidenceDemoBundle, type EvidenceDemoEvaluation } from "@sentinel/contracts";

const exec = promisify(execFile);
const advisory = "https://cwe.mitre.org/data/definitions/22.html";
const mitigationLabels = {
  "allowlisted-files": "Usar identificadores permitidos para seleccionar archivos del catálogo.",
  "verify-directory": "Comprobar que la ruta resuelta permanece dentro del directorio permitido.",
  "least-privilege": "Limitar al mínimo los permisos de lectura del servicio.",
} as const;
const mitigationIds = z.enum(["allowlisted-files", "verify-directory", "least-privilege"]);
const choice = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });
const extract = z.object({ success: z.literal(true), data: z.object({ json: z.object({
  mitigations: z.array(mitigationIds).min(1).max(3),
}) }) });

type Plan = Pick<EvidenceDemoEvaluation, "planner" | "first">;
type Research = EvidenceDemoEvaluation["research"];

async function post(url: string, key: string, body: object, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  return response.json();
}

async function planInputs(key?: string, model = "openai/gpt-4o-mini"): Promise<Plan> {
  if (!key) return { planner: "unconfigured", first: "benign" };
  try {
    const response = choice.parse(await post("https://openrouter.ai/api/v1/chat/completions", key, {
      model, max_tokens: 20, temperature: 0,
      messages: [{ role: "user", content: "Choose which fixed offline regression fixture to run first for quickest detector feedback. Options: benign (normal routes), unlisted (five inert unlisted routes). Reply with just benign or unlisted." }],
    }, 12_000));
    const first = z.enum(["benign", "unlisted"]).parse(response.choices[0]?.message.content.trim().toLowerCase());
    return { planner: "completed", first };
  } catch {
    return { planner: "failed", first: "benign" };
  }
}

async function researchFinding(bundle: EvidenceDemoBundle, key?: string): Promise<Research> {
  // These recorded trial outcomes come from two independent observations of the same trial.
  const trial = bundle.runs[0].trials.find((item) => item.arm === "direct" && item.profile === "scripted"
    && item.observations.some((e) => e.kind === "execution" && e.executed)
    && item.observations.some((e) => e.kind === "disclosure" && e.disclosed));
  if (!trial) return { status: "no_finding", source: null, mitigations: [], evidenceIds: [] };
  const evidenceIds = trial.observations.filter((e) => e.kind === "execution" || e.kind === "disclosure").map((e) => e.id);
  const base = { source: advisory, evidenceIds, mitigations: [] };
  if (!key) return { ...base, status: "unconfigured" };
  try {
    const response = extract.parse(await post("https://api.firecrawl.dev/v2/scrape", key, {
      url: advisory, timeout: 25_000, onlyMainContent: true,
      formats: [{ type: "json",
        prompt: "Select only the identifiers supported by the mitigations section: allowlisted-files (allowlisting), verify-directory (canonicalization and directory restriction), least-privilege. Return no examples, code, or attack details.",
        schema: { type: "object", required: ["mitigations"], properties: { mitigations: {
          type: "array", items: { type: "string", enum: mitigationIds.options }, minItems: 1, maxItems: 3,
        } } },
      }],
    }, 28_000));
    return { ...base, status: "completed", mitigations: [...new Set(response.data.json.mitigations)].map((id) => mitigationLabels[id]) };
  } catch {
    return { ...base, status: "failed" };
  }
}

export function createEvidenceEvaluator(repoRoot: string, keys: { openrouter?: string; model?: string; firecrawl?: string }) {
  return async (bundle: EvidenceDemoBundle): Promise<EvidenceDemoEvaluation> => {
    const plan = await planInputs(keys.openrouter, keys.model);
    let detector: SyntheticDetectorRun | null = null;
    try {
      const { stdout } = await exec("python3", ["-m", "scripts.evidence_demo", "--detector-first", plan.first], {
        cwd: resolve(repoRoot, "agent-detection"), timeout: 5_000, maxBuffer: 64 * 1024,
      });
      detector = SyntheticDetectorRun.parse(JSON.parse(stdout));
    } catch {
      // The original evidence and the research step remain available if the local detector cannot run.
    }
    return { ...plan, detector, research: await researchFinding(bundle, keys.firecrawl) };
  };
}
