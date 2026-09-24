import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { handle, on, registerSchemesAsPrivileged, removeHandler, removeListener } = vi.hoisted(
  () => ({
    handle: vi.fn(),
    on: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(() => {
      throw new Error("protocol.registerSchemesAsPrivileged should be called before app is ready");
    }),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
  }),
);

vi.mock("electron", () => ({
  app: {
    hasSingleInstanceLock: () => true,
    on,
    removeListener,
    setAsDefaultProtocolClient: () => true,
  },
  BrowserWindow: {},
  ipcMain: { handle, removeHandler },
  protocol: { registerSchemesAsPrivileged },
  shell: {},
}));

import { createClerkBridge } from "@clerk/electron";

describe("Clerk renderer scheme integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps OAuth transport when the app registered its scheme before ready", () => {
    const bridge = createClerkBridge({
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      renderer: { scheme: "t3code", host: "app" },
      registerRendererScheme: false,
    });

    expect(bridge.isPrimaryInstance).toBe(true);
    expect(registerSchemesAsPrivileged).not.toHaveBeenCalled();
    expect(on.mock.calls.map(([event]) => event)).toEqual(["open-url", "second-instance"]);
    expect(handle).toHaveBeenCalledTimes(5);

    bridge.cleanup();
    expect(removeHandler).toHaveBeenCalledTimes(5);
    expect(removeListener).toHaveBeenCalledTimes(2);
  });
});
