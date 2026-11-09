import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
export function resolveAgentAwarenessPlatformPresentation(platform: string): {
  readonly supported: boolean;
  readonly subtitle: string | undefined;
} {
  return platform === "ios" || platform === "android"
    ? { supported: true, subtitle: undefined }
    : {
        supported: false,
        subtitle: currentInterfaceTranslator().message("mobile.ui.unavailableOnThisPlatform"),
      };
}
