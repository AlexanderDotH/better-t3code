import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestratorV2 } from "../../../orchestration-v2/Orchestrator.ts";
import { makeReplyInvocation, replyTopicId, replyTurnId } from "../../testFixtures/messageReply.ts";
import {
  ProjectAgentCoordinator,
  type ProjectAgentCoordinatorShape,
} from "../../../projectAgent/ProjectAgentCoordinator.ts";
import { invokeProjectAgentList } from "./handlers.ts";

const threadId = ThreadId.make("thread-coordination-handler");
const replyShell = {
  activeRunId: RunId.make(replyTurnId),
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access",
  interactionMode: "default",
  lineage: { relationshipToParent: "subagent", parentThreadId: threadId },
};
const projectionLayer = Layer.mock(OrchestratorV2)({
  getThreadShell: () => Effect.succeed(replyShell as never),
});
const coordinator = ProjectAgentCoordinator.of({
  list: (authenticatedThreadId) =>
    Effect.succeed({
      peers: [
        {
          threadId: authenticatedThreadId,
          self: true,
          phase: "working",
          title: "Authenticated agent",
          model: "gpt-5.6",
          branch: null,
          worktreePath: null,
          summary: null,
          claims: [],
          unreadCount: 0,
        },
      ],
      truncated: false,
    }),
  claim: () => Effect.die("unused"),
  send: () => Effect.die("unused"),
  inbox: () => Effect.die("unused"),
} satisfies ProjectAgentCoordinatorShape);

const invocation = (capabilities: ReadonlySet<McpInvocationContext.McpCapability>) => ({
  environmentId: EnvironmentId.make("environment-coordination-handler"),
  thread: {
    threadId,
    providerSessionId: "provider-session-coordination-handler",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  requestNamespace: "provider-session-coordination-handler",
  client: undefined,
  capabilities,
  issuedAt: 1,
});

it.effect("derives project-agent identity from the authenticated MCP credential", () =>
  Effect.gen(function* () {
    const result = yield* invokeProjectAgentList();
    expect(result.peers[0]?.threadId).toBe(threadId);
  }).pipe(
    Effect.provideService(ProjectAgentCoordinator, coordinator),
    Effect.provide(Layer.mergeAll(projectionLayer, Layer.empty)),
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["coordination"])),
    ),
  ),
);

it.effect("rejects credentials without the coordination capability", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(invokeProjectAgentList());
    expect(error).toMatchObject({ reason: "credential_not_authorized" });
  }).pipe(
    Effect.provideService(ProjectAgentCoordinator, coordinator),
    Effect.provide(Layer.mergeAll(projectionLayer, Layer.empty)),
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      invocation(new Set(["preview"])),
    ),
  ),
);

it.effect(
  "passes the authenticated active reply turn to coordination under the parent identity",
  () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const replyCoordinator = {
        ...coordinator,
        list: (...args: Parameters<ProjectAgentCoordinatorShape["list"]>) => {
          calls.push(args);
          return Effect.succeed({ peers: [], truncated: false });
        },
      };
      yield* invokeProjectAgentList().pipe(
        Effect.provideService(ProjectAgentCoordinator, replyCoordinator),
        Effect.provideService(
          McpInvocationContext.McpInvocationContext,
          makeReplyInvocation(threadId),
        ),
        Effect.provide(Layer.mergeAll(Layer.empty, projectionLayer)),
      );
      expect(calls).toEqual([
        [
          threadId,
          expect.objectContaining({
            replyTopicId,
            turnId: replyTurnId,
            providerInstanceId: ProviderInstanceId.make("codex"),
          }),
        ],
      ]);
    }),
);

it.effect("does not dispatch coordination for a stale authenticated reply runtime", () =>
  Effect.gen(function* () {
    const error = yield* invokeProjectAgentList().pipe(
      Effect.provideService(ProjectAgentCoordinator, coordinator),
      Effect.provideService(
        McpInvocationContext.McpInvocationContext,
        makeReplyInvocation(threadId),
      ),
      Effect.provide(
        Layer.mock(OrchestratorV2)({
          getThreadShell: () => Effect.succeed({ ...replyShell, activeRunId: null } as never),
        }),
      ),
      Effect.flip,
    );
    expect(error).toMatchObject({ reason: "thread_unavailable" });
  }),
);
