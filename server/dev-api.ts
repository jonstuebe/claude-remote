import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/client.ts";
import { runMigrationsFromDir } from "./db/migrator.ts";
import { handleApi } from "./api/handler.ts";
import { SessionManager } from "./sessions/manager.ts";
import { sdkSpawner } from "./sessions/sdk-spawner.ts";
import {
  attachWebSocket,
  detachWebSocket,
  handleClientMessage,
  parseClientMessage,
  type WsAttachment,
} from "./ws/transport.ts";
import { MetaBroadcaster } from "./ws/meta-broadcaster.ts";
import { reconcileAllProjects } from "./reconciler.ts";
import { defaultPermissionDenylist, PermissionBroker } from "./permissions/broker.ts";
import { SettingsManager } from "./settings/manager.ts";

const ROOT = resolve(import.meta.dir, "..");
const MIGRATIONS_DIR = resolve(ROOT, "server/db/migrations");

const config = loadConfig();
const db = openDatabase(config.dbPath);
const result = runMigrationsFromDir(db, MIGRATIONS_DIR);
if (result.applied.length > 0) {
  console.log(`[dev-api] applied ${result.applied.length} migration(s) on startup`);
}

const meta = new MetaBroadcaster();
const settings = new SettingsManager();
await settings.initialize();
let sessions: SessionManager;
const permissions = new PermissionBroker({
  denylist: defaultPermissionDenylist(),
  emit: (conversationId, event) => sessions.emit(conversationId, event),
});
sessions = new SessionManager({ db, spawner: sdkSpawner, permissions });
const pruned = sessions.pruneStaleEntries();
if (pruned > 0) {
  console.log(`[dev-api] pruned ${pruned} stale session_ledger entr${pruned === 1 ? "y" : "ies"}`);
}
await reconcileAllProjects(db);

const apiPortValue = process.env.API_PORT ?? "2634";
const apiPort = Number.parseInt(apiPortValue, 10);
if (!Number.isInteger(apiPort) || apiPort <= 0 || apiPort > 65535) {
  throw new Error(`Invalid API_PORT="${apiPortValue}"`);
}

const WS_PATTERN = /^\/api\/conversations\/([^/]+)\/ws\/?$/;

const server = Bun.serve<WsAttachment>({
  port: apiPort,
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
    const response = await handleApi(req, { db, sessions, meta, settings });
    if (response) return response;
    return new Response("Not Found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const populated = attachWebSocket(ws, ws.data.conversationId, sessions, meta);
      ws.data.unsubscribe = populated.unsubscribe;
      ws.data.unsubscribeMeta = populated.unsubscribeMeta;
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

console.log(`[dev-api] serving on http://${server.hostname}:${server.port} (db: ${config.dbPath})`);
