import { homedir } from "node:os";
import { resolve } from "node:path";

export type ServerConfig = {
  port: number;
  host: string;
  dbPath: string;
  dataDir: string;
};

const DEFAULT_DATA_DIR = resolve(homedir(), ".claude-remote");
const DEFAULT_DB_FILENAME = "db.sqlite";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDir = env.CLAUDE_REMOTE_DATA_DIR
    ? resolve(env.CLAUDE_REMOTE_DATA_DIR)
    : DEFAULT_DATA_DIR;

  const dbPath = env.CLAUDE_REMOTE_DB_PATH
    ? resolve(env.CLAUDE_REMOTE_DB_PATH)
    : resolve(dataDir, DEFAULT_DB_FILENAME);

  const portValue = env.PORT ?? "2633";
  const port = Number.parseInt(portValue, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT="${portValue}" — must be an integer between 1 and 65535`);
  }

  const host = env.HOST ?? "127.0.0.1";

  return { port, host, dbPath, dataDir };
}
