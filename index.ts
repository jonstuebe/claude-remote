import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { loadConfig } from "./server/config.ts";
import { openDatabase } from "./server/db/client.ts";
import { runMigrationsFromDir } from "./server/db/migrator.ts";
import { handleApi } from "./server/api/handler.ts";
import { SessionManager } from "./server/sessions/manager.ts";
import { sdkSpawner } from "./server/sessions/sdk-spawner.ts";
import {
  attachWebSocket,
  detachWebSocket,
  handleClientMessage,
  parseClientMessage,
  type WsAttachment,
} from "./server/ws/transport.ts";

const ROOT = import.meta.dir;
const MIGRATIONS_DIR = resolve(ROOT, "server/db/migrations");
const CLIENT_DIR = resolve(ROOT, "dist/client");
const SERVER_ENTRY = resolve(ROOT, "dist/server/server.js");

const config = loadConfig();

const db = openDatabase(config.dbPath);
const result = runMigrationsFromDir(db, MIGRATIONS_DIR);
if (result.applied.length > 0) {
  console.log(`[db] applied ${result.applied.length} migration(s) on startup`);
}

const sessions = new SessionManager({ db, spawner: sdkSpawner });
const pruned = sessions.pruneStaleEntries();
if (pruned > 0) {
  console.log(`[db] pruned ${pruned} stale session_ledger entr${pruned === 1 ? "y" : "ies"}`);
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

const WS_PATTERN = /^\/api\/conversations\/([^/]+)\/ws\/?$/;

const server = Bun.serve<WsAttachment>({
  port: config.port,
  hostname: config.host,
  idleTimeout: 30,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const wsMatch = WS_PATTERN.exec(url.pathname);
    if (wsMatch) {
      const conversationId = decodeURIComponent(wsMatch[1]!);
      const data: WsAttachment = { conversationId };
      const upgraded = srv.upgrade(req, { data });
      if (upgraded) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 426 });
    }

    const apiResponse = await handleApi(req, { db, sessions });
    if (apiResponse) return apiResponse;

    const asset = await serveStatic(url.pathname);
    if (asset) return asset;
    return ssr.default.fetch(req);
  },
  websocket: {
    open(ws) {
      const populated = attachWebSocket(ws, ws.data.conversationId, sessions);
      ws.data.unsubscribe = populated.unsubscribe;
      ws.data.heartbeat = populated.heartbeat;
    },
    message: async (ws, raw) => {
      const message = parseClientMessage(raw);
      if (!message) return;
      await handleClientMessage(message, ws.data.conversationId, sessions, ws);
    },
    close(ws) {
      detachWebSocket(ws.data);
    },
  },
});

console.log(
  `[claude-remote] serving on http://${server.hostname}:${server.port} (db: ${config.dbPath})`,
);
