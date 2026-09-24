import * as Layer from "effect/Layer";

import { KnowledgeGraphRepositoryKvLive } from "./persistence/KnowledgeGraphKvRepository.ts";
import * as KnowledgeGraphEventHub from "./runtime/KnowledgeGraphEventHub.ts";
import * as KnowledgeGraphIndexer from "./runtime/KnowledgeGraphIndexer.ts";
import * as KnowledgeGraphRuntime from "./runtime/KnowledgeGraphRuntime.ts";
import * as KnowledgeGraphScopeCatalog from "./runtime/KnowledgeGraphScopeCatalog.ts";
import * as KnowledgeGraphWatcherMultiplexer from "./runtime/KnowledgeGraphWatcherMultiplexer.ts";

const IndexerLive = KnowledgeGraphIndexer.layer.pipe(
  Layer.provideMerge(KnowledgeGraphRepositoryKvLive),
);

const DependenciesLive = Layer.mergeAll(
  IndexerLive,
  KnowledgeGraphEventHub.layer,
  KnowledgeGraphScopeCatalog.layer,
  KnowledgeGraphWatcherMultiplexer.layer,
);

export const layer = KnowledgeGraphRuntime.layer.pipe(Layer.provideMerge(DependenciesLive));
