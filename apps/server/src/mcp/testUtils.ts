import { McpConfigEngine } from "./McpConfigEngine.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const NoOpMcpConfigEngineLayer = Layer.succeed(McpConfigEngine, {
  list: Effect.succeed({ servers: [], liveApplyResults: [] }),
  create: () => Effect.succeed({ servers: [], liveApplyResults: [] }),
  update: () => Effect.succeed({ servers: [], liveApplyResults: [] }),
  delete: () => Effect.succeed({ servers: [], liveApplyResults: [] }),
  setEnabled: () => Effect.succeed({ servers: [], liveApplyResults: [] }),
  setProviderEnabled: () => Effect.succeed({ servers: [], liveApplyResults: [] }),
  importCursorJson: () => Effect.succeed({ servers: [], liveApplyResults: [] }),
  discoverImportSources: Effect.succeed({ sources: [] }),
  importSources: () => Effect.succeed({ servers: [], liveApplyResults: [] }),
  exportCursorJson: () => Effect.succeed({ json: '{\n  "mcpServers": {}\n}', servers: [] }),
  providerStatus: () => Effect.succeed({ providers: [] }),
  resolveActiveServers: () => Effect.succeed([]),
});
