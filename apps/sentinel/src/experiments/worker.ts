import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { ExperimentEvent, type ExperimentEvent as Entry, type ExperimentProject } from "@sentinel/contracts";

const exec = promisify(execFile);
const mac = process.platform === "darwin";
// The real-CVE pipeline needs Go (to build the engine), Python 3, and Docker (to run the Vulhub
// containers and, for the RCE target, `docker exec` the state oracle). It runs the engine itself in
// reverse-proxy mode, so no Envoy image is required.
const checks = "command -v go >/dev/null && command -v python3 >/dev/null && docker info >/dev/null 2>&1";

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
    const env = { ...process.env };
    for (const name of ["OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "ANTHROPIC_API_KEY"]) delete env[name];
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"],
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

  return { readiness, run };
}
