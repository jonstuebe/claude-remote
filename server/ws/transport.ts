import type { ServerWebSocket } from "bun";
import type { SessionManager } from "../sessions/manager.ts";
import type { SessionEvent } from "../sessions/types.ts";
import type { MetaBroadcastMessage, MetaBroadcaster } from "./meta-broadcaster.ts";

export type WsClientMessage =
  | { kind: "user_message"; text: string }
  | { kind: "stop" }
  | { kind: "ping" };

export type WsServerMessage =
  | SessionEvent
  | MetaBroadcastMessage
  | { kind: "ping" }
  | { kind: "pong" }
  | { kind: "ready"; conversation_id: string };

export type WsAttachment = {
  conversationId: string;
  unsubscribe?: () => void;
  unsubscribeMeta?: () => void;
  heartbeat?: ReturnType<typeof setInterval>;
};

const HEARTBEAT_INTERVAL_MS = 20_000;

export function attachWebSocket(
  ws: ServerWebSocket<WsAttachment>,
  conversationId: string,
  manager: SessionManager,
  meta: MetaBroadcaster,
): WsAttachment {
  const send = (message: WsServerMessage): void => {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // socket may be closed mid-send
    }
  };

  const unsubscribe = manager.subscribe(conversationId, send);
  const unsubscribeMeta = meta.subscribe(conversationId, send);
  for (const event of manager.bufferedEvents(conversationId)) {
    send(event);
  }
  send({ kind: "ready", conversation_id: conversationId });

  const heartbeat = setInterval(() => {
    send({ kind: "ping" });
  }, HEARTBEAT_INTERVAL_MS);

  return { conversationId, unsubscribe, unsubscribeMeta, heartbeat };
}

export function detachWebSocket(attachment: WsAttachment): void {
  if (attachment.heartbeat !== undefined) clearInterval(attachment.heartbeat);
  attachment.unsubscribe?.();
  attachment.unsubscribeMeta?.();
}

export function parseClientMessage(raw: string | Buffer): WsClientMessage | null {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else {
    text = raw.toString("utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.kind === "user_message" && typeof obj.text === "string") {
    return { kind: "user_message", text: obj.text };
  }
  if (obj.kind === "stop") return { kind: "stop" };
  if (obj.kind === "ping") return { kind: "ping" };
  return null;
}

export async function handleClientMessage(
  message: WsClientMessage,
  conversationId: string,
  manager: SessionManager,
  ws: ServerWebSocket<WsAttachment>,
): Promise<void> {
  if (message.kind === "user_message") {
    try {
      await manager.send(conversationId, message.text);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      ws.send(JSON.stringify({ kind: "error", message: text }));
    }
    return;
  }
  if (message.kind === "stop") {
    await manager.stop(conversationId);
    return;
  }
  if (message.kind === "ping") {
    ws.send(JSON.stringify({ kind: "pong" }));
    return;
  }
}
