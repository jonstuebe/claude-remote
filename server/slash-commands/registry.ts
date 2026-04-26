import { CONVERSATION_COLORS, isConversationColor } from "../conversations/palette.ts";

export type SlashCommandKind = "tui-replaced" | "server-handled" | "dispatched";

export type SlashCommand = {
  name: string;
  kind: SlashCommandKind;
  description: string;
  argumentHint: string;
};

const SERVER_HANDLED: SlashCommand[] = [
  {
    name: "rename",
    kind: "server-handled",
    description: "Rename the current conversation",
    argumentHint: "<title>",
  },
  {
    name: "color",
    kind: "server-handled",
    description: `Set the conversation color (${CONVERSATION_COLORS.join(", ")})`,
    argumentHint: "<color>",
  },
];

export type ServerHandledAction =
  | { kind: "rename"; title: string }
  | { kind: "color"; color: string | null };

export type ServerHandledParseResult =
  | { ok: true; action: ServerHandledAction }
  | { ok: false; error: string };

export function listServerHandledCommands(): SlashCommand[] {
  return SERVER_HANDLED.slice();
}

const COMMAND_PATTERN = /^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/;

export function parseSlashCommand(input: string): { name: string; rest: string } | null {
  const trimmed = input.trim();
  const match = COMMAND_PATTERN.exec(trimmed);
  if (!match) return null;
  return { name: match[1]!.toLowerCase(), rest: (match[2] ?? "").trim() };
}

export function isServerHandled(name: string): boolean {
  return SERVER_HANDLED.some((c) => c.name === name);
}

export function parseServerHandled(input: string): ServerHandledParseResult | null {
  const parsed = parseSlashCommand(input);
  if (!parsed) return null;
  if (parsed.name === "rename") {
    if (parsed.rest.length === 0) {
      return { ok: false, error: "Usage: /rename <title>" };
    }
    return { ok: true, action: { kind: "rename", title: parsed.rest } };
  }
  if (parsed.name === "color") {
    const value = parsed.rest.toLowerCase();
    if (value.length === 0 || value === "none" || value === "clear") {
      return { ok: true, action: { kind: "color", color: null } };
    }
    if (!isConversationColor(value)) {
      return {
        ok: false,
        error: `Unknown color "${parsed.rest}". Available: ${CONVERSATION_COLORS.join(", ")}`,
      };
    }
    return { ok: true, action: { kind: "color", color: value } };
  }
  return null;
}
