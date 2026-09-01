import * as Layer from "effect/Layer";

import * as KnowledgeGraphRepository from "./persistence/KnowledgeGraphRepository.ts";
import * as KnowledgeGraphSemanticQueueRepository from "./persistence/KnowledgeGraphSemanticQueueRepository.ts";
import * as KnowledgeGraphSemanticWorker from "./semantic/KnowledgeGraphSemanticWorker.ts";
import * as KnowledgeGraphEventHub from "./runtime/KnowledgeGraphEventHub.ts";
import * as KnowledgeGraphIndexer from "./runtime/KnowledgeGraphIndexer.ts";
import * as KnowledgeGraphRuntime from "./runtime/KnowledgeGraphRuntime.ts";
import * as KnowledgeGraphScopeCatalog from "./runtime/KnowledgeGraphScopeCatalog.ts";
import * as KnowledgeGraphWatcherMultiplexer from "./runtime/KnowledgeGraphWatcherMultiplexer.ts";

const PersistenceLive = Layer.merge(
  KnowledgeGraphRepository.KnowledgeGraphRepositoryLive,
  KnowledgeGraphSemanticQueueRepository.KnowledgeGraphSemanticQueueRepositoryLive,
);

const SemanticWorkerLive = KnowledgeGraphSemanticWorker.KnowledgeGraphSemanticWorkerLive.pipe(
  Layer.provide(PersistenceLive),
);

const IndexerLive = KnowledgeGraphIndexer.layer.pipe(Layer.provide(PersistenceLive));

const DependenciesLive = Layer.mergeAll(
  PersistenceLive,
  SemanticWorkerLive,
  IndexerLive,
  KnowledgeGraphEventHub.layer,
  KnowledgeGraphScopeCatalog.layer,
  KnowledgeGraphWatcherMultiplexer.layer,
);

export const layer = KnowledgeGraphRuntime.layer.pipe(Layer.provideMerge(DependenciesLive));
