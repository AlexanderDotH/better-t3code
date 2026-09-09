import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createMcpEnvironmentAtoms } from "../mcp/state.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createAgentSettingsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const mcp = createMcpEnvironmentAtoms(runtime);
  return {
    chatImport: {
      discoverQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
        label: "environment-data:chat-import:discover-query",
        tag: WS_METHODS.chatImportDiscover,
      }),
      discover: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:chat-import:discover",
        tag: WS_METHODS.chatImportDiscover,
      }),
      run: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:chat-import:run",
        tag: WS_METHODS.chatImportRun,
      }),
    },
    harnessChatSync: {
      sourcesQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
        label: "environment-data:harness-chat-sync:sources-query",
        tag: WS_METHODS.harnessChatSyncSources,
      }),
      listQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
        label: "environment-data:harness-chat-sync:list-query",
        tag: WS_METHODS.harnessChatSyncList,
      }),
      sources: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:harness-chat-sync:sources",
        tag: WS_METHODS.harnessChatSyncSources,
      }),
      list: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:harness-chat-sync:list",
        tag: WS_METHODS.harnessChatSyncList,
      }),
      run: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:harness-chat-sync:run",
        tag: WS_METHODS.harnessChatSyncRun,
      }),
      status: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:harness-chat-sync:status",
        tag: WS_METHODS.harnessChatSyncStatus,
      }),
    },
    skills: {
      previewRegistryQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
        label: "environment-data:skills:registry-preview",
        tag: WS_METHODS.skillsPreviewRegistry,
        staleTimeMs: 0,
      }),
      installRegistry: createEnvironmentRpcCommand(runtime, {
        label: "environment-data:skills:registry-install",
        tag: WS_METHODS.skillsInstallRegistry,
      }),
      listQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
        label: "environment-data:skills:list-query",
        tag: WS_METHODS.skillsList,
        staleTimeMs: 0,
      }),
      importSourcesQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
        label: "environment-data:skills:import-sources-query",
        tag: WS_METHODS.skillsDiscoverImportSources,
      }),
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
    mcp,
    catalogSearchQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:extensions:search",
      tag: WS_METHODS.extensionCatalogSearch,
    }),
  };
}
