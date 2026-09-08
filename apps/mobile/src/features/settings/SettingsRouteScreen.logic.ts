export function resolveAgentAwarenessPlatformPresentation(platform: string): {
  readonly supported: boolean;
  readonly subtitleMessageKey: "mobile.settings.notifications.iosOnly" | undefined;
} {
  return platform === "ios"
    ? { supported: true, subtitleMessageKey: undefined }
    : {
        supported: false,
        subtitleMessageKey: "mobile.settings.notifications.iosOnly",
      };
}
