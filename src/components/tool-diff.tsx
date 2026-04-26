import { useMemo, useState } from "react";
import { processFile, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { AssistantBlock, TranscriptMessage } from "../lib/api";

type ToolResult = Extract<TranscriptMessage, { kind: "tool_result" }>;

export function isDiffToolBlock(block: AssistantBlock): boolean {
  return block.type === "tool_use" && ["Edit", "MultiEdit", "Write"].includes(block.name);
}

export function ToolDiff({ block, result }: { block: AssistantBlock; result?: ToolResult }) {
  const [expanded, setExpanded] = useState(false);
  const diffs = useMemo(() => (block.type === "tool_use" ? buildDiffs(block) : []), [block]);
  const totalLines = diffs.reduce((sum, diff) => sum + diff.lineCount, 0);
  const tooLong = totalLines > 200;
  const visibleDiffs = tooLong && !expanded ? diffs.slice(0, 1) : diffs;

  if (block.type !== "tool_use") return null;
  if (!result) {
    return (
      <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        Waiting for {block.name} result…
      </div>
    );
  }
  if (result.is_error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {block.name} failed: {result.content || "tool returned an error"}
      </div>
    );
  }
  if (diffs.length === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        {block.name} completed, but no diffable input was present.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/50 p-2">
      {visibleDiffs.map((diff, index) => (
        <div key={`${diff.filePath}-${index}`} className="overflow-hidden rounded-md border border-border/50">
          <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-muted/60 px-3 py-1.5 text-xs">
            <span className="truncate font-mono">{diff.filePath}</span>
            <span className="text-muted-foreground">{diff.label}</span>
          </div>
          <div className="overflow-x-auto text-xs [&_.diffs-file-diff]:min-w-full">
            <FileDiff
              fileDiff={diff.fileDiff}
              disableWorkerPool
              options={{ disableFileHeader: true }}
            />
          </div>
        </div>
      ))}
      {tooLong && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
        >
          {expanded ? "Show less" : `Show more (${totalLines} lines)`}
        </button>
      )}
    </div>
  );
}

type BuiltDiff = {
  filePath: string;
  label: string;
  lineCount: number;
  fileDiff: FileDiffMetadata;
};

function buildDiffs(block: Extract<AssistantBlock, { type: "tool_use" }>): BuiltDiff[] {
  const filePath = stringInput(block.input.file_path) ?? "unknown.txt";
  if (block.name === "Edit") {
    return buildOne(
      filePath,
      "Edit",
      stringInput(block.input.old_string),
      stringInput(block.input.new_string),
    );
  }
  if (block.name === "Write") {
    return buildOne(filePath, "Write", "", stringInput(block.input.content));
  }
  if (block.name === "MultiEdit" && Array.isArray(block.input.edits)) {
    return block.input.edits.flatMap((edit, index) => {
      if (!isRecord(edit)) return [];
      return buildOne(
        filePath,
        `Edit ${index + 1}`,
        stringInput(edit.old_string),
        stringInput(edit.new_string),
      );
    });
  }
  return [];
}

function buildOne(
  filePath: string,
  label: string,
  oldText: string | null,
  newText: string | null,
): BuiltDiff[] {
  if (oldText === null || newText === null) return [];
  const patch = createPatch(filePath, oldText, newText);
  const fileDiff = processFile(patch, { isGitDiff: true });
  if (!fileDiff) return [];
  return [{ filePath, label, lineCount: lineCount(oldText) + lineCount(newText), fileDiff }];
}

function createPatch(filePath: string, oldText: string, newText: string): string {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const oldCount = Math.max(oldLines.length, 1);
  const newCount = Math.max(newLines.length, 1);
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\n$/, "").split("\n");
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function stringInput(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
