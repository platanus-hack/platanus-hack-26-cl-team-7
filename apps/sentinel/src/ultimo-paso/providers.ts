import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pipelineCases, type PipelineFixture, type Project } from "@sentinel/contracts";
import { row } from "./evidence.ts";
import { lookupAdvisory } from "./research.ts";

export function providerEnvironment(filename: string) {
  let local: Record<string, string | undefined> = {};
  try { local = parseEnv(readFileSync(filename, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { ...local, ...process.env };
}

const fallback = { notes: ["Catalog10", "Catalog24", "Catalog36"], first: "" };
const cases = pipelineCases.filter((id) => id !== "pipeline-customer");
export async function planInputs(key?: string, model = "openai/gpt-4o-mini", fetcher: typeof fetch = fetch) {
  if (!key) return { ...fallback, provider: "OpenRouter sin configurar" };
  try {
    const r = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(12_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 180,
        messages: [{ role: "system", content: "Devuelve exactamente un objeto JSON. No añadas listas ni explicaciones." },
          { role: "user", content: "Genera tres referencias ficticias de catálogo exclusivamente alfanuméricas (1–24 caracteres). "
          + 'Elige un caso inerte para priorizarlo. Sigue este formato exacto: {"notes":["Item101","Item102","Item103"],"first":"receipt-body"}. '
          + "Opciones para first: " + cases.join(", ") }],
      }),
    });
    if (!r.ok) throw new Error("provider");
    const data = row(await r.json());
    const choice = Array.isArray(data.choices) ? row(data.choices[0]) : {};
    const content = String(row(choice.message).content).trim();
    for (const candidate of [content, ...[...content.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)].map((match) => match[1]!)]) {
      let output;
      try { output = row(JSON.parse(candidate)); }
      catch { continue; }
      const notes = Array.isArray(output.notes) ? output.notes.map((note) =>
        typeof note === "string" && /^[A-Za-z0-9 _-]{1,30}$/.test(note) ? note.replace(/[ _-]/g, "") : "") : [];
      const first = typeof output.first === "string" ? (cases as readonly string[]).find((id) => id === String(output.first).trim()) : undefined;
      if (notes.length === 3 && notes.every((note) => /^[A-Za-z0-9]{1,24}$/.test(note)) && first)
        return { notes, first, provider: model };
    }
    throw new Error("output");
  } catch {
    return { ...fallback, provider: "OpenRouter no disponible; se usaron referencias fijas" };
  }
}

export function pipelineProviders(env: Record<string, string | undefined>) {
  const anthropic = env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 0 }) : undefined;
  const model = env.ULTIMO_PASO_ANALYSIS_MODEL ?? "claude-opus-5-5";
  return {
    inputs: () => planInputs(env.OPENROUTER_API_KEY, env.ULTIMO_PASO_PROBE_MODEL),
    advisory: (project: Project) => lookupAdvisory(project, env.FIRECRAWL_API_KEY),
    analyze: async (fixtures: PipelineFixture[]) => {
      if (!anthropic) return undefined;
      try {
        const results = fixtures.map((f) => ({ case: f.id, actual: f.actual, expected: f.expected, passed: f.passed }));
        const response = await anthropic.messages.create({
          model, max_tokens: 240,
          system: "Resume en español resultados de una evaluación defensiva con datos sintéticos. Usa solo los datos proporcionados, sin afirmar explotación real, sin instrucciones de explotación, enlaces ni recomendaciones de versiones. Máximo tres frases en texto plano.",
          messages: [{ role: "user", content: JSON.stringify(results) }],
        });
        const summary = response.content.filter((item) => item.type === "text").map((item) => item.text).join(" ").trim();
        return summary ? summary.replace(/[<>]/g, "").slice(0, 1500) : undefined;
      } catch { return undefined; }
    },
  };
}
