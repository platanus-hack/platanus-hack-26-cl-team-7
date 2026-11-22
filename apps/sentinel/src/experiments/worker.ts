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
const count = z.object({ yes: z.int().nonnegative(), total: z.int().nonnegative() });
/** The one `PATCH {...}` line the patch verifier prints. */
const VerifyOutput = z.object({ applied: z.boolean(), error: z.string().nullable(), attacks: count, legit: count });
export type VerifyOutput = z.infer<typeof VerifyOutput>;
export type Verify = (project: ExperimentProject, edits: PatchEdit[], signal: AbortSignal) => Promise<VerifyOutput>;
// The real-CVE pipeline needs Go (to build the engine), Python 3, and Docker (to run the Vulhub
// containers and, for the RCE target, `docker exec` the state oracle). It runs the engine itself in
// reverse-proxy mode, so no Envoy image is required.
const checks = "command -v go >/dev/null && command -v python3 >/dev/null && docker info >/dev/null 2>&1";

/** Provider keys never reach lab or experiment subprocesses (AGENTS.md section 4). */
function labEnv() {
  const env = { ...process.env };
  for (const name of ["OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) delete env[name];
  return env;
}

const VERIFY_TIMEOUT_MS = 45_000;

/**
 * Replays a patch on a throwaway copy of the lab services (scoreboard.patch_verify). It runs on the host, not in the VM:
 * the verifier only talks to loopback and never touches Docker. Any crash, timeout or missing result throws.
 * The verifier runs model-written code, so what it prints is untrusted: error messages never carry its output, the
 * command line or a temp path.
 */
export function createVerifier(root: string, timeoutMs = VERIFY_TIMEOUT_MS): Verify {
  return async (project, edits, signal) => {
    const directory = await mkdtemp(join(tmpdir(), "reaper-patch-"));
    try {
      const file = join(directory, "edits.json");
      await writeFile(file, JSON.stringify(edits));
      const { stdout } = await exec("uv", ["run", "--no-project", "--python", "3.12", "python", "-m", "scoreboard.patch_verify",
        "--project", project, "--edits", file], { cwd: root, env: labEnv(), maxBuffer: 1 << 20, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) })
        .catch((err: unknown) => { throw verifierError(err, signal, timeoutMs); });
      const line = stdout.split("\n").find((text) => text.startsWith("PATCH "));
      if (!line) throw Error("verifier printed no result");
      let message: unknown;
      try { message = JSON.parse(line.slice(6)); } catch { throw Error("verifier printed an invalid result"); }
      const parsed = VerifyOutput.safeParse(message);
      if (!parsed.success) throw Error("verifier printed an invalid result");
      return parsed.data;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

const Failure = z.object({ name: z.string(), code: z.union([z.string(), z.number()]) }).partial();

/** The error execFile rejects with carries the command line and both output streams: only its kind survives. */
function verifierError(err: unknown, caller: AbortSignal, timeoutMs: number) {
  const { name, code } = Failure.catch({}).parse(err);
  if (caller.aborted) return Error("verifier stopped");
  if (name === "AbortError") return Error(`verifier timed out after ${timeoutMs / 1000} s`);
  if (code === "ENOENT") return Error("uv not found");
  if (typeof code === "number") return Error(`verifier exited with code ${code}`);
  return Error("verifier failed");
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
      return `${environment}Verifica Python 3, Go y Docker dentro del entorno de ejecución.`;
    }
  }

  /** Runs the real-CVE pipeline for the given projects against their Vulhub containers through Reaper. */
  async function run(_id: string, projects: ExperimentProject[], emit: (event: Entry) => void, signal: AbortSignal) {
    const directory = join(root, "scoreboard", "runs", "experiments");
    const { command, args } = wrap("python3", ["-m", "scoreboard.vulhub_eval",
      "--targets", projects.join(","), "--events", join(directory, "journals")]);
    const child = spawn(command, args, { cwd: root, env: labEnv(), stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) });
    let stderr = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4_000); });
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
          const entry = ExperimentEvent.parse(message);
          if (entry.kind === "inputs" || entry.kind === "stage" || entry.kind === "control" || entry.kind === "fixture") emit(entry);
        }
      };
      const [code] = await Promise.all([exit, consume()]);
      if (code !== 0) {
        const last = stderr.trim().split("\n").filter(Boolean).at(-1);
        throw Error(last || "Fixture worker interrupted or failed");
      }
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }

  return { readiness, run, verify: createVerifier(root) };
}
