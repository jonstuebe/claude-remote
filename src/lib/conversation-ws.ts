import type { AssistantBlock } from "./api";
import type { Conversation } from "./api";

export type WsServerEvent =
  | { kind: "ready"; conversation_id: string }
  | { kind: "session_init"; sdk_session_id: string }
  | { kind: "user_message"; uuid: string; ts: string; text: string }
  | { kind: "assistant_message"; uuid: string; ts: string; blocks: AssistantBlock[] }
  | {
      kind: "tool_result";
      uuid: string;
      ts: string;
      tool_use_id: string;
      content: string;
      is_error: boolean;
    }
  | { kind: "system"; uuid: string; ts: string; subtype: string; text: string }
  | {
      kind: "permission_request";
      id: string;
      tool: string;
      input: Record<string, unknown>;
      summary: string;
      riskLevel: "medium" | "high";
      input_locked: boolean;
    }
  | {
      kind: "permission_decision";
      id: string;
      decision: "allow" | "deny" | "allow_for_session";
      input_locked: boolean;
    }
  | { kind: "conversation_meta_updated"; conversation: Conversation }
  | { kind: "conversation_deleted"; conversation_id: string }
  | { kind: "error"; message: string }
  | { kind: "session_end"; reason: string }
  | { kind: "ping" }
  | { kind: "pong" };

export type ConnectionState = "connecting" | "open" | "closed";

export type ConversationWsHandlers = {
  onEvent: (event: WsServerEvent) => void;
  onState: (state: ConnectionState) => void;
};

export type ConversationWs = {
  send(text: string): void;
  decidePermission(id: string, decision: "allow" | "deny" | "allow_for_session"): void;
  close(): void;
};

const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5_000;

function buildWsUrl(conversationId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const path = `/api/conversations/${encodeURIComponent(conversationId)}/ws`;
  // Vite's HTTP proxy hangs on WebSocket upgrades, so in dev we hit the API port
  // directly. In prod the API and the static frontend are served from the same origin.
  if (import.meta.env.DEV) {
    const apiPort = import.meta.env.VITE_API_PORT ?? "2634";
    return `${protocol}//${window.location.hostname}:${apiPort}${path}`;
  }
  return `${protocol}//${window.location.host}${path}`;
}

export function connectConversationWs(
  conversationId: string,
  handlers: ConversationWsHandlers,
): ConversationWs {
  let socket: WebSocket | null = null;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;

  const open = (): void => {
    if (closedByUser) return;
    handlers.onState("connecting");
    const ws = new WebSocket(buildWsUrl(conversationId));
    socket = ws;

    ws.addEventListener("open", () => {
      backoff = INITIAL_BACKOFF_MS;
      handlers.onState("open");
    });

    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsServerEvent;
        if (parsed.kind === "ping") {
          ws.send(JSON.stringify({ kind: "ping" }));
          return;
        }
        handlers.onEvent(parsed);
      } catch {
        // ignore malformed
      }
    });

    ws.addEventListener("close", () => {
      socket = null;
      if (closedByUser) {
        handlers.onState("closed");
        return;
      }
      handlers.onState("closed");
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        open();
      }, backoff);
    });

    ws.addEventListener("error", () => {
      // close handler will run; nothing else to do
    });
  };

  open();

  return {
    send(text: string): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ kind: "user_message", text }));
      }
    },
    decidePermission(id, decision): void {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ kind: "permission_decision", id, decision }));
      }
    },
    close(): void {
      closedByUser = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.close();
        socket = null;
      }
    },
  };
}
