import { describe, expect, test } from "vitest";
import {
  listServerHandledCommands,
  parseServerHandled,
} from "../server/slash-commands/registry.ts";

describe("Slash Command Registry", () => {
  test("contributes rename and color as server-handled commands", () => {
    const commands = listServerHandledCommands();

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "rename", kind: "server-handled" }),
        expect.objectContaining({ name: "color", kind: "server-handled" }),
      ]),
    );
  });

  test("parses rename and color actions without dispatching to the SDK", () => {
    expect(parseServerHandled("/rename Better title")).toEqual({
      ok: true,
      action: { kind: "rename", title: "Better title" },
    });
    expect(parseServerHandled("/color blue")).toEqual({
      ok: true,
      action: { kind: "color", color: "blue" },
    });
    expect(parseServerHandled("/color clear")).toEqual({
      ok: true,
      action: { kind: "color", color: null },
    });
  });

  test("returns validation feedback for malformed server-handled commands", () => {
    expect(parseServerHandled("/rename")).toMatchObject({ ok: false });
    expect(parseServerHandled("/color nope")).toMatchObject({ ok: false });
    expect(parseServerHandled("/effort high")).toBeNull();
  });
});
