import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createAgentSettingsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    chatImport: {
      discover: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:chat-import:discover",
        tag: WS_METHODS.chatImportDiscover,
      }),
      run: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:chat-import:run",
        tag: WS_METHODS.chatImportRun,
      }),
    },
    skills: {
      list: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:list",
        tag: WS_METHODS.skillsList,
      }),
      discoverImportSources: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:discover-import-sources",
        tag: WS_METHODS.skillsDiscoverImportSources,
      }),
      importSources: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:import-sources",
        tag: WS_METHODS.skillsImportSources,
      }),
      create: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:create",
        tag: WS_METHODS.skillsCreate,
      }),
      update: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:update",
        tag: WS_METHODS.skillsUpdate,
      }),
      rename: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:rename",
        tag: WS_METHODS.skillsRename,
      }),
      delete: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:delete",
        tag: WS_METHODS.skillsDelete,
      }),
      setEnabled: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:set-enabled",
        tag: WS_METHODS.skillsSetEnabled,
      }),
    },
    mcp: {
      list: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:list",
        tag: WS_METHODS.mcpList,
      }),
      discoverImportSources: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:discover-import-sources",
        tag: WS_METHODS.mcpDiscoverImportSources,
      }),
      create: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:create",
        tag: WS_METHODS.mcpCreate,
      }),
      update: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:update",
        tag: WS_METHODS.mcpUpdate,
      }),
      delete: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:delete",
        tag: WS_METHODS.mcpDelete,
      }),
      setEnabled: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:set-enabled",
        tag: WS_METHODS.mcpSetEnabled,
      }),
      importCursorJson: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:import-cursor-json",
        tag: WS_METHODS.mcpImportCursorJson,
      }),
      importSources: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:import-sources",
        tag: WS_METHODS.mcpImportSources,
      }),
      exportCursorJson: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:export-cursor-json",
        tag: WS_METHODS.mcpExportCursorJson,
      }),
      providerStatus: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:mcp:provider-status",
        tag: WS_METHODS.mcpProviderStatus,
      }),
    },
  };
}
