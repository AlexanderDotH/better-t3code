import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("desktop platform detection", () => {
  it.each([
    { platform: "darwin", mac: true },
    { platform: "win32", mac: false },
    { platform: "linux", mac: false },
  ])("limits native window transparency to Electron on $platform", async ({ platform, mac }) => {
    vi.stubGlobal("window", { desktopBridge: { getClientPlatform: () => platform } });
    const env = await import("./env.ts");
    expect(env.isElectron).toBe(true);
    expect(env.isMacElectron).toBe(mac);
  });

  it.each([
    { environment: "server rendering", window: undefined, electron: false },
    { environment: "browser", window: {}, electron: false },
    { environment: "older desktop bridge", window: { desktopBridge: {} }, electron: true },
  ])("does not enable vibrancy during $environment", async (input) => {
    vi.stubGlobal("window", input.window);
    const env = await import("./env.ts");
    expect(env.isElectron).toBe(input.electron);
    expect(env.isMacElectron).toBe(false);
  });
});
