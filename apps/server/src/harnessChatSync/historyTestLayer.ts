import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import { ProjectionHarnessChatSyncRepositoryLive } from "../persistence/Layers/ProjectionHarnessChatSync.ts";
import * as ServerConfig from "../config.ts";

export function historyTestLayer(baseDir: string) {
  const database = Sqlite.layerMemory;
  const stores = Layer.mergeAll(
    EventStore.layer,
    ProjectStore.layer,
    ProjectionStore.layer,
    ProjectionHarnessChatSyncRepositoryLive,
  ).pipe(Layer.provideMerge(database));
  const sink = EventSink.layer.pipe(Layer.provideMerge(stores));
  return Layer.mergeAll(
    sink,
    IdAllocator.layer,
    NodeServices.layer,
    ServerConfig.layerTest(process.cwd(), baseDir).pipe(Layer.provide(NodeServices.layer)),
  );
}
