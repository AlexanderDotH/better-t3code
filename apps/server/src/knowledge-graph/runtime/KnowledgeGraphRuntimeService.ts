import {
  type KnowledgeGraphClearInput,
  type KnowledgeGraphMutationResultV1,
  type KnowledgeGraphNodeContentInput,
  type KnowledgeGraphNodeContentResultV1,
  KnowledgeGraphOperationError,
  type KnowledgeGraphPauseInput,
  type KnowledgeGraphQueryBatchInput,
  type KnowledgeGraphQueryInput,
  type KnowledgeGraphQueryResultV1,
  type KnowledgeGraphRebuildInput,
  type KnowledgeGraphScopeId,
  type KnowledgeGraphStreamEvent,
  type KnowledgeGraphSubscribeInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

export class KnowledgeGraphRuntime extends Context.Service<
  KnowledgeGraphRuntime,
  {
    readonly subscribe: (
      input: KnowledgeGraphSubscribeInput,
    ) => Effect.Effect<
      Stream.Stream<KnowledgeGraphStreamEvent>,
      KnowledgeGraphOperationError,
      Scope.Scope
    >;
    readonly query: (
      input: KnowledgeGraphQueryInput,
    ) => Effect.Effect<KnowledgeGraphQueryResultV1, KnowledgeGraphOperationError>;
    readonly queryForThread: (input: {
      readonly threadId: ThreadId;
      readonly query: KnowledgeGraphQueryBatchInput;
    }) => Effect.Effect<KnowledgeGraphQueryResultV1, KnowledgeGraphOperationError>;
    readonly nodeContent: (
      input: KnowledgeGraphNodeContentInput,
    ) => Effect.Effect<KnowledgeGraphNodeContentResultV1, KnowledgeGraphOperationError>;
    readonly rebuild: (
      input: KnowledgeGraphRebuildInput,
    ) => Effect.Effect<KnowledgeGraphMutationResultV1, KnowledgeGraphOperationError>;
    readonly cancel: (
      input: KnowledgeGraphSubscribeInput["scope"],
    ) => Effect.Effect<KnowledgeGraphMutationResultV1, KnowledgeGraphOperationError>;
    readonly pause: (
      input: KnowledgeGraphPauseInput,
    ) => Effect.Effect<KnowledgeGraphMutationResultV1, KnowledgeGraphOperationError>;
    readonly clear: (
      input: KnowledgeGraphClearInput,
    ) => Effect.Effect<KnowledgeGraphMutationResultV1, KnowledgeGraphOperationError>;
  }
>()("t3/knowledge-graph/runtime/KnowledgeGraphRuntimeService/KnowledgeGraphRuntime") {}

export function graphError(input: {
  readonly operation: string;
  readonly code: KnowledgeGraphOperationError["code"];
  readonly retryable: boolean;
  readonly detail: string;
  readonly scopeId?: KnowledgeGraphScopeId;
}): KnowledgeGraphOperationError {
  return new KnowledgeGraphOperationError(input);
}
