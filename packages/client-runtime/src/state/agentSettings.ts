import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createMcpEnvironmentAtoms } from "../mcp/state.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

export function createAgentSettingsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const mcp = createMcpEnvironmentAtoms(runtime);
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
    mcp,
  };
}
