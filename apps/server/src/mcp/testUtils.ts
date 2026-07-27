import { McpConfigEngine } from "./McpConfigEngine.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const NoOpMcpConfigEngineLayer = Layer.succeed(McpConfigEngine, {
  list: Effect.succeed({ servers: [] }),
  create: () => Effect.succeed({ servers: [] }),
  update: () => Effect.succeed({ servers: [] }),
  delete: () => Effect.succeed({ servers: [] }),
  setEnabled: () => Effect.succeed({ servers: [] }),
  importCursorJson: () => Effect.succeed({ servers: [] }),
  discoverImportSources: Effect.succeed({ sources: [] }),
  importSources: () => Effect.succeed({ servers: [] }),
  exportCursorJson: () => Effect.succeed({ json: '{\n  "mcpServers": {}\n}', servers: [] }),
  providerStatus: () => Effect.succeed({ providers: [] }),
  resolveActiveServers: () => Effect.succeed([]),
});
