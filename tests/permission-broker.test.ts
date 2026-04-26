import { describe, expect, test } from "vitest";
import {
  PermissionBroker,
  type PermissionDenylistRule,
  type PermissionDecision,
} from "../server/permissions/broker.ts";
import type { SessionEvent } from "../server/sessions/types.ts";

const denyDangerousBash: PermissionDenylistRule[] = [
  { tool: "Bash", inputPattern: /rm -rf/, riskLevel: "high" },
];

function makeBroker(timeoutMs = 50) {
  const events: Array<{ conversationId: string; event: SessionEvent }> = [];
  const broker = new PermissionBroker({
    denylist: denyDangerousBash,
    timeoutMs,
    emit: (conversationId, event) => events.push({ conversationId, event }),
  });
  return { broker, events };
}

function latestRequest(events: Array<{ event: SessionEvent }>) {
  const event = events.find((item) => item.event.kind === "permission_request")?.event;
  if (!event || event.kind !== "permission_request") throw new Error("no permission request");
  return event;
}

describe("PermissionBroker", () => {
  test("auto-allows unmatched tools in bypassPermissions mode", async () => {
    const { broker, events } = makeBroker();

    const result = await broker.canUseTool("conv", "bypassPermissions", "Read", {
      file_path: "README.md",
    });

    expect(result).toEqual({ behavior: "allow" });
    expect(events).toEqual([]);
  });

  test("escalates denylist matches and resolves an allow decision", async () => {
    const { broker, events } = makeBroker();

    const pending = broker.canUseTool("conv", "bypassPermissions", "Bash", {
      command: "rm -rf tmp",
    });
    const request = latestRequest(events);

    expect(request).toMatchObject({
      tool: "Bash",
      summary: "rm -rf tmp",
      riskLevel: "high",
      input_locked: true,
    });

    expect(broker.resolve(request.id, "allow")).toBe(true);
    await expect(pending).resolves.toEqual({ behavior: "allow" });
    expect(events.at(-1)?.event).toMatchObject({
      kind: "permission_decision",
      decision: "allow",
      input_locked: false,
    });
  });

  test("allow for session suppresses matching future requests", async () => {
    const { broker, events } = makeBroker();
    const input = { command: "rm -rf tmp" };

    const first = broker.canUseTool("conv", "bypassPermissions", "Bash", input);
    const request = latestRequest(events);
    broker.resolve(request.id, "allow_for_session");
    await first;

    const second = await broker.canUseTool("conv", "bypassPermissions", "Bash", input);

    expect(second).toEqual({ behavior: "allow" });
    expect(events.filter((item) => item.event.kind === "permission_request")).toHaveLength(1);
  });

  test("times out unanswered requests and emits a system message", async () => {
    const { broker, events } = makeBroker(10);

    const result = await broker.canUseTool("conv", "bypassPermissions", "Bash", {
      command: "rm -rf tmp",
    });

    expect(result).toMatchObject({ behavior: "deny", interrupt: true });
    expect(events.some((item) => item.event.kind === "permission_decision")).toBe(true);
    expect(events.some((item) => item.event.kind === "system")).toBe(true);
  });

  test("resolves concurrent requests in arbitrary order", async () => {
    const { broker, events } = makeBroker();

    const first = broker.canUseTool("conv", "bypassPermissions", "Bash", {
      command: "rm -rf a",
    });
    const second = broker.canUseTool("conv", "bypassPermissions", "Bash", {
      command: "rm -rf b",
    });
    const requests = events
      .map((item) => item.event)
      .filter((event) => event.kind === "permission_request");

    broker.resolve(requests[1]!.id, "deny");
    broker.resolve(requests[0]!.id, "allow");

    await expect(first).resolves.toEqual({ behavior: "allow" });
    await expect(second).resolves.toMatchObject({ behavior: "deny" });
  });

  test("pending request can be resolved after transport reconnect", async () => {
    const { broker, events } = makeBroker();
    const pending = broker.canUseTool("conv", "bypassPermissions", "Bash", {
      command: "rm -rf tmp",
    });
    const request = latestRequest(events);

    const decision: PermissionDecision = "deny";
    expect(broker.resolve(request.id, decision)).toBe(true);

    await expect(pending).resolves.toMatchObject({ behavior: "deny" });
  });
});
