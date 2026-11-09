import { McpConfigEngineLive } from "../../mcp/McpConfigEngine.ts";
import { McpConfigurationReconcilerLive } from "../../mcp/McpConfigurationReconcilerLive.ts";
import { McpRuntimeRegistryLive } from "../../mcp/McpRuntimeRegistry.ts";
import { SkillEngineLive } from "../../skills/Layers/SkillEngine.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../../config.ts";
import * as DecisionGeneration from "../../decisionGeneration/DecisionGeneration.ts";
import * as TurnPromptContext from "../../orchestration-v2/TurnPromptContext.ts";
import * as KnowledgeGraphLive from "../../knowledge-graph/KnowledgeGraphLive.ts";
import * as KnowledgeGraphScopeCatalog from "../../knowledge-graph/runtime/KnowledgeGraphScopeCatalog.ts";
import * as KnowledgeGraphWatcherMultiplexer from "../../knowledge-graph/runtime/KnowledgeGraphWatcherMultiplexer.ts";
import * as ProjectMemoryPolicy from "../../projectMemory/ProjectMemoryPolicy.ts";
import * as ProjectMemoryStore from "../../projectMemory/ProjectMemoryStore.ts";
import * as SubagentResourceGovernor from "../../resourceProtection/SubagentResourceGovernor.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as ProjectContextQuery from "../query/ProjectContextQuery.ts";
import * as ProjectIndexingRuntime from "../runtime/ProjectIndexingRuntime.ts";
import * as ProjectIndexingRecovery from "../runtime/ProjectIndexingRecovery.ts";
import * as ProjectIndexingBridgeLive from "./ProjectIndexingBridgeLive.ts";

export const resourceProtectionLayer = SubagentResourceGovernor.layerLive;

const scopeDependencies = Layer.mergeAll(
  KnowledgeGraphScopeCatalog.layer,
  KnowledgeGraphWatcherMultiplexer.layer,
);
const indexingBridge = ProjectIndexingBridgeLive.layer.pipe(Layer.provideMerge(scopeDependencies));
const indexing = Layer.mergeAll(ProjectContextQuery.layer, ProjectIndexingRuntime.layer).pipe(
  Layer.provideMerge(indexingBridge),
);
const memory = Layer.unwrap(
  Effect.map(ServerConfig, (config) => ProjectMemoryStore.layer({ t3Home: config.baseDir })),
);
export const mcpConfigurationLayer = McpConfigEngineLive.pipe(
  Layer.provideMerge(
    McpConfigurationReconcilerLive.pipe(Layer.provideMerge(McpRuntimeRegistryLive)),
  ),
);
const skills = SkillEngineLive.pipe(Layer.provideMerge(mcpConfigurationLayer));
// Built below the orchestration runtime, so nothing in it may require OrchestratorV2.
export const turnPromptContextLayer = TurnPromptContext.layer.pipe(
  Layer.provide(Layer.mergeAll(skills, indexing, memory, DecisionGeneration.layer)),
);
const services = Layer.mergeAll(
  skills,
  indexing,
  KnowledgeGraphLive.layer,
  ProjectMemoryPolicy.layer,
  memory,
).pipe(Layer.provideMerge(WorkspaceContext.layer), Layer.provideMerge(resourceProtectionLayer));

export const layer = ProjectIndexingRecovery.layer.pipe(Layer.provideMerge(services));
