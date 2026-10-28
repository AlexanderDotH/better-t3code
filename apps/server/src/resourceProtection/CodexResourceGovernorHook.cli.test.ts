import * as NodeStream from "node:stream";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Command } from "effect/unstable/cli";
import { beforeEach, expect, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  agentId: undefined as string | undefined,
  output: [] as string[],
  requests: 0,
}));

vi.mock("./CodexResourceGovernorHook.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./CodexResourceGovernorHook.ts")>();
  return {
    ...actual,
    runCodexResourceGovernorHook: (
      options: Parameters<typeof actual.runCodexResourceGovernorHook>[0],
    ) =>
      actual.runCodexResourceGovernorHook({
        ...options,
        input: NodeStream.Readable.from([
          JSON.stringify({
            hook_event_name: "PreToolUse",
            session_id: "root-session",
            tool_name: "spawn_agent",
            tool_use_id: "spawn-child",
            ...(fixture.agentId ? { agent_id: fixture.agentId } : {}),
          }),
        ]),
        environment: {},
        fetch: async () => {
          fixture.requests++;
          return Response.json({ admitted: true });
        },
        write: (value) => fixture.output.push(value),
      }),
  };
});

import { makeCli } from "../bin.ts";

const decodeDecision = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      hookSpecificOutput: Schema.Struct({ permissionDecision: Schema.Literals(["allow", "deny"]) }),
    }),
  ),
);

beforeEach(() => {
  fixture.agentId = undefined;
  fixture.output = [];
  fixture.requests = 0;
});

it.effect.each([
  { label: "root with no governor", flags: ["--nesting-guard-only"], decision: "allow" },
  { label: "T3 worker", flags: ["--nesting-guard-only", "--leaf-worker"], decision: "deny" },
  { label: "native child", flags: ["--nesting-guard-only"], agentId: "child", decision: "deny" },
  { label: "missing governor credentials", flags: [], decision: "deny" },
])("enforces nesting policy through the CLI: $label", (testCase) =>
  Effect.gen(function* () {
    fixture.agentId = "agentId" in testCase ? testCase.agentId : undefined;
    yield* Command.runWith(makeCli(), { version: "0.0.0" })([
      "resource-governor-hook",
      ...testCase.flags,
    ]);
    expect(decodeDecision(fixture.output[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe(
      testCase.decision,
    );
    expect(fixture.requests).toBe(0);
  }).pipe(Effect.provide(NetService.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
);
