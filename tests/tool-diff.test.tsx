// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ToolDiff } from "../src/components/tool-diff.tsx";
import type { AssistantBlock, TranscriptMessage } from "../src/lib/api.ts";

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => (
    <div data-testid="file-diff">{fileDiff.name}</div>
  ),
}));

afterEach(() => cleanup());

const result = (id = "tool-1", is_error = false): Extract<TranscriptMessage, { kind: "tool_result" }> => ({
  kind: "tool_result",
  uuid: `result-${id}`,
  ts: "2026-01-01T00:00:00.000Z",
  tool_use_id: id,
  content: is_error ? "failed" : "ok",
  is_error,
});

const tool = (name: string, input: Record<string, unknown>): AssistantBlock => ({
  type: "tool_use",
  id: "tool-1",
  name,
  input,
});

describe("ToolDiff", () => {
  test("renders Edit as a diff", () => {
    render(
      <ToolDiff
        block={tool("Edit", {
          file_path: "src/app.ts",
          old_string: "const a = 1;",
          new_string: "const a = 2;",
        })}
        result={result()}
      />,
    );

    expect(screen.getAllByText("src/app.ts").length).toBeGreaterThan(0);
    expect(screen.getByTestId("file-diff")).toBeTruthy();
  });

  test("renders MultiEdit as multiple diff blocks", () => {
    render(
      <ToolDiff
        block={tool("MultiEdit", {
          file_path: "src/app.ts",
          edits: [
            { old_string: "a", new_string: "b" },
            { old_string: "c", new_string: "d" },
          ],
        })}
        result={result()}
      />,
    );

    expect(screen.getAllByTestId("file-diff")).toHaveLength(2);
  });

  test("renders Write as a new-file diff", () => {
    render(
      <ToolDiff
        block={tool("Write", {
          file_path: "README.unknownext",
          content: "hello",
        })}
        result={result()}
      />,
    );

    expect(screen.getByText("Write")).toBeTruthy();
    expect(screen.getByTestId("file-diff")).toBeTruthy();
  });

  test("renders an error pill instead of a diff", () => {
    render(
      <ToolDiff
        block={tool("Edit", {
          file_path: "src/app.ts",
          old_string: "a",
          new_string: "b",
        })}
        result={result("tool-1", true)}
      />,
    );

    expect(screen.getByText(/Edit failed/)).toBeTruthy();
    expect(screen.queryByTestId("file-diff")).toBeNull();
  });

  test("shows a placeholder while waiting for the tool result", () => {
    render(
      <ToolDiff
        block={tool("Edit", {
          file_path: "src/app.ts",
          old_string: "a",
          new_string: "b",
        })}
      />,
    );

    expect(screen.getByText(/Waiting for Edit result/)).toBeTruthy();
  });
});
