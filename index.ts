import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { loadConfig } from "./server/config.ts";
import { openDatabase } from "./server/db/client.ts";
import { runMigrationsFromDir } from "./server/db/migrator.ts";

const ROOT = import.meta.dir;
const MIGRATIONS_DIR = resolve(ROOT, "server/db/migrations");
const CLIENT_DIR = resolve(ROOT, "dist/client");
const SERVER_ENTRY = resolve(ROOT, "dist/server/server.js");

const config = loadConfig();

const db = openDatabase(config.dbPath);
try {
  const result = runMigrationsFromDir(db, MIGRATIONS_DIR);
  if (result.applied.length > 0) {
    console.log(`[db] applied ${result.applied.length} migration(s) on startup`);
  }
} finally {
  db.close();
}

const ssr = (await import(SERVER_ENTRY)) as {
  default: { fetch(req: Request): Promise<Response> | Response };
};

async function serveStatic(pathname: string): Promise<Response | null> {
  const target = resolve(CLIENT_DIR, "." + pathname);
  if (!target.startsWith(CLIENT_DIR + "/") && target !== CLIENT_DIR) return null;

  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) return null;

  return new Response(Bun.file(target));
}

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url);
    const asset = await serveStatic(url.pathname);
    if (asset) return asset;
    return ssr.default.fetch(req);
  },
});

console.log(
  `[claude-remote] serving on http://${server.hostname}:${server.port} (db: ${config.dbPath})`,
);
