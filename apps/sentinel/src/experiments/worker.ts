import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { ExperimentEvent, type ExperimentEvent as Entry, type ExperimentProject } from "@sentinel/contracts";

const exec = promisify(execFile);
const mac = process.platform === "darwin";
export const envoyImage = "envoyproxy/envoy:v1.36.2";
const checks = `command -v go >/dev/null && command -v python3 >/dev/null && docker info >/dev/null 2>&1 && docker image inspect ${envoyImage} >/dev/null 2>&1`;

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
    const env = { ...process.env };
    for (const name of ["OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "ANTHROPIC_API_KEY"]) delete env[name];
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "ignore"],
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

  return { readiness, run };
}
