import * as Layer from "effect/Layer";

import { makeMcpConfigEngine } from "./McpConfigPersistence.ts";
import { McpConfigEngine } from "./McpConfigService.ts";

export { exportCursorMcpServersJson, importCursorMcpServers } from "./McpCursorInterop.ts";
export {
  getMcpProviderStatuses,
  managedMcpProviderKey,
  toAcpMcpServers,
  toClaudeMcpServers,
  toOpenCodeMcpServers,
  type ClaudeMcpServerConfig,
  type OpenCodeMcpServerConfig,
} from "./McpProviderConfigProjection.ts";
export { resolveActiveMcpServers } from "./McpServerResolution.ts";
export {
  McpConfigEngine,
  type McpConfigEngineShape,
  type ResolveActiveMcpServersInput,
} from "./McpConfigService.ts";

export const McpConfigEngineLive = Layer.effect(McpConfigEngine, makeMcpConfigEngine);
