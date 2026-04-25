import type { AssistantBlock } from "./api";

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
  close(): void;
};

const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5_000;

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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/conversations/${encodeURIComponent(
      conversationId,
    )}/ws`;
    const ws = new WebSocket(url);
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
