import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { invokeThreadContext } from "./handlers.ts";

const rootId = ThreadId.make("context-root");
const sourceId = ThreadId.make("context-source");
const projectId = ProjectId.make("context-project");
const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const shell = (id: ThreadId, parent?: ThreadId, project = projectId) =>
  ({
    id,
    projectId: project,
    lineage: { parentThreadId: parent ?? null, sideChat: false },
    forkedFrom:
      parent === undefined
        ? null
        : { type: "run", threadId: parent, runId: RunId.make("frozen-run") },
  }) as OrchestrationV2ThreadShell;
const message = (position: number, threadId = rootId): OrchestrationV2ProjectedTurnItem =>
  ({
    position,
    sourceThreadId: threadId,
    sourceItemId: TurnItemId.make(`item-${position}`),
    visibility: "local",
    item: {
      type: "assistant_message",
      id: TurnItemId.make(`item-${position}`),
      threadId,
      messageId: MessageId.make(`message-${position}`),
      text: `Exact message ${position}`,
      streaming: false,
      startedAt: now,
      updatedAt: now,
    },
  }) as OrchestrationV2ProjectedTurnItem;
function setup(
  rows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  ancestors = new Map<ThreadId, OrchestrationV2ThreadShell>(),
) {
  const reads: number[] = [];
  const layer = Layer.mergeAll(
    Layer.succeed(McpInvocationContext, {
      environmentId: EnvironmentId.make("test"),
      requestNamespace: "session",
      issuedAt: 0,
      capabilities: new Set(["workspace"] as const),
      client: undefined,
      thread: {
        threadId: rootId,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerSessionId: "session",
      },
    }),
    Layer.mock(OrchestratorV2)({
      getThreadShell: (id) =>
        Effect.succeed(
          id === rootId
            ? shell(rootId, ancestors.size > 0 ? sourceId : undefined)
            : (ancestors.get(id) ?? null),
        ),
      getTimelinePage: (_id, options) => {
        reads.push(options.limit);
        const matching = rows.filter((row) =>
          options.itemId === undefined
            ? row.position > (options.afterPosition ?? -1)
            : row.sourceItemId === options.itemId,
        );
        return Effect.succeed({
          items: matching.slice(0, options.limit),
          totalItems: rows.length,
          hasMore: matching.length > options.limit,
        });
      },
      getTurnItem: ({ itemId }) =>
        Effect.succeed(rows.find((row) => row.sourceItemId === itemId)?.item ?? null),
    }),
  );
  return { layer, reads };
}

it.effect("pages exact completed V2 messages newest first with bounded reads", () => {
  const test = setup(Array.from({ length: 45 }, (_, index) => message(index)));
  return Effect.gen(function* () {
    const first = yield* invokeThreadContext({});
    expect(first.messages.map((row) => row.text)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Exact message ${44 - index}`),
    );
    const next = yield* invokeThreadContext({ cursor: first.cursor! });
    expect(next.messages[0]?.text).toBe("Exact message 24");
    expect(next.messages).toHaveLength(20);
    const last = yield* invokeThreadContext({ cursor: next.cursor! });
    expect(last.messages).toHaveLength(5);
    expect(last.hasMore).toBe(false);
    expect(Math.max(...test.reads)).toBeLessThanOrEqual(100);
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects cross-project fork ancestry before reading timeline content", () => {
  const test = setup(
    [message(0, sourceId)],
    new Map([[sourceId, shell(sourceId, undefined, ProjectId.make("foreign"))]]),
  );
  return Effect.gen(function* () {
    const error = yield* invokeThreadContext({}).pipe(Effect.flip);
    expect(error.reason).toBe("cross_project_denied");
    expect(test.reads).toEqual([]);
  }).pipe(Effect.provide(test.layer));
});

it.effect("rejects sibling result references and mismatched cursors", () => {
  const row = {
    ...message(0),
    sourceThreadId: ThreadId.make("sibling"),
    item: { ...message(0).item, type: "dynamic_tool", output: { secret: true } },
  } as OrchestrationV2ProjectedTurnItem;
  const test = setup([row]);
  return Effect.gen(function* () {
    const error = yield* invokeThreadContext({ ref: "tool-result:item-0" }).pipe(Effect.flip);
    expect(error.reason).toBe("reference_not_found");
    const cursor = Buffer.from(
      JSON.stringify({
        version: 2,
        rootThreadId: rootId,
        projectId: "foreign",
        query: null,
        beforePosition: 1,
      }),
    ).toString("base64url");
    expect((yield* invokeThreadContext({ cursor }).pipe(Effect.flip)).reason).toBe(
      "cross_project_denied",
    );
  }).pipe(Effect.provide(test.layer));
});
