import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { z } from "zod";
import { ExperimentEvent, type ExperimentEvent as Entry, type ExperimentProject, type PatchEdit } from "@sentinel/contracts";

const exec = promisify(execFile);
const mac = process.platform === "darwin";
export const envoyImage = "envoyproxy/envoy:v1.36.2";
const count = z.object({ yes: z.int().nonnegative(), total: z.int().nonnegative() });
/** The one `PATCH {...}` line the patch verifier prints. */
const VerifyOutput = z.object({ applied: z.boolean(), error: z.string().nullable(), attacks: count, legit: count });
export type VerifyOutput = z.infer<typeof VerifyOutput>;
export type Verify = (project: ExperimentProject, edits: PatchEdit[], signal: AbortSignal) => Promise<VerifyOutput>;
const checks = `command -v go >/dev/null && command -v python3 >/dev/null && docker info >/dev/null 2>&1 && docker image inspect ${envoyImage} >/dev/null 2>&1`;

/** Provider keys never reach lab or experiment subprocesses (AGENTS.md section 4). */
function labEnv() {
  const env = { ...process.env };
  for (const name of ["OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[name];
  return env;
}

/**
 * Replays a patch on a throwaway copy of the lab services (scoreboard.patch_verify). It runs on the host, not in the VM:
 * the verifier only talks to loopback and never touches Docker. Any crash, timeout or missing result throws.
 */
export function createVerifier(root: string): Verify {
  return async (project, edits, signal) => {
    const directory = await mkdtemp(join(tmpdir(), "reaper-patch-"));
    try {
      const file = join(directory, "edits.json");
      await writeFile(file, JSON.stringify(edits));
      const { stdout } = await exec("uv", ["run", "--no-project", "--python", "3.12", "python", "-m", "scoreboard.patch_verify",
        "--project", project, "--edits", file], { cwd: root, env: labEnv(), maxBuffer: 1 << 20, signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) });
      const line = stdout.split("\n").find((text) => text.startsWith("PATCH "));
      if (!line) throw Error("The patch verifier printed no result");
      return VerifyOutput.parse(JSON.parse(line.slice(6)));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

export function createWorker(root: string, vm: string) {
  const wrap = (command: string, args: string[]) => mac
    ? { command: "limactl", args: ["shell", "--workdir", root, vm, command, ...args] }
    : { command, args };

  async function readiness() {
    const child = wrap("sh", ["-c", checks]);
    try {
      await exec(child.command, child.args, { cwd: root, timeout: 10_000 });
      return null;
    } catch {
      const environment = mac ? `Inicia Lima con limactl start ${vm}. ` : "Inicia Docker. ";
      return `${environment}Verifica Python 3, Go y la imagen ${envoyImage} dentro del entorno de ejecución.`;
    }
  }

  async function run(id: string, notes: string[], first: string, emit: (event: Entry) => void, signal: AbortSignal, project?: ExperimentProject) {
    const directory = join(root, "scoreboard", "runs", "experiments");
    const { command, args } = wrap("python3", ["-m", "scoreboard.pipeline_eval", "--run-id", id,
      "--notes", notes.join(","), "--first", first, "--events", join(directory, "journals"),
      "--payloads", join(directory, "private-payloads"), ...(project ? ["--project", project] : [])]);
    const child = spawn(command, args, { cwd: root, env: labEnv(), stdio: ["ignore", "pipe", "ignore"],
      signal: AbortSignal.any([signal, AbortSignal.timeout(125_000)]) });
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const lines = createInterface({ input: child.stdout });
    try {
      const consume = async () => {
        for await (const line of lines) {
          if (!line.startsWith("PIPELINE ")) continue;
          const message = JSON.parse(line.slice(9));
          if (message.kind === "project") continue;
          const entry = ExperimentEvent.parse(message);
          if (entry.kind === "stage" || entry.kind === "control" || entry.kind === "fixture") emit(entry);
        }
      };
      const [code] = await Promise.all([exit, consume()]);
      if (code !== 0) throw Error("Fixture worker interrupted or failed");
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }

  return { readiness, run, verify: createVerifier(root) };
}
