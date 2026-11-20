import { assert, it } from "@effect/vitest";
import {
  DeepPlanRunId,
  EnvironmentId,
  OrchestratorMcpFailure,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ServerEnvironmentIdentity } from "../environment/ServerEnvironment.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { PeerForwarding } from "../peer/PeerForwarding.ts";
import { DeepPlanChatReferences, assertDeepPlanChatRead, layer } from "./DeepPlanChatReferences.ts";

const local = EnvironmentId.make("local");
const linked = EnvironmentId.make("linked");
const ownerId = ThreadId.make("planning-thread");
const explorerId = ThreadId.make("explorer-thread");
const selected = ThreadId.make("selected-chat");
const projectId = ProjectId.make("deep-plan-project");
const providerInstanceId = ProviderInstanceId.make("codex");
const runId = DeepPlanRunId.make("deep-plan");
const linkedChat = { environmentId: linked, projectId, threadId: selected };
const localChat = { environmentId: local, projectId, threadId: selected };

it.effect("rejects misleading local project references and inaccessible linked chats", () =>
  Effect.gen(function* () {
    const chats = yield* DeepPlanChatReferences;
    assert.isUndefined(yield* chats.assertReadable([localChat, linkedChat]));
    const mismatched = yield* Effect.flip(
      chats.assertReadable([{ ...localChat, projectId: ProjectId.make("other-project") }]),
    );
    assert.equal(mismatched.code, "target-unavailable");
    const missing = yield* Effect.flip(
      chats.assertReadable([{ ...linkedChat, threadId: ThreadId.make("missing") }]),
    );
    assert.include(missing.message, "linked");
    assert.include(missing.message, "Thread does not exist.");
  }).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.mock(OrchestratorV2)({
              getThreadShell: (id) =>
                Effect.succeed(id === selected ? { ...liveThreadShell(id), projectId } : null),
            }),
            Layer.succeed(ServerEnvironmentIdentity, {
              getEnvironmentId: Effect.succeed(local),
            }),
            Layer.mock(PeerForwarding)({
              assertReadableThread: (ref) =>
                ref.threadId === selected
                  ? Effect.void
                  : Effect.fail(
                      new OrchestratorMcpFailure({
                        code: "thread_not_found",
                        message: "Thread does not exist.",
                      }),
                    ),
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("binds explorer chat reads to the live owner run and selected environment", () => {
  const owner = {
    ...liveThreadShell(ownerId),
    projectId,
    deepPlan: {
      schemaVersion: 2,
      id: runId,
      threadId: ownerId,
      phase: "planning",
      chats: [linkedChat],
      includeProjectChats: false,
      revision: 0,
      plan: null,
      approvalKey: null,
      approval: null,
      steps: [],
      finalReview: {
        status: "pending",
        submission: null,
        reviews: [],
        roundLimit: 3,
        unsubmittedTurns: 0,
      },
      activeTurns: [],
      pause: null,
      operations: [],
      createdAt: "2026-11-19T10:00:00.000Z",
      updatedAt: "2026-11-19T10:00:00.000Z",
    },
  } satisfies ReturnType<typeof liveThreadShell>;
  const base = liveThreadShell(explorerId);
  const explorer = {
    ...base,
    providerInstanceId,
    activeRunId: RunId.make("active-exploration"),
    fetchWorker: { commandExecutionPolicy: "deny" as const, deepPlanRunId: runId },
    lineage: {
      ...base.lineage,
      relationshipToParent: "subagent" as const,
      parentThreadId: ownerId,
    },
  };
  const scope = {
    environmentId: local,
    capabilities: new Set(["deep-plan-chat-read"] as const),
    issuedAt: 0,
    requestNamespace: "explorer",
    thread: { threadId: explorerId, providerInstanceId, providerSessionId: "explorer" },
    client: undefined,
  };
  let current: ReturnType<typeof liveThreadShell> = owner;
  return Effect.gen(function* () {
    yield* assertDeepPlanChatRead(scope, { threadId: selected, environmentId: linked });
    current = { ...owner, deepPlan: { ...owner.deepPlan, phase: "paused" } };
    yield* assertDeepPlanChatRead(scope, { threadId: selected, environmentId: linked });
    current = { ...owner, deepPlan: { ...owner.deepPlan, phase: "implementing" } };
    const implementing = yield* Effect.flip(
      assertDeepPlanChatRead(scope, { threadId: selected, environmentId: linked }),
    );
    assert.equal(implementing.code, "capability_denied");
    current = owner;
    const wrongEnvironment = yield* Effect.flip(
      assertDeepPlanChatRead(scope, { threadId: selected, environmentId: local }),
    );
    assert.equal(wrongEnvironment.code, "capability_denied");
    const wrongThread = yield* Effect.flip(
      assertDeepPlanChatRead(scope, {
        threadId: ThreadId.make("unselected"),
        environmentId: linked,
      }),
    );
    assert.equal(wrongThread.code, "capability_denied");
  }).pipe(
    Effect.provide(
      Layer.mock(ThreadManagementService)({
        getThreadShell: (id) => Effect.succeed(id === explorerId ? explorer : current),
      }),
    ),
  );
});
