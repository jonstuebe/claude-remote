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
