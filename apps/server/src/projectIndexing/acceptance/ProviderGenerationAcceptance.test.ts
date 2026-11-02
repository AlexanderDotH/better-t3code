import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type ModelSelection,
  type ServerProvider,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import type {
  ProviderAdapterV2,
  ProviderAdapterV2Event,
  ProviderAdapterV2OpenSessionInput,
  ProviderAdapterV2SessionRuntime,
  ProviderAdapterV2TurnInput,
} from "@t3tools/provider-core/server/ProviderAdapter";

import { ProviderAdapterRegistryV2 } from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import { ProviderRegistry } from "../../provider/ProviderRegistry.ts";
import { makeProjectIndexGenerator } from "../integration/ProjectIndexGeneration.ts";
import type { ProjectIndexGenerationInput } from "../runtime/ProjectIndexingBridge.ts";

const selection: ModelSelection = {
  instanceId: ProviderInstanceId.make("review-instance"),
  model: "synthetic-model",
};
const provider: ServerProvider = {
  instanceId: selection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-20T12:00:00Z",
  fetchWorkers: { maxRecommendedWorkers: 2, commandExecutionPolicy: "deny" },
  models: [
    {
      slug: selection.model,
      name: "Synthetic model",
      isCustom: true,
      capabilities: { contextWindow: { defaultTokens: 128_000, maxTokens: 1_000_000 } },
    },
  ],
  slashCommands: [],
  skills: [],
};
const input: ProjectIndexGenerationInput = {
  workspaceRoot: "/synthetic-workspace",
  scope: {
    scopeId: "synthetic-scope",
    projectId: ProjectId.make("synthetic-project"),
    workspaceFingerprint: "synthetic-workspace",
  },
  modelSelection: selection,
  prompt: "Synthetic evidence only.",
  responseSchema: { type: "object" },
  purpose: "review",
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 1_000,
};

const harness = Effect.fn("ProjectIndexGenerationAcceptance.harness")(function* (
  violation?: "tool" | "overflow",
) {
  const queue = yield* Queue.unbounded<ProviderAdapterV2Event>();
  yield* Effect.addFinalizer(() => Queue.shutdown(queue));
  const starts: ProviderAdapterV2TurnInput[] = [];
  let closed = false;
  const thread = {
    id: ProviderThreadId.make("private-provider-thread"),
  } as OrchestrationV2ProviderThread;
  const runtime = {
    ensureThread: () => Effect.succeed(thread),
    events: Stream.fromQueue(queue),
    startTurn: (turn: ProviderAdapterV2TurnInput) =>
      Effect.gen(function* () {
        starts.push(turn);
        if (violation === "tool") {
          yield* Queue.offer(queue, {
            type: "turn_item.updated",
            driver: provider.driver,
            turnItem: { type: "command_execution", threadId: turn.threadId },
          } as ProviderAdapterV2Event);
        } else {
          yield* Queue.offer(queue, {
            type: "message.updated",
            driver: provider.driver,
            message: {
              threadId: turn.threadId,
              id: MessageId.make("answer"),
              role: "assistant",
              text: violation === "overflow" ? "x".repeat(12_001) : '{"ok":true}',
            },
          } as ProviderAdapterV2Event);
          yield* Queue.offer(queue, {
            type: "turn.terminal",
            driver: provider.driver,
            providerThreadId: thread.id,
            providerTurnId: ProviderTurnId.make("private-turn"),
            status: "completed",
            failure: null,
            runOrdinal: 1,
            threadDisposition: "reusable",
          });
        }
      }),
  } as unknown as ProviderAdapterV2SessionRuntime;
  const layer = Layer.mergeAll(
    Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([provider]) }),
    Layer.mock(ProviderAdapterRegistryV2)({
      get: () =>
        Effect.succeed({
          openSession: (opened: ProviderAdapterV2OpenSessionInput) =>
            Effect.gen(function* () {
              expect(opened.runtimePolicy).toMatchObject({
                runtimeMode: "approval-required",
                interactionMode: "plan",
                sandboxPolicy: { type: "read-only" },
              });
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  closed = true;
                }),
              );
              return runtime;
            }),
        } as unknown as ProviderAdapterV2["Service"]),
    }),
  );
  const generate = yield* makeProjectIndexGenerator.pipe(Effect.provide(layer));
  return { generate, starts, closed: () => closed };
});

it.effect("runs selected-model analysis in a private read-only V2 session and closes it", () =>
  Effect.gen(function* () {
    const test = yield* harness();
    const result = yield* test.generate(input);
    expect(result.text).toBe('{"ok":true}');
    expect(test.starts[0]?.modelSelection.instanceId).toBe(selection.instanceId);
    expect(test.starts[0]?.message.text).toContain(input.prompt);
    expect(test.starts[0]?.threadId.startsWith("project-index:")).toBe(true);
    expect(test.closed()).toBe(true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses tool use and output overflow and closes each private V2 session", () =>
  Effect.gen(function* () {
    for (const violation of ["tool", "overflow"] as const) {
      const test = yield* harness(violation);
      const error = yield* test.generate(input).pipe(Effect.flip);
      expect(error.message).toContain(violation === "tool" ? "read-only" : "output bound");
      expect(test.closed()).toBe(true);
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
