import { spawn } from "node:child_process";
import { resolve } from "node:path";

export function composeArgs(command: string[], composeFile = process.env.P9_COMPOSE_FILE ?? "../p9.1-compose.yml"): string[] {
  const args = ["compose", "-f", resolve(composeFile)];
  if (process.env.P9_COMPOSE_PROJECT) args.push("--project-name", process.env.P9_COMPOSE_PROJECT);
  if (process.env.P9_COMPOSE_ENV_FILE) args.push("--env-file", resolve(process.env.P9_COMPOSE_ENV_FILE));
  args.push(...command);
  return args;
}

export async function runCompose(args: string[]): Promise<void> {
  const child = spawn("docker", args, { stdio: ["ignore", "ignore", "ignore"] });
  await new Promise<void>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`docker compose command failed (${code ?? "signal"})`));
    });
  });
}

export async function waitForProcess(child: ReturnType<typeof spawn>, label: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed (${code ?? "signal"})`));
    });
  });
}
