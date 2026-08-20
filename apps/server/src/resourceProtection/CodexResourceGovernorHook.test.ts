import * as NodeStream from "node:stream";

import { describe, expect, it } from "vite-plus/test";

import {
  codexResourceGovernorHookLaunchConfiguration,
  RESOURCE_PROTECTION_CONFIGURATION_ENV,
  RESOURCE_PROTECTION_TOKEN_ENV,
  RESOURCE_PROTECTION_URL_ENV,
  runCodexResourceGovernorHook,
} from "./CodexResourceGovernorHook.ts";

function hookInput(toolName: string): NodeStream.Readable {
  return NodeStream.Readable.from([
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "session-1",
      turn_id: "turn-1",
      tool_use_id: "tool-use-1",
      tool_name: toolName,
    }),
  ]);
}

function lifecycleHookInput(
  hookEventName: "UserPromptSubmit" | "Stop" | "SubagentStart" | "SubagentStop",
  input: { readonly turnId?: string; readonly agentId?: string } = {},
): NodeStream.Readable {
  return NodeStream.Readable.from([
    JSON.stringify({
      hook_event_name: hookEventName,
      session_id: "session-1",
      ...(input.turnId ? { turn_id: input.turnId } : {}),
      ...(input.agentId ? { agent_id: input.agentId } : {}),
    }),
  ]);
}

function hookEnvironment(): NodeJS.ProcessEnv {
  return {
    [RESOURCE_PROTECTION_URL_ENV]: "http://127.0.0.1:43123/internal/codex-admit",
    [RESOURCE_PROTECTION_TOKEN_ENV]: "secret-token",
    [RESOURCE_PROTECTION_CONFIGURATION_ENV]: "codex-config-key",
  };
}

describe("CodexResourceGovernorHook", () => {
  it("builds an additive synchronous PreToolUse hook for native subagent tools", () => {
    const configuration = codexResourceGovernorHookLaunchConfiguration({
      executablePath: "/opt/node 24/bin/node",
      serverEntryPath: "/opt/t3 code/bin.mjs",
    });

    expect(configuration?.globalArgs).toEqual(["--dangerously-bypass-hook-trust"]);
    expect(configuration?.appServerArgs[0]).toBe("-c");
    expect(configuration?.appServerArgs[1]).toContain("hooks.PreToolUse=");
    expect(configuration?.appServerArgs[1]).toContain("spawn_agent|Agent");
    expect(configuration?.appServerArgs[1]).toContain("Subagent wartet auf freien Speicher");
    expect(configuration?.appServerArgs[1]).toContain("resource-governor-hook");
    expect(configuration?.appServerArgs.join(" ")).toContain("hooks.UserPromptSubmit=");
    expect(configuration?.appServerArgs.join(" ")).toContain("hooks.Stop=");
    expect(configuration?.appServerArgs.join(" ")).toContain("hooks.SubagentStart=");
    expect(configuration?.appServerArgs.join(" ")).toContain("hooks.SubagentStop=");
  });

  it("holds root turns from prompt submission through Stop", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ admitted: true });
    };

    await runCodexResourceGovernorHook({
      input: lifecycleHookInput("UserPromptSubmit", { turnId: "turn-1" }),
      environment: hookEnvironment(),
      fetch: fetchImpl,
      write: () => undefined,
    });
    await runCodexResourceGovernorHook({
      input: lifecycleHookInput("Stop", { turnId: "turn-1" }),
      environment: hookEnvironment(),
      fetch: fetchImpl,
      write: () => undefined,
    });

    expect(requests).toEqual([
      {
        action: "admit-root-turn",
        configurationKey: "codex-config-key",
        lifecycleId: "turn-1",
      },
      { action: "release-root-turn", lifecycleId: "turn-1" },
    ]);
  });

  it("extracts lifecycle metadata without retaining an oversized prompt", async () => {
    const requests: Array<Record<string, unknown>> = [];
    await runCodexResourceGovernorHook({
      input: NodeStream.Readable.from([
        JSON.stringify({
          prompt: "x".repeat(128 * 1024),
          hook_event_name: "UserPromptSubmit",
          session_id: "session-oversized",
          turn_id: "turn-oversized",
        }),
      ]),
      environment: hookEnvironment(),
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ admitted: true });
      },
      write: () => undefined,
    });

    expect(requests).toEqual([
      {
        action: "admit-root-turn",
        configurationKey: "codex-config-key",
        lifecycleId: "turn-oversized",
      },
    ]);
  });

  it("confirms and releases native subagents by their stable agent id", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const output: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ admitted: true });
    };

    await runCodexResourceGovernorHook({
      input: lifecycleHookInput("SubagentStart", { agentId: "agent-1" }),
      environment: hookEnvironment(),
      fetch: fetchImpl,
      write: (value) => output.push(value),
    });
    await runCodexResourceGovernorHook({
      input: lifecycleHookInput("SubagentStop", { agentId: "agent-1" }),
      environment: hookEnvironment(),
      fetch: fetchImpl,
      write: (value) => output.push(value),
    });

    expect(requests).toEqual([
      {
        action: "confirm-subagent",
        configurationKey: "codex-config-key",
        agentId: "agent-1",
      },
      { action: "release-subagent", agentId: "agent-1" },
    ]);
    expect(output.map((value) => JSON.parse(value))).toEqual([{}, {}]);
  });

  it("waits through a transient endpoint failure and forwards the exact configuration", async () => {
    const output: string[] = [];
    const waits: number[] = [];
    const requests: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    let attempts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), ...(init ? { init } : {}) });
      attempts += 1;
      return attempts === 1
        ? new Response(null, { status: 503 })
        : Response.json({ admitted: true });
    };

    await runCodexResourceGovernorHook({
      input: hookInput("spawn_agent"),
      environment: hookEnvironment(),
      fetch: fetchImpl,
      write: (value) => output.push(value),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.init?.headers).toEqual({
      authorization: "Bearer secret-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      action: "admit-subagent",
      configurationKey: "codex-config-key",
      lifecycleId: "tool-use-1",
    });
    expect(waits).toEqual([250]);
    expect(JSON.parse(output[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("denies only the cancelled admission and leaves unrelated tools alone", async () => {
    const cancelledOutput: string[] = [];
    await runCodexResourceGovernorHook({
      input: hookInput("Agent"),
      environment: hookEnvironment(),
      fetch: async () => new Response(null, { status: 409 }),
      write: (value) => cancelledOutput.push(value),
    });
    expect(JSON.parse(cancelledOutput[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe(
      "deny",
    );

    const unrelatedOutput: string[] = [];
    let called = false;
    await runCodexResourceGovernorHook({
      input: hookInput("shell"),
      environment: {},
      fetch: async () => {
        called = true;
        return Response.json({ admitted: true });
      },
      write: (value) => unrelatedOutput.push(value),
    });
    expect(called).toBe(false);
    expect(JSON.parse(unrelatedOutput[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe(
      "allow",
    );
  });
});
