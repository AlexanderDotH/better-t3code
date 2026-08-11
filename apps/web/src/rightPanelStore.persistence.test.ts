import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const STORAGE_KEY = "t3code:right-panel-state:v2";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("rightPanelStore persisted-state hydration", () => {
  it("rehydrates v11 tabs, removes the retired Agents surface, and rewrites the current version", async () => {
    const localStorage = createLocalStorageStub();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 11,
        state: {
          byThreadKey: {
            "env-1:thread-A": {
              isOpen: true,
              activeSurfaceId: "agents",
              surfaces: [
                { id: "agents", kind: "agents" },
                { id: "browser:tab-a", kind: "preview", resourceId: "tab-a" },
              ],
            },
          },
        },
      }),
    );
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    const { useRightPanelStore } = await import("./rightPanelStore");
    await useRightPanelStore.persist.rehydrate();

    expect(useRightPanelStore.getState().byThreadKey).toEqual({
      "env-1:thread-A": {
        isOpen: true,
        activeSurfaceId: "browser:tab-a",
        surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
      },
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      version: 12,
    });
  });
});
