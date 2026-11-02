import * as NodeServices from "@effect/platform-node/NodeServices";
import { MessageId, NodeId, ProjectId, RunAttemptId, RunId, ThreadId } from "@t3tools/contracts";
import * as Adapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

export const nativeProviderTestLayer = Layer.mergeAll(
  NodeServices.layer,
  IdAllocator.layer,
  TestProviderHost.layer().pipe(Layer.provide(NodeServices.layer)),
);
export const nativeProviderTurnInput = Effect.fn("NativeProviderAdapterV2.test.turnInput")(
  function* (
    providerThread: Adapter.ProviderAdapterV2ThreadSnapshot["providerThread"],
    ordinal: number,
    modelSelection: import("@t3tools/contracts").ModelSelection,
    runtimePolicy: Adapter.ProviderAdapterV2RuntimePolicy = {
      runtimeMode: "full-access",
      interactionMode: "default",
      cwd: null,
    },
  ): Effect.fn.Return<Adapter.ProviderAdapterV2TurnInput> {
    const now = yield* DateTime.now;
    const threadId = providerThread.appThreadId ?? ThreadId.make("native-v2-thread");
    const instanceId = providerThread.providerInstanceId;
    return {
      appThread: {
        id: threadId,
        projectId: ProjectId.make("native-project"),
        title: "Native",
        createdBy: "user",
        creationSource: "web",
        providerInstanceId: instanceId,
        modelSelection,
        runtimeMode: runtimePolicy.runtimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: providerThread.id,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
      threadId,
      runId: RunId.make(`run-${ordinal}`),
      runOrdinal: ordinal,
      providerTurnOrdinal: ordinal,
      attemptId: RunAttemptId.make(`attempt-${ordinal}`),
      rootNodeId: NodeId.make(`root-${ordinal}`),
      providerThread,
      message: {
        messageId: MessageId.make(`message-${ordinal}`),
        text: `question-${ordinal}`,
        attachments: [],
        createdBy: "user",
        creationSource: "web",
      },
      modelSelection,
      runtimePolicy,
    };
  },
);

export const runNativeProviderTurn = Effect.fn("NativeProviderTest.runTurn")(function* (
  runtime: Adapter.ProviderAdapterV2SessionRuntime,
  input: Adapter.ProviderAdapterV2TurnInput,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const events = yield* runtime.events.pipe(
        Stream.takeUntil((event) => event.type === "turn.terminal"),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* runtime.startTurn(input);
      return yield* Fiber.join(events);
    }),
  );
});
