import { DEFAULT_CLIENT_SETTINGS, resolveBetterT3FeatureFlag } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clientPersistenceStorage", () => {
  it("persists client settings in browser storage", async () => {
    getTestWindow();
    const { readBrowserClientSettings, writeBrowserClientSettings } =
      await import("./clientPersistenceStorage");
    const settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      timestampFormat: "24-hour" as const,
    };

    writeBrowserClientSettings(settings);

    expect(readBrowserClientSettings()).toEqual(settings);
  });

  it("reports structured decode failures while preserving the fallback", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem("t3code:client-settings:v1", "not-json");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(readBrowserClientSettings()).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "Could not read persisted client settings.",
      expect.objectContaining({
        _tag: "LocalStorageOperationError",
        operation: "decode",
        storageKey: "t3code:client-settings:v1",
        cause: expect.anything(),
      }),
    );
  });

  it("defaults word wrap on and discards obsolete wrapping preferences", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        chatWordWrap: false,
        diffWordWrap: false,
      }),
    );
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");
    const settings = readBrowserClientSettings();

    expect(settings).toEqual(
      expect.objectContaining({
        wordWrap: true,
      }),
    );
    expect(settings).not.toHaveProperty("chatWordWrap");
    expect(settings).not.toHaveProperty("diffWordWrap");
  });

  it("preserves implicit Better T3 behavior when reading an existing settings record", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({ timestampFormat: "24-hour" }),
    );
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(readBrowserClientSettings()?.betterT3Device.initialization).toBe(
      "existing-install-migration",
    );
  });

  it("preserves an explicit Better T3 V1 record", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        betterT3Device: {
          version: 1,
          initialization: "clean-install",
          flags: { "chat.workspaceCardDeck": true },
        },
      }),
    );
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(readBrowserClientSettings()?.betterT3Device).toEqual({
      version: 1,
      initialization: "clean-install",
      flags: { "chat.workspaceCardDeck": true },
    });
  });

  it("preserves an explicit legacy enable when a clean V1 record has no feature flag yet", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        experimentalFetch: true,
        betterT3Device: {
          version: 1,
          initialization: "clean-install",
          flags: {},
        },
      }),
    );
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");
    const settings = readBrowserClientSettings();

    expect(settings).not.toBeNull();
    expect(resolveBetterT3FeatureFlag(settings!.betterT3Device, "agent.fetch")).toBe(true);
  });

  it("seeds missing Better T3 flags from explicit legacy values without overriding V1", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        experimentalFetch: true,
        experimentalParallelPlanImplementation: false,
        planModeEnabled: true,
        improvePromptBeforeSend: true,
        showExpandedComposerControls: true,
        showReasoning: true,
        legacySidebarEnabled: true,
        betterT3Device: {
          version: 1,
          initialization: "existing-install-migration",
          flags: {
            "agent.fetch": false,
            "chat.classicSidebar": false,
          },
        },
      }),
    );
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(readBrowserClientSettings()?.betterT3Device).toEqual({
      version: 1,
      initialization: "existing-install-migration",
      flags: {
        "agent.fetch": false,
        "chat.classicSidebar": false,
        "agent.parallelPlanImplementation": false,
        "agent.planMode": true,
        "agent.promptImprovement": true,
        "agent.expandedComposerControls": true,
        "agent.reasoningVisibility": true,
      },
    });
  });

  it("rejects malformed locale records without rewriting persisted data", async () => {
    const testWindow = getTestWindow();
    const raw = JSON.stringify({
      timestampFormat: "24-hour",
      interfaceLocaleLocalRecordV1: {
        version: 1,
        preference: "fr",
        updatedAt: -1,
        updateId: "web:fr",
      },
    });
    testWindow.localStorage.setItem("t3code:client-settings:v1", raw);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(readBrowserClientSettings()).toBeNull();
    expect(testWindow.localStorage.getItem("t3code:client-settings:v1")).toBe(raw);
    expect(consoleError).toHaveBeenCalledWith(
      "Could not read persisted client settings.",
      expect.objectContaining({
        _tag: "LocalStorageOperationError",
        operation: "decode",
      }),
    );
  });
});
