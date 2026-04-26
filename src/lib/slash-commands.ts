export const CONVERSATION_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
  "slate",
] as const;

export type ConversationColor = (typeof CONVERSATION_COLORS)[number];

export function isConversationColor(value: unknown): value is ConversationColor {
  return typeof value === "string" && (CONVERSATION_COLORS as readonly string[]).includes(value);
}

export type ServerHandledAction =
  | { kind: "rename"; title: string }
  | { kind: "color"; color: string | null };

export type ServerHandledParseResult =
  | { ok: true; action: ServerHandledAction }
  | { ok: false; error: string };

const COMMAND_PATTERN = /^\/([a-zA-Z][a-zA-Z0-9_:-]*)(?:\s+([\s\S]*))?$/;

export function parseSlashCommand(input: string): { name: string; rest: string } | null {
  const trimmed = input.trim();
  const match = COMMAND_PATTERN.exec(trimmed);
  if (!match) return null;
  return { name: match[1]!.toLowerCase(), rest: (match[2] ?? "").trim() };
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

export const COLOR_SWATCHES: Record<ConversationColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  slate: "bg-slate-500",
};
