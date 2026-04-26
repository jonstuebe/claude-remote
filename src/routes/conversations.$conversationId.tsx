import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, GitBranch, Loader2, SendHorizonal, Wifi, WifiOff } from "lucide-react";
import { cn } from "../lib/cn";
import {
  ApiRequestError,
  getConversation,
  getConversationMessages,
  sendConversationMessage,
  updateConversation,
  type AssistantBlock,
  type Conversation,
  type TranscriptMessage,
} from "../lib/api";
import {
  connectConversationWs,
  type ConnectionState,
  type ConversationWs,
  type WsServerEvent,
} from "../lib/conversation-ws";
import { COLOR_SWATCHES, isConversationColor, parseServerHandled } from "../lib/slash-commands";

export const Route = createFileRoute("/conversations/$conversationId")({
  component: ConversationRoute,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; conversation: Conversation }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function ConversationRoute() {
  const { conversationId } = Route.useParams();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [connState, setConnState] = useState<ConnectionState>("connecting");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const wsRef = useRef<ConversationWs | null>(null);
  const seenUuids = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [conversation, history] = await Promise.all([
          getConversation(conversationId),
          getConversationMessages(conversationId),
        ]);
        if (cancelled) return;
        seenUuids.current = new Set(history.map((m) => m.uuid));
        setLoad({ kind: "ok", conversation });
        setMessages(history);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 404) {
          setLoad({ kind: "not_found" });
          return;
        }
        setLoad({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load conversation",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const ws = connectConversationWs(conversationId, {
      onState: setConnState,
      onEvent: (event) => handleWsEvent(event),
    });
    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };

    function handleWsEvent(event: WsServerEvent): void {
      if (event.kind === "ready" || event.kind === "session_init" || event.kind === "pong") return;
      if (event.kind === "session_end") return;
      if (event.kind === "conversation_meta_updated") {
        setLoad((prev) =>
          prev.kind === "ok" && prev.conversation.id === event.conversation.id
            ? { kind: "ok", conversation: event.conversation }
            : prev,
        );
        return;
      }
      if (event.kind === "conversation_deleted" && event.conversation_id === conversationId) {
        setLoad({ kind: "not_found" });
        return;
      }
      if (event.kind === "error") {
        setErrorBanner(event.message);
        return;
      }
      if (
        event.kind === "user_message" ||
        event.kind === "assistant_message" ||
        event.kind === "tool_result" ||
        event.kind === "system"
      ) {
        const uuid = event.uuid;
        if (!uuid) return;
        if (seenUuids.current.has(uuid)) return;
        seenUuids.current.add(uuid);
        setMessages((prev) => [...prev, event as TranscriptMessage]);
      }
    }
  }, [conversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setErrorBanner(null);
    try {
      const serverHandled = parseServerHandled(text);
      if (serverHandled) {
        if (!serverHandled.ok) {
          setErrorBanner(serverHandled.error);
          return;
        }
        const input =
          serverHandled.action.kind === "rename"
            ? { title: serverHandled.action.title }
            : { color: serverHandled.action.color };
        const conversation = await updateConversation(conversationId, input);
        setLoad({ kind: "ok", conversation });
        setDraft("");
        return;
      }

      await sendConversationMessage(conversationId, text);
      const optimistic: TranscriptMessage = {
        kind: "user_message",
        uuid: `local-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        text,
      };
      seenUuids.current.add(optimistic.uuid);
      setMessages((prev) => [...prev, optimistic]);
      setDraft("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      setErrorBanner(message);
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, sending]);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-5 py-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        {load.kind === "ok" ? (
          <Link
            to="/projects/$projectId"
            params={{ projectId: load.conversation.project_id }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span>Back</span>
          </Link>
        ) : (
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span>Projects</span>
          </Link>
        )}
        <ConnectionPill state={connState} />
      </header>

      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}

      {load.kind === "not_found" && (
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-sm">
          <h1 className="text-lg font-semibold">Conversation not found</h1>
        </div>
      )}

      {load.kind === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {load.message}
        </div>
      )}

      {load.kind === "ok" && (
        <>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <ConversationColorDot conversation={load.conversation} />
              <h1 className="truncate text-lg font-semibold">{load.conversation.title}</h1>
            </div>
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <GitBranch className="size-3" aria-hidden />
              <span className="font-mono">{load.conversation.branch}</span>
            </div>
          </div>

          {errorBanner && (
            <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {errorBanner}
            </div>
          )}

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto rounded-2xl border border-border/60 bg-card p-4"
          >
            {messages.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Send a message to start the conversation.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((m) => (
                  <MessageItem key={m.uuid} message={m} />
                ))}
              </ul>
            )}
          </div>

          <Composer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            sending={sending}
            disabled={connState !== "open"}
          />
        </>
      )}
    </main>
  );
}

function ConversationColorDot({ conversation }: { conversation: Conversation }) {
  if (!conversation.color || !isConversationColor(conversation.color)) return null;
  return (
    <span
      className={cn("size-3 shrink-0 rounded-full", COLOR_SWATCHES[conversation.color])}
      aria-label={`${conversation.color} conversation`}
    />
  );
}

function ConnectionPill({ state }: { state: ConnectionState }) {
  if (state === "open") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Wifi className="size-3" aria-hidden />
        <span>Live</span>
      </span>
    );
  }
  if (state === "connecting") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        <span>Connecting</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
      <WifiOff className="size-3" aria-hidden />
      <span>Reconnecting</span>
    </span>
  );
}

function MessageItem({ message }: { message: TranscriptMessage }) {
  if (message.kind === "user_message") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.text}
        </div>
      </li>
    );
  }
  if (message.kind === "assistant_message") {
    return (
      <li className="flex justify-start">
        <div className="max-w-[85%] space-y-2 rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm">
          {message.blocks.map((block, idx) => (
            <AssistantBlockView key={idx} block={block} />
          ))}
        </div>
      </li>
    );
  }
  if (message.kind === "tool_result") {
    return (
      <li className="flex justify-start">
        <div
          className={cn(
            "max-w-[85%] rounded-lg border px-3 py-1.5 font-mono text-xs",
            message.is_error
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border/60 bg-background/40 text-muted-foreground",
          )}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wide opacity-70">
            tool result · {message.tool_use_id.slice(0, 8)}
          </div>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap wrap-break-word">
            {truncate(message.content, 1200)}
          </pre>
        </div>
      </li>
    );
  }
  if (message.kind === "system" && message.text.length > 0) {
    return (
      <li className="flex justify-center">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {message.subtype}
        </span>
      </li>
    );
  }
  return null;
}

function AssistantBlockView({ block }: { block: AssistantBlock }) {
  if (block.type === "text") {
    return <p className="whitespace-pre-wrap">{block.text}</p>;
  }
  if (block.type === "thinking") {
    return (
      <p className="whitespace-pre-wrap rounded-md bg-background/40 p-2 text-xs italic text-muted-foreground">
        {block.text}
      </p>
    );
  }
  return (
    <div className="rounded-md bg-background/40 px-2 py-1.5 font-mono text-xs">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        tool · {block.name}
      </div>
      <pre className="mt-1 whitespace-pre-wrap wrap-break-word text-muted-foreground">
        {truncate(JSON.stringify(block.input, null, 2), 400)}
      </pre>
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled: boolean;
}) {
  return (
    <form
      className="mt-3 flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSend();
          }
        }}
        rows={2}
        placeholder="Send a message…"
        className="min-h-12 flex-1 resize-y rounded-2xl border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
      <button
        type="submit"
        disabled={sending || value.trim().length === 0 || disabled}
        aria-label="Send message"
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <SendHorizonal className="size-5" aria-hidden />
        )}
      </button>
    </form>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated ${text.length - max} chars)`;
}
