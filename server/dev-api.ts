import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/client.ts";
import { runMigrationsFromDir } from "./db/migrator.ts";
import { handleApi } from "./api/handler.ts";

const ROOT = resolve(import.meta.dir, "..");
const MIGRATIONS_DIR = resolve(ROOT, "server/db/migrations");

const config = loadConfig();
const db = openDatabase(config.dbPath);
const result = runMigrationsFromDir(db, MIGRATIONS_DIR);
if (result.applied.length > 0) {
  console.log(`[dev-api] applied ${result.applied.length} migration(s) on startup`);
}

const apiPortValue = process.env.API_PORT ?? "2634";
const apiPort = Number.parseInt(apiPortValue, 10);
if (!Number.isInteger(apiPort) || apiPort <= 0 || apiPort > 65535) {
  throw new Error(`Invalid API_PORT="${apiPortValue}"`);
}

const server = Bun.serve({
  port: apiPort,
  hostname: config.host,
  idleTimeout: 30,
  async fetch(req) {
    const response = await handleApi(req, { db });
    if (response) return response;
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[dev-api] serving on http://${server.hostname}:${server.port} (db: ${config.dbPath})`);
