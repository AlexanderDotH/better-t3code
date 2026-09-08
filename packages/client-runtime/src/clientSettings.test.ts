import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";
import { mergeClientSettingsPatch } from "./clientSettings.js";

describe("client preference patches", () => {
  it("retains device initialization and unrelated feature flags", () => {
    const settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      betterT3Device: {
        ...DEFAULT_CLIENT_SETTINGS.betterT3Device,
        flags: { "chat.visual": true, "other.flag": false },
      },
    };
    const merged = mergeClientSettingsPatch(settings, {
      betterT3Device: { flags: { "chat.visual": false } },
    });
    expect(merged.betterT3Device.initialization).toBe(settings.betterT3Device.initialization);
    expect(merged.betterT3Device.version).toBe(settings.betterT3Device.version);
    expect(merged.betterT3Device.flags).toEqual({ "chat.visual": false, "other.flag": false });
    expect(settings.betterT3Device.flags["chat.visual"]).toBe(true);
  });
  it("applies ordinary client preferences without changing device flags", () => {
    const merged = mergeClientSettingsPatch(DEFAULT_CLIENT_SETTINGS, {
      wordWrap: !DEFAULT_CLIENT_SETTINGS.wordWrap,
    });
    expect(merged.wordWrap).toBe(!DEFAULT_CLIENT_SETTINGS.wordWrap);
    expect(merged.betterT3Device).toEqual(DEFAULT_CLIENT_SETTINGS.betterT3Device);
  });
});
