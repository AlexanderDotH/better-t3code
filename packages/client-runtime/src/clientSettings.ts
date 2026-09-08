import type { ClientSettings, ClientSettingsPatch } from "@t3tools/contracts/settings";

export function mergeClientSettingsPatch(
  settings: ClientSettings,
  patch: ClientSettingsPatch,
): ClientSettings {
  return {
    ...settings,
    ...patch,
    betterT3Device: {
      ...settings.betterT3Device,
      ...patch.betterT3Device,
      flags: { ...settings.betterT3Device.flags, ...patch.betterT3Device?.flags },
    },
  };
}
