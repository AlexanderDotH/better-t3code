import { McpConfigEngine } from "./McpConfigEngine.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const NoOpMcpConfigEngineLayer = Layer.succeed(McpConfigEngine, {
  list: Effect.succeed({ servers: [], liveApplyResults: [] }),
  create: Effect.fn("create")(function () {
    return Effect.succeed({ servers: [], liveApplyResults: [] });
  }),
  update: Effect.fn("update")(function () {
    return Effect.succeed({ servers: [], liveApplyResults: [] });
  }),
  delete: Effect.fn("delete")(function () {
    return Effect.succeed({ servers: [], liveApplyResults: [] });
  }),
  setEnabled: Effect.fn("setEnabled")(function () {
    return Effect.succeed({ servers: [], liveApplyResults: [] });
  }),
  setProviderEnabled: Effect.fn("setProviderEnabled")(function () {
    return Effect.succeed({ servers: [], liveApplyResults: [] });
  }),
  importCursorJson: Effect.fn("importCursorJson")(function () {
    return Effect.succeed({ servers: [], liveApplyResults: [] });
  }),
  discoverImportSources: Effect.succeed({ sources: [] }),
  importSources: Effect.fn("importSources")(function () {
    return Effect.succeed({ servers: [], liveApplyResults: [] });
  }),
  exportCursorJson: Effect.fn("exportCursorJson")(function () {
    return Effect.succeed({ json: '{\n  "mcpServers": {}\n}', servers: [] });
  }),
  providerStatus: Effect.fn("providerStatus")(function () {
    return Effect.succeed({ providers: [] });
  }),
  resolveActiveServers: Effect.fn("resolveActiveServers")(function () {
    return Effect.succeed([]);
  }),
});
