import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SubagentId,
  ThreadId,
  type OrchestrationMessage,
  type OrchestrationSubagentDetail,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { invokeThreadContext } from "./handlers.ts";

const rootThreadId = ThreadId.make("thread-context-root");
const projectId = ProjectId.make("thread-context-project");
const toolItemId = "large-tool-item";

const invocation = McpInvocationContext.McpInvocationContext.of({
  environmentId: EnvironmentId.make("environment-thread-context"),
  threadId: rootThreadId,
  providerSessionId: "provider-session-thread-context",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["workspace"]),
  issuedAt: 1,
});

function message(index: number, text = `message ${index}`): OrchestrationMessage {
  return {
    id: MessageId.make(`message-${String(index).padStart(2, "0")}`),
    role: index % 2 === 0 ? "user" : "assistant",
    text,
    turnId: null,
    streaming: false,
    createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    updatedAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  };
}

function thread(input: {
  readonly id?: ThreadId;
  readonly project?: ProjectId;
  readonly messages?: ReadonlyArray<OrchestrationMessage>;
  readonly activities?: OrchestrationThread["activities"];
  readonly sourceThreadId?: ThreadId;
}): OrchestrationThread {
  return {
    id: input.id ?? rootThreadId,
    projectId: input.project ?? projectId,
    messages: input.messages ?? [],
    activities: input.activities ?? [],
    ...(input.sourceThreadId
      ? {
          fork: {
            provenance: { sourceThreadId: input.sourceThreadId },
          },
        }
      : {}),
  } as unknown as OrchestrationThread;
}

function shell(input: {
  readonly id: ThreadId;
  readonly project: ProjectId;
  readonly sourceThreadId?: ThreadId;
}): OrchestrationThreadShell {
  return {
    id: input.id,
    projectId: input.project,
    ...(input.sourceThreadId
      ? { fork: { provenance: { sourceThreadId: input.sourceThreadId } } }
      : {}),
  } as unknown as OrchestrationThreadShell;
}

function projection(input: {
  readonly root: OrchestrationThread;
  readonly ancestors?: ReadonlyMap<ThreadId, OrchestrationThreadShell>;
  readonly subagents?: ReadonlyMap<SubagentId, OrchestrationSubagentDetail>;
}) {
  return ProjectionSnapshotQuery.ProjectionSnapshotQuery.of({
    getThreadDetailById: (requestedThreadId) =>
      Effect.succeed(requestedThreadId === input.root.id ? Option.some(input.root) : Option.none()),
    getThreadShellById: (requestedThreadId) =>
      Effect.succeed(Option.fromNullishOr(input.ancestors?.get(requestedThreadId))),
    getSubagentDetailById: (requestedThreadId, subagentId) =>
      Effect.succeed(
        requestedThreadId === input.root.id
          ? Option.fromNullishOr(input.subagents?.get(subagentId))
          : Option.none(),
      ),
  } as ProjectionSnapshotQuery.ProjectionSnapshotQueryShape);
}

const provide = (
  effect: Effect.Effect<
    unknown,
    unknown,
    McpInvocationContext.McpInvocationContext | ProjectionSnapshotQuery.ProjectionSnapshotQuery
  >,
  query: ProjectionSnapshotQuery.ProjectionSnapshotQueryShape,
  activeInvocation: McpInvocationContext.McpInvocationScope = invocation,
) =>
  effect.pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, activeInvocation),
    Effect.provideService(ProjectionSnapshotQuery.ProjectionSnapshotQuery, query),
  );

it.effect("paginates exact completed messages newest-first with a stable cursor", () => {
  const messages = Array.from({ length: 22 }, (_, index) =>
    message(index, index === 1 ? "exact\n  spacing stays" : `message ${index}`),
  );
  const query = projection({ root: thread({ messages }) });

  return Effect.gen(function* () {
    const first = yield* invokeThreadContext({});
    expect(first.messages).toHaveLength(20);
    expect(first.messages[0]?.messageId).toBe(MessageId.make("message-21"));
    expect(first.messages[19]?.messageId).toBe(MessageId.make("message-02"));
    expect(first.hasMore).toBe(true);
    expect(first.cursor).not.toBeNull();

    const second = yield* invokeThreadContext({ cursor: first.cursor! });
    expect(second.messages.map((entry) => entry.messageId)).toEqual([
      MessageId.make("message-01"),
      MessageId.make("message-00"),
    ]);
    expect(second.messages[0]?.text).toBe("exact\n  spacing stays");
    expect(second.hasMore).toBe(false);
    expect(second.cursor).toBeNull();
  }).pipe((effect) => provide(effect, query));
});

it.effect(
  "applies a case-insensitive lexical query and carries it through cursor pagination",
  () => {
    const messages = Array.from({ length: 22 }, (_, index) =>
      message(index, `Needle exact ${index}`),
    );
    const query = projection({ root: thread({ messages }) });

    return Effect.gen(function* () {
      const first = yield* invokeThreadContext({ query: "nEeDlE" });
      expect(first.messages).toHaveLength(20);
      const second = yield* invokeThreadContext({ cursor: first.cursor! });
      expect(second.query).toBe("nEeDlE");
      expect(second.messages).toHaveLength(2);
      expect(second.messages.every((entry) => entry.text.includes("Needle exact"))).toBe(true);
    }).pipe((effect) => provide(effect, query));
  },
);

it.effect("keeps inherited message provenance inside same-project fork ancestry", () => {
  const sourceThreadId = ThreadId.make("thread-context-source");
  const inherited = {
    ...message(1, "exact inherited goal"),
    historyOrigin: {
      sourceThreadId,
      sourceId: "source-message-1",
      ordinal: 0,
    },
  };
  const query = projection({
    root: thread({ messages: [inherited], sourceThreadId }),
    ancestors: new Map([[sourceThreadId, shell({ id: sourceThreadId, project: projectId })]]),
  });

  return invokeThreadContext({}).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        expect(result.messages).toEqual([
          expect.objectContaining({
            threadId: sourceThreadId,
            messageId: MessageId.make("source-message-1"),
            text: "exact inherited goal",
          }),
        ]);
      }),
    ),
    (effect) => provide(effect, query),
  );
});

it.effect("denies a fork ancestry edge that crosses projects", () => {
  const sourceThreadId = ThreadId.make("thread-context-foreign-source");
  const query = projection({
    root: thread({ messages: [message(1)], sourceThreadId }),
    ancestors: new Map([
      [
        sourceThreadId,
        shell({
          id: sourceThreadId,
          project: ProjectId.make("foreign-project"),
        }),
      ],
    ]),
  });

  return invokeThreadContext({}).pipe(
    Effect.flip,
    Effect.tap((error) =>
      Effect.sync(() => {
        expect(error).toMatchObject({
          _tag: "ThreadContextError",
          reason: "cross_project_denied",
        });
      }),
    ),
    (effect) => provide(effect, query),
  );
});

it.effect("retrieves an exact one MiB tool result through paginated references", () => {
  const output = "x".repeat(1024 * 1024);
  const payload = {
    itemType: "command_execution",
    status: "completed",
    title: "Large command",
    detail: "Exited with code 0",
    data: { stdout: output, stderr: "", exitCode: 0 },
  };
  const query = projection({
    root: thread({
      activities: [
        {
          id: "event-large-tool",
          tone: "tool",
          kind: "tool.completed",
          summary: "Large command",
          payload: { itemId: toolItemId, canonicalPayload: payload },
          turnId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  });

  return Effect.gen(function* () {
    const chunks: string[] = [];
    let cursor: string | undefined;
    do {
      const page = yield* invokeThreadContext({
        ref: `tool-result:${toolItemId}`,
        ...(cursor ? { cursor } : {}),
      });
      expect(page.messages).toEqual([]);
      expect(page.reference?.ref).toBe(`tool-result:${toolItemId}`);
      expect(page.reference?.contentType).toBe("application/json");
      chunks.push(page.reference!.content);
      cursor = page.cursor ?? undefined;
      if (!page.hasMore) break;
    } while (cursor);

    const retrieved = JSON.parse(chunks.join("")) as typeof payload;
    expect(chunks.length).toBeGreaterThan(1);
    expect(retrieved).toEqual(payload);
    expect(retrieved.data.stdout).toHaveLength(1024 * 1024);
  }).pipe((effect) => provide(effect, query));
});

it.effect("retrieves an exact General Subagent transcript reference", () => {
  const agentId = SubagentId.make("general-agent-1");
  const transcript = [message(0, "Investigate"), message(1, "Exact\nanswer")];
  const query = projection({
    root: thread({}),
    subagents: new Map([
      [
        agentId,
        {
          id: agentId,
          origin: "t3-managed",
          messages: transcript,
        } as unknown as OrchestrationSubagentDetail,
      ],
    ]),
  });

  return invokeThreadContext({ ref: `subagent:${agentId}` }).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        expect(result.reference).toMatchObject({
          ref: `subagent:${agentId}`,
          contentType: "application/json",
        });
        expect(JSON.parse(result.reference!.content)).toEqual(transcript);
      }),
    ),
    (effect) => provide(effect, query),
  );
});

it.effect("denies a reference cursor from another project", () => {
  const payload = {
    itemType: "mcp_tool_call",
    status: "completed",
    data: { value: "x".repeat(40_000) },
  };
  const projectA = projection({
    root: thread({
      activities: [
        {
          id: "event-project-a",
          tone: "tool",
          kind: "tool.completed",
          summary: "Tool",
          payload: { itemId: toolItemId, canonicalPayload: payload },
          turnId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
  });
  const foreignProjectId = ProjectId.make("thread-context-foreign-project");
  const foreignThreadId = ThreadId.make("thread-context-foreign-thread");
  const projectB = projection({
    root: thread({ id: foreignThreadId, project: foreignProjectId }),
  });
  const foreignInvocation = McpInvocationContext.McpInvocationContext.of({
    ...invocation,
    threadId: foreignThreadId,
  });

  return Effect.gen(function* () {
    const first = yield* invokeThreadContext({ ref: `tool-result:${toolItemId}` }).pipe((effect) =>
      provide(effect, projectA),
    );
    expect(first.cursor).not.toBeNull();
    const denied = yield* invokeThreadContext({
      ref: `tool-result:${toolItemId}`,
      cursor: first.cursor!,
    }).pipe((effect) => provide(effect, projectB, foreignInvocation), Effect.flip);
    expect(denied).toMatchObject({
      _tag: "ThreadContextError",
      reason: "cross_project_denied",
    });
  });
});

it.effect("resolves a tool result inherited from authenticated fork ancestry", () => {
  const sourceThreadId = ThreadId.make("thread-context-ref-source");
  const query = projection({
    root: thread({
      sourceThreadId,
      activities: [
        {
          id: "event-inherited-tool",
          tone: "tool",
          kind: "tool.completed",
          summary: "Inherited tool",
          payload: { itemId: toolItemId, canonicalPayload: { data: { secret: true } } },
          turnId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          historyOrigin: { sourceThreadId, sourceId: "event-inherited-tool", ordinal: 0 },
        },
      ],
    }),
    ancestors: new Map([[sourceThreadId, shell({ id: sourceThreadId, project: projectId })]]),
  });

  return invokeThreadContext({ ref: `tool-result:${toolItemId}` }).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        expect(JSON.parse(result.reference!.content)).toEqual({ data: { secret: true } });
      }),
    ),
    (effect) => provide(effect, query),
  );
});

it.effect("does not resolve a sibling-only tool result", () => {
  const sourceThreadId = ThreadId.make("thread-context-shared-ancestor");
  const siblingThreadId = ThreadId.make("thread-context-sibling");
  const query = projection({
    root: thread({ id: siblingThreadId, sourceThreadId }),
    ancestors: new Map([[sourceThreadId, shell({ id: sourceThreadId, project: projectId })]]),
  });
  const siblingInvocation = McpInvocationContext.McpInvocationContext.of({
    ...invocation,
    threadId: siblingThreadId,
  });

  return invokeThreadContext({ ref: `tool-result:${toolItemId}` }).pipe(
    (effect) => provide(effect, query, siblingInvocation),
    Effect.flip,
    Effect.tap((error) =>
      Effect.sync(() => {
        expect(error).toMatchObject({
          _tag: "ThreadContextError",
          reason: "reference_not_found",
        });
      }),
    ),
  );
});
