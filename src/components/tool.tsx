import { Collapsible } from "@base-ui-components/react/collapsible";
import { CheckCircle, ChevronDown, Loader2, Settings, XCircle } from "lucide-react";
import { useState } from "react";

import { cn } from "../lib/cn";

// Adapted from prompt-kit (https://www.prompt-kit.com/docs/tool).
// The upstream depends on shadcn's <Button> + Radix Collapsible; this version
// uses Base UI's Collapsible and a plain <button> to match the project stack.

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export type ToolPart = {
  type: string;
  state: ToolState;
  input?: Record<string, unknown>;
  output?: unknown;
  toolCallId?: string;
  errorText?: string;
};

export type ToolProps = {
  toolPart: ToolPart;
  defaultOpen?: boolean;
  className?: string;
};

function StateIcon({ state }: { state: ToolState }) {
  switch (state) {
    case "input-streaming":
      return <Loader2 className="size-4 animate-spin text-blue-500" aria-hidden />;
    case "input-available":
      return <Settings className="size-4 text-orange-500" aria-hidden />;
    case "output-available":
      return <CheckCircle className="size-4 text-green-500" aria-hidden />;
    case "output-error":
      return <XCircle className="size-4 text-red-500" aria-hidden />;
  }
}

function StateBadge({ state }: { state: ToolState }) {
  const base = "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide";
  switch (state) {
    case "input-streaming":
      return (
        <span className={cn(base, "bg-blue-500/10 text-blue-600 dark:text-blue-400")}>
          Processing
        </span>
      );
    case "input-available":
      return (
        <span className={cn(base, "bg-orange-500/10 text-orange-600 dark:text-orange-400")}>
          Ready
        </span>
      );
    case "output-available":
      return (
        <span className={cn(base, "bg-green-500/10 text-green-600 dark:text-green-400")}>
          Completed
        </span>
      );
    case "output-error":
      return (
        <span className={cn(base, "bg-red-500/10 text-red-600 dark:text-red-400")}>Error</span>
      );
  }
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function Tool({ toolPart, defaultOpen = false, className }: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { state, input, output, toolCallId, errorText, type } = toolPart;
  const hasInput = input && Object.keys(input).length > 0;
  const hasOutput = output !== undefined && output !== null && output !== "";

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/60", className)}>
      <Collapsible.Root open={isOpen} onOpenChange={setIsOpen}>
        <Collapsible.Trigger
          render={(triggerProps) => (
            <button
              type="button"
              {...triggerProps}
              className="flex w-full items-center justify-between gap-2 bg-background/40 px-3 py-2 text-left transition hover:bg-background/60"
            >
              <span className="flex min-w-0 items-center gap-2">
                <StateIcon state={state} />
                <span className="truncate font-mono text-sm font-medium">{type}</span>
                <StateBadge state={state} />
              </span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          )}
        />
        <Collapsible.Panel
          className={cn(
            "overflow-hidden border-t border-border/60",
            // Base UI exposes height as a CSS var while open; tween it for a smooth open/close.
            "transition-[height] duration-200 ease-out",
            "h-[var(--collapsible-panel-height)]",
            "data-[starting-style]:h-0 data-[ending-style]:h-0",
          )}
        >
          <div className="space-y-3 bg-background/40 p-3">
            {hasInput && (
              <section>
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Input
                </h4>
                <div className="rounded-md border border-border/60 bg-background p-2 font-mono text-xs">
                  {Object.entries(input).map(([key, value]) => (
                    <div key={key} className="mb-1 last:mb-0">
                      <span className="text-muted-foreground">{key}:</span>{" "}
                      <span className="whitespace-pre-wrap break-words">{formatValue(value)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {hasOutput && state !== "output-error" && (
              <section>
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Output
                </h4>
                <pre className="max-h-60 overflow-auto rounded-md border border-border/60 bg-background p-2 font-mono text-xs whitespace-pre-wrap break-words">
                  {formatValue(output)}
                </pre>
              </section>
            )}

            {state === "output-error" && (errorText || hasOutput) && (
              <section>
                <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-red-500">
                  Error
                </h4>
                <pre className="max-h-60 overflow-auto rounded-md border border-red-500/30 bg-red-500/5 p-2 font-mono text-xs text-red-600 whitespace-pre-wrap break-words dark:text-red-400">
                  {errorText ?? formatValue(output)}
                </pre>
              </section>
            )}

            {state === "input-streaming" && (
              <p className="text-xs text-muted-foreground">Processing tool call…</p>
            )}

            {toolCallId && (
              <div className="border-t border-border/60 pt-2 font-mono text-[10px] text-muted-foreground">
                Call ID: {toolCallId}
              </div>
            )}
          </div>
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
