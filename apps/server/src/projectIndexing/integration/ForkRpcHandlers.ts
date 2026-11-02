import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { KnowledgeGraphRuntime } from "../../knowledge-graph/runtime/KnowledgeGraphRuntimeService.ts";
import { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ProjectContextQuery } from "../query/ProjectContextQuery.ts";
import { ProjectIndexingRuntime } from "../runtime/ProjectIndexingRuntimeService.ts";

export const makeForkRpcHandlers = Effect.fn("projectIndexing.makeForkRpcHandlers")(function* () {
  const indexing = yield* ProjectIndexingRuntime;
  const context = yield* ProjectContextQuery;
  const graph = yield* KnowledgeGraphRuntime;
  const protection = yield* SubagentResourceGovernor;
  return {
    [WS_METHODS.projectIndexGetSettings]: indexing.getSettings,
    [WS_METHODS.projectIndexGetStatus]: indexing.getStatus,
    [WS_METHODS.projectIndexUpdateSettings]: indexing.updateSettings,
    [WS_METHODS.projectIndexStart]: indexing.start,
    [WS_METHODS.projectIndexControl]: indexing.control,
    [WS_METHODS.projectIndexCheckModel]: indexing.checkModel,
    [WS_METHODS.projectIndexReview]: indexing.review,
    [WS_METHODS.projectIndexQuery]: context.query,
    [WS_METHODS.projectIndexSubscribe]: (input: Parameters<typeof indexing.subscribe>[0]) =>
      Stream.unwrap(indexing.subscribe(input)),
    [WS_METHODS.projectIndexSubscribeActivity]: () => Stream.unwrap(indexing.subscribeActivity()),
    [WS_METHODS.knowledgeGraphQuery]: graph.query,
    [WS_METHODS.knowledgeGraphNodeContent]: graph.nodeContent,
    [WS_METHODS.knowledgeGraphRebuild]: graph.rebuild,
    [WS_METHODS.knowledgeGraphCancel]: (input: {
      readonly scope: Parameters<typeof graph.cancel>[0];
    }) => graph.cancel(input.scope),
    [WS_METHODS.knowledgeGraphPause]: graph.pause,
    [WS_METHODS.knowledgeGraphClear]: graph.clear,
    [WS_METHODS.knowledgeGraphSubscribe]: (input: Parameters<typeof graph.subscribe>[0]) =>
      Stream.unwrap(graph.subscribe(input)),
    [WS_METHODS.subscribeResourceProtection]: () =>
      Stream.unwrap(
        Effect.map(protection.subscribe, ({ latest, changes }) =>
          Stream.concat(Stream.make(latest), changes),
        ),
      ),
  };
});
