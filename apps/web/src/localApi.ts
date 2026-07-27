import type { ContextMenuItem, LocalApi } from "@t3tools/contracts";
import type { WsRpcClient } from "@t3tools/client-runtime/wsRpcClient";

import { resetRequestLatencyStateForTests } from "./rpc/requestLatencyState";
import { showContextMenuFallback } from "./contextMenuFallback";
import { readBrowserClientSettings, writeBrowserClientSettings } from "./clientPersistenceStorage";

let cachedApi: LocalApi | undefined;

function unavailableLocalBackendError(): Error {
  return new Error("Local backend API is unavailable before a backend is paired.");
}

function createBrowserLocalApi(rpcClient?: WsRpcClient): LocalApi {
  return {
    dialogs: {
      pickFolder: async (options) => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder(options);
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    shell: {
      openInEditor: () => Promise.reject(unavailableLocalBackendError()),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    persistence: {
      getClientSettings: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getClientSettings();
        }
        return readBrowserClientSettings();
      },
      setClientSettings: async (settings) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setClientSettings(settings);
        }
        writeBrowserClientSettings(settings);
      },
    },
    server: {
      getConfig: () =>
        rpcClient ? rpcClient.server.getConfig() : Promise.reject(unavailableLocalBackendError()),
      refreshProviders: () =>
        rpcClient
          ? rpcClient.server.refreshProviders()
          : Promise.reject(unavailableLocalBackendError()),
      updateProvider: (input) =>
        rpcClient
          ? rpcClient.server.updateProvider(input)
          : Promise.reject(unavailableLocalBackendError()),
      upsertKeybinding: (input) =>
        rpcClient
          ? rpcClient.server.upsertKeybinding(input)
          : Promise.reject(unavailableLocalBackendError()),
      removeKeybinding: (input) =>
        rpcClient
          ? rpcClient.server.removeKeybinding(input)
          : Promise.reject(unavailableLocalBackendError()),
      getSettings: () =>
        rpcClient ? rpcClient.server.getSettings() : Promise.reject(unavailableLocalBackendError()),
      updateSettings: (patch) =>
        rpcClient
          ? rpcClient.server.updateSettings(patch)
          : Promise.reject(unavailableLocalBackendError()),
      createAssemblyAiStreamingToken: (input) =>
        rpcClient
          ? rpcClient.server.createAssemblyAiStreamingToken(input)
          : Promise.reject(unavailableLocalBackendError()),
      discoverSourceControl: () =>
        rpcClient
          ? rpcClient.server.discoverSourceControl()
          : Promise.reject(unavailableLocalBackendError()),
      getTraceDiagnostics: () =>
        rpcClient
          ? rpcClient.server.getTraceDiagnostics()
          : Promise.reject(unavailableLocalBackendError()),
      getProcessDiagnostics: () =>
        rpcClient
          ? rpcClient.server.getProcessDiagnostics()
          : Promise.reject(unavailableLocalBackendError()),
      getProcessResourceHistory: (input) =>
        rpcClient
          ? rpcClient.server.getProcessResourceHistory(input)
          : Promise.reject(unavailableLocalBackendError()),
      signalProcess: (input) =>
        rpcClient
          ? rpcClient.server.signalProcess(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
    speech: {
      getProjectProfile: (input) =>
        rpcClient
          ? rpcClient.speech.getProjectProfile(input)
          : Promise.reject(unavailableLocalBackendError()),
      listProjectProfiles: () =>
        rpcClient
          ? rpcClient.speech.listProjectProfiles()
          : Promise.reject(unavailableLocalBackendError()),
      indexProject: (input) =>
        rpcClient
          ? rpcClient.speech.indexProject(input)
          : Promise.reject(unavailableLocalBackendError()),
      createBasicProjectProfile: (input) =>
        rpcClient
          ? rpcClient.speech.createBasicProjectProfile(input)
          : Promise.reject(unavailableLocalBackendError()),
      translateTranscript: (input) =>
        rpcClient
          ? rpcClient.speech.translateTranscript(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
    prompt: {
      improve: (input) =>
        rpcClient
          ? rpcClient.prompt.improve(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
    chatImport: {
      discover: (input) =>
        rpcClient
          ? rpcClient.chatImport.discover(input)
          : Promise.reject(unavailableLocalBackendError()),
      run: (input) =>
        rpcClient
          ? rpcClient.chatImport.run(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
    skills: {
      list: (input) =>
        rpcClient ? rpcClient.skills.list(input) : Promise.reject(unavailableLocalBackendError()),
      discoverImportSources: (input) =>
        rpcClient
          ? rpcClient.skills.discoverImportSources(input)
          : Promise.reject(unavailableLocalBackendError()),
      importSources: (input) =>
        rpcClient
          ? rpcClient.skills.importSources(input)
          : Promise.reject(unavailableLocalBackendError()),
      create: (input) =>
        rpcClient ? rpcClient.skills.create(input) : Promise.reject(unavailableLocalBackendError()),
      update: (input) =>
        rpcClient ? rpcClient.skills.update(input) : Promise.reject(unavailableLocalBackendError()),
      rename: (input) =>
        rpcClient ? rpcClient.skills.rename(input) : Promise.reject(unavailableLocalBackendError()),
      delete: (input) =>
        rpcClient ? rpcClient.skills.delete(input) : Promise.reject(unavailableLocalBackendError()),
      setEnabled: (input) =>
        rpcClient
          ? rpcClient.skills.setEnabled(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
    mcp: {
      list: (input) =>
        rpcClient ? rpcClient.mcp.list(input) : Promise.reject(unavailableLocalBackendError()),
      discoverImportSources: (input) =>
        rpcClient
          ? rpcClient.mcp.discoverImportSources(input)
          : Promise.reject(unavailableLocalBackendError()),
      create: (input) =>
        rpcClient ? rpcClient.mcp.create(input) : Promise.reject(unavailableLocalBackendError()),
      update: (input) =>
        rpcClient ? rpcClient.mcp.update(input) : Promise.reject(unavailableLocalBackendError()),
      delete: (input) =>
        rpcClient ? rpcClient.mcp.delete(input) : Promise.reject(unavailableLocalBackendError()),
      setEnabled: (input) =>
        rpcClient
          ? rpcClient.mcp.setEnabled(input)
          : Promise.reject(unavailableLocalBackendError()),
      importCursorJson: (input) =>
        rpcClient
          ? rpcClient.mcp.importCursorJson(input)
          : Promise.reject(unavailableLocalBackendError()),
      importSources: (input) =>
        rpcClient
          ? rpcClient.mcp.importSources(input)
          : Promise.reject(unavailableLocalBackendError()),
      exportCursorJson: (input) =>
        rpcClient
          ? rpcClient.mcp.exportCursorJson(input)
          : Promise.reject(unavailableLocalBackendError()),
      providerStatus: (input) =>
        rpcClient
          ? rpcClient.mcp.providerStatus(input)
          : Promise.reject(unavailableLocalBackendError()),
    },
  };
}

export function createLocalApi(rpcClient?: WsRpcClient): LocalApi {
  return createBrowserLocalApi(rpcClient);
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  cachedApi = createBrowserLocalApi();
  return cachedApi;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    throw new Error("Local API not found");
  }
  return api;
}

export async function __resetLocalApiForTests() {
  cachedApi = undefined;
  const { __resetClientSettingsPersistenceForTests } = await import("./hooks/useSettings");
  __resetClientSettingsPersistenceForTests();
  resetRequestLatencyStateForTests();
}
