import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  GitBranch,
  Loader2,
  SendHorizonal,
  SquareTerminal,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "../lib/cn";
import { Markdown } from "../components/markdown";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "../components/prompt-input";
import { Tool, type ToolPart } from "../components/tool";
import { useIsTouch } from "../hooks/use-is-touch";
import {
  ApiRequestError,
  getConversation,
  getConversationMessages,
  listAgents,
  listSlashCommands,
  openConversationInTerminal,
  sendConversationMessage,
  updateConversation,
  type AssistantBlock,
  type AgentInfo,
  type Conversation,
  type SlashCommand,
  type TranscriptMessage,
} from "../lib/api";
import {
  connectConversationWs,
  type ConnectionState,
  type ConversationWs,
  type WsServerEvent,
} from "../lib/conversation-ws";
import { COLOR_SWATCHES, isConversationColor, parseServerHandled } from "../lib/slash-commands";
import { isDiffToolBlock, ToolDiff } from "../components/tool-diff";

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
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sending, setSending] = useState(false);
  const [inputLocked, setInputLocked] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const wsRef = useRef<ConversationWs | null>(null);
  const seenUuids = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const toolResults = useMemo(() => buildToolResultMap(messages), [messages]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [conversation, history] = await Promise.all([
          getConversation(conversationId),
          getConversationMessages(conversationId),
        ]);
        if (cancelled) return;
        seenUuids.current = new Set(history.filter((m) => "uuid" in m).map((m) => m.uuid));
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
    if (load.kind !== "ok") return;
    let cancelled = false;
    void (async () => {
      try {
        const [commands, agentList] = await Promise.all([
          listSlashCommands(load.conversation.project_id),
          listAgents(load.conversation.project_id),
        ]);
        if (!cancelled) {
          setSlashCommands(commands);
          setAgents(agentList);
        }
      } catch {
        if (!cancelled) {
          setSlashCommands([]);
          setAgents([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

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
      if (event.kind === "permission_request") {
        setInputLocked(true);
        setMessages((prev) => [...prev, event]);
        return;
      }
      if (event.kind === "permission_decision") {
        setInputLocked(event.input_locked);
        setMessages((prev) =>
          prev.map((message) =>
            message.kind === "permission_request" && message.id === event.id ? event : message,
          ),
        );
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
    if (text.length === 0 || sending || inputLocked) return;
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
      if (
        err instanceof ApiRequestError &&
        err.body.code === "takeover_required" &&
        window.confirm(err.body.message)
      ) {
        try {
          await sendConversationMessage(conversationId, text, true);
          setDraft("");
          return;
        } catch (retryErr) {
          setErrorBanner(retryErr instanceof Error ? retryErr.message : "Send failed");
          return;
        }
      }
      const message = err instanceof Error ? err.message : "Send failed";
      setErrorBanner(message);
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, inputLocked, sending]);

  const handlePermissionDecision = useCallback(
    (id: string, decision: "allow" | "deny" | "allow_for_session") => {
      wsRef.current?.decidePermission(id, decision);
    },
    [],
  );

  const handleOpenTerminal = useCallback(async () => {
    try {
      await openConversationInTerminal(conversationId);
      setErrorBanner("Opened in terminal on the host machine.");
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to open terminal");
    }
  }, [conversationId]);

  return (
    <main className="flex h-dvh flex-col px-5 py-4">
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
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ConversationColorDot conversation={load.conversation} />
                  <h1 className="truncate text-lg font-semibold">{load.conversation.title}</h1>
                </div>
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <GitBranch className="size-3" aria-hidden />
                  <span className="font-mono">{load.conversation.branch}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleOpenTerminal()}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium transition hover:bg-accent"
              >
                <SquareTerminal className="size-4" aria-hidden />
                <span>Open in terminal</span>
              </button>
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
                  <MessageItem
                    key={messageKey(m)}
                    message={m}
                    toolResults={toolResults}
                    onPermissionDecision={handlePermissionDecision}
                  />
                ))}
              </ul>
            )}
          </div>

          <Composer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            sending={sending}
            disabled={connState !== "open" || inputLocked}
            locked={inputLocked}
            suggestions={slashSuggestions(draft, slashCommands)}
            agentMatches={agentSuggestions(draft, agents)}
            onSuggestionSelect={(command) => {
              setDraft(`/${command.name}${command.argumentHint ? " " : ""}`);
            }}
            onAgentSelect={(agent) => setDraft(insertAgentMention(draft, agent.name))}
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

function messageKey(message: TranscriptMessage): string {
  if ("uuid" in message) return message.uuid;
  return `${message.kind}-${message.id}`;
}

function MessageItem({
  message,
  toolResults,
  onPermissionDecision,
}: {
  message: TranscriptMessage;
  toolResults: Map<string, Extract<TranscriptMessage, { kind: "tool_result" }>>;
  onPermissionDecision: (id: string, decision: "allow" | "deny" | "allow_for_session") => void;
}) {
  if (message.kind === "user_message") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          <Markdown>{message.text}</Markdown>
        </div>
      </li>
    );
  }
  if (message.kind === "assistant_message") {
    return (
      <li className="flex justify-start">
        <div className="max-w-[85%] space-y-2 rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm">
          {message.blocks.map((block, idx) => (
            <AssistantBlockView key={idx} block={block} toolResults={toolResults} />
          ))}
        </div>
      </li>
    );
  }
  if (message.kind === "tool_result") {
    // Tool results are rendered inline within their matching tool_use card
    // (see AssistantBlockView -> <Tool>), or by ToolDiff for diff-style tools.
    return null;
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
  if (message.kind === "permission_request") {
    return (
      <li className="flex justify-start">
        <div className="max-w-[95%] rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Permission required</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {message.tool} · {message.riskLevel} risk
              </div>
            </div>
          </div>
          <p className="mt-2 text-sm">{message.summary}</p>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2 font-mono text-xs text-muted-foreground">
            {truncate(JSON.stringify(message.input, null, 2), 1200)}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onPermissionDecision(message.id, "allow")}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => onPermissionDecision(message.id, "allow_for_session")}
              className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium"
            >
              Allow for session
            </button>
            <button
              type="button"
              onClick={() => onPermissionDecision(message.id, "deny")}
              className="rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive"
            >
              Deny
            </button>
          </div>
        </div>
      </li>
    );
  }
  if (message.kind === "permission_decision") {
    const text =
      message.decision === "allow_for_session"
        ? "Allowed for session"
        : message.decision === "allow"
          ? "Allowed"
          : "Denied";
    return (
      <li className="flex justify-start">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {text}
        </span>
      </li>
    );
  }
  return null;
}

function AssistantBlockView({
  block,
  toolResults,
}: {
  block: AssistantBlock;
  toolResults: Map<string, Extract<TranscriptMessage, { kind: "tool_result" }>>;
}) {
  if (block.type === "text") {
    return <Markdown>{block.text}</Markdown>;
  }
  if (block.type === "thinking") {
    return (
      <p className="whitespace-pre-wrap rounded-md bg-background/40 p-2 text-xs italic text-muted-foreground">
        {block.text}
      </p>
    );
  }
  if (isDiffToolBlock(block)) {
    return <ToolDiff block={block} result={toolResults.get(block.id)} />;
  }
  const result = toolResults.get(block.id);
  const toolPart: ToolPart = {
    type: block.name,
    state: result ? (result.is_error ? "output-error" : "output-available") : "input-available",
    input: block.input,
    output: result ? truncate(result.content, 4000) : undefined,
    toolCallId: block.id,
    errorText: result?.is_error ? truncate(result.content, 4000) : undefined,
  };
  return <Tool toolPart={toolPart} />;
}

function Composer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  locked,
  suggestions,
  agentMatches,
  onSuggestionSelect,
  onAgentSelect,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled: boolean;
  locked: boolean;
  suggestions: SlashCommand[];
  agentMatches: AgentInfo[];
  onSuggestionSelect: (command: SlashCommand) => void;
  onAgentSelect: (agent: AgentInfo) => void;
}) {
  const showSlash = suggestions.length > 0;
  const showAgents = !showSlash && agentMatches.length > 0;
  const isTouch = useIsTouch();
  const sendDisabled = sending || value.trim().length === 0 || disabled || locked;
  return (
    <div className="relative mt-3">
      {showSlash && (
        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-2xl border border-border/70 bg-popover p-2 shadow-lg">
          {suggestions.map((command) => (
            <button
              key={command.name}
              type="button"
              onClick={() => onSuggestionSelect(command)}
              className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="font-mono">/{command.name}</span>
                {command.description && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {command.description}
                  </span>
                )}
              </span>
              {command.argumentHint && (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {command.argumentHint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {showAgents && (
        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-2xl border border-border/70 bg-popover p-2 shadow-lg">
          {agentMatches.map((agent) => (
            <button
              key={`${agent.source}:${agent.name}`}
              type="button"
              onClick={() => onAgentSelect(agent)}
              className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="font-mono">@{agent.name}</span>
                {agent.description && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {agent.description}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{agent.source}</span>
            </button>
          ))}
        </div>
      )}
      <PromptInput
        value={value}
        onValueChange={onChange}
        onSubmit={() => {
          if (!sendDisabled) onSend();
        }}
        isLoading={sending}
        disabled={locked}
      >
        <PromptInputTextarea
          placeholder={locked ? "Answer the permission request to continue…" : "Send a message…"}
          disableSubmitOnEnter={isTouch}
        />
        <PromptInputActions className="justify-end pt-2">
          <PromptInputAction tooltip={sending ? "Sending…" : "Send message"}>
            <button
              type="button"
              onClick={onSend}
              disabled={sendDisabled}
              aria-label="Send message"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <SendHorizonal className="size-4" aria-hidden />
              )}
            </button>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>
    </div>
  );
}

function slashSuggestions(value: string, commands: SlashCommand[]): SlashCommand[] {
  if (!value.startsWith("/")) return [];
  const query = value.slice(1).split(/\s/, 1)[0]?.toLowerCase() ?? "";
  if (value.includes(" ") && query.length > 0) return [];
  return commands
    .filter(
      (command) =>
        command.name.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query),
    )
    .slice(0, 8);
}

function agentSuggestions(value: string, agents: AgentInfo[]): AgentInfo[] {
  const match = /(^|\s)@([a-zA-Z0-9_-]*)$/.exec(value);
  if (!match) return [];
  const query = match[2]?.toLowerCase() ?? "";
  return agents
    .filter(
      (agent) =>
        agent.name.toLowerCase().includes(query) ||
        agent.description.toLowerCase().includes(query),
    )
    .slice(0, 8);
}

function insertAgentMention(value: string, name: string): string {
  return value.replace(/(^|\s)@([a-zA-Z0-9_-]*)$/, (_match, prefix: string) => `${prefix}@${name} `);
}

function buildToolResultMap(
  messages: TranscriptMessage[],
): Map<string, Extract<TranscriptMessage, { kind: "tool_result" }>> {
  const results = new Map<string, Extract<TranscriptMessage, { kind: "tool_result" }>>();
  for (const message of messages) {
    if (message.kind === "tool_result") results.set(message.tool_use_id, message);
  }
  return results;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated ${text.length - max} chars)`;
}
