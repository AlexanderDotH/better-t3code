import * as EffectOutbox from "./EffectOutbox.ts";
import * as AutoReasoningPreparation from "./AutoReasoningPreparation.ts";
import * as ReplyThreadLifecycle from "./ReplyThreadLifecycle.ts";
import * as ContextCompactionRuntime from "../contextCompaction/ContextCompactionRuntime.ts";
import * as DecisionGeneration from "../decisionGeneration/DecisionGeneration.ts";
import { CommandId, MessageId, ProviderCompactionError } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { ProviderAdapterRegistryV2 } from "./ProviderAdapterRegistry.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { DeepPlanApplicationLive } from "../deepPlanning/DeepPlanApplication.ts";
import { DeepPlanSourcesLive } from "../deepPlanning/DeepPlanSources.ts";
import { DeepPlanWorkflowLive } from "../deepPlanning/DeepPlanWorkflow.ts";
import { DeepPlanValidationDispatcherLive } from "../deepPlanning/DeepPlanValidationDispatcher.ts";
import {
  DeepPlanValidationReactor,
  DeepPlanValidationReactorLive,
} from "../deepPlanning/DeepPlanValidationReactor.ts";
import * as DelegatedWorkerGuards from "../subagents/DelegatedWorkerGuards.ts";
import { GeneralSubagentCoordinatorLive } from "../subagents/GeneralSubagentCoordinator.ts";
import * as FetchPreparation from "../fetch/FetchPreparation.ts";
import { FetchWorkerCoordinatorLive } from "../fetch/FetchWorkerCoordinator.ts";
import { layer as planParallelismReviewLayer } from "../plan/PlanParallelismReview.ts";
import { ProjectAgentCoordinatorLive } from "../projectAgent/ProjectAgentCoordinator.ts";
import { ProjectionProjectAgentCoordinationRepositoryLive } from "../persistence/Layers/ProjectionProjectAgentCoordination.ts";

const workflow = DeepPlanWorkflowLive.pipe(Layer.provideMerge(DeepPlanSourcesLive));
const application = DeepPlanApplicationLive.pipe(Layer.provideMerge(workflow));
const dispatcher = DeepPlanValidationDispatcherLive.pipe(Layer.provideMerge(workflow));
const reactor = DeepPlanValidationReactorLive.pipe(Layer.provideMerge(dispatcher));
const continuation = Layer.effectDiscard(
  Effect.gen(function* () {
    const worker = yield* DeepPlanValidationReactor;
    yield* worker.start();
  }),
).pipe(Layer.provideMerge(reactor));

const workerGuards = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* (yield* DelegatedWorkerGuards.DelegatedWorkerGuards).start();
  }),
).pipe(Layer.provide(DelegatedWorkerGuards.layer));

export const layer = Layer.mergeAll(
  application,
  workerGuards,
  Layer.merge(ContextCompactionRuntime.layer, AutoReasoningPreparation.layer).pipe(
    Layer.provideMerge(DecisionGeneration.layer),
  ),
  continuation,
  GeneralSubagentCoordinatorLive.pipe(Layer.provide(workflow)),
  FetchPreparation.layer.pipe(Layer.provideMerge(FetchWorkerCoordinatorLive)),
  ReplyThreadLifecycle.layer,
  planParallelismReviewLayer,
  ProjectAgentCoordinatorLive.pipe(
    Layer.provide(
      Layer.merge(ProjectionProjectAgentCoordinationRepositoryLive, EffectOutbox.layer),
    ),
  ),
);

export const compactThread = Effect.fn("BetterT3Runtime.compactThread")(function* (
  threadId: import("@t3tools/contracts").ThreadId,
) {
  const threads = yield* ThreadManagementService;
  const registry = yield* ProviderAdapterRegistryV2;
  const crypto = yield* Crypto.Crypto;
  const thread = yield* threads
    .getThreadShell(threadId)
    .pipe(
      Effect.mapError(
        (cause) => new ProviderCompactionError({ reason: "failed", detail: cause.message }),
      ),
    );
  if (thread === null)
    return yield* new ProviderCompactionError({
      reason: "unavailable",
      detail: "The thread was not found.",
    });
  yield* registry
    .get(thread.providerInstanceId)
    .pipe(
      Effect.mapError(
        (cause) => new ProviderCompactionError({ reason: "unavailable", detail: cause.message }),
      ),
    );
  const id = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
  yield* threads
    .sendToThread({
      projectId: thread.projectId,
      threadId,
      commandId: CommandId.make(`compact:${id}`),
      messageId: MessageId.make(`compact:${id}:message`),
      text: "/compact",
      attachments: [],
      mode: "queue",
      createdBy: "user",
      creationSource: "server",
    })
    .pipe(
      Effect.mapError(
        (cause) => new ProviderCompactionError({ reason: "failed", detail: cause.message }),
      ),
    );
});
