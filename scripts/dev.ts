import { spawn, type Subprocess } from "bun";

const apiPort = process.env.API_PORT ?? "2634";

const children: Subprocess[] = [
  spawn(["bun", "--hot", "./server/dev-api.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, API_PORT: apiPort },
  }),
  spawn(["bunx", "--bun", "vite", "dev"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, API_PORT: apiPort },
  }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

const exits = children.map((child) => child.exited);
const exitCode = await Promise.race(exits);
shutdown(typeof exitCode === "number" ? exitCode : 0);
