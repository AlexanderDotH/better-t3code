/** Settings pages a Settings row opens. */
export const SETTINGS_PAGE_TARGETS = [
  "SettingsBetterT3",
  "SettingsAgents",
  "SettingsProjects",
  "SettingsProjectIndexing",
  "SettingsBetterT3ResourceDiagnostics",
  "SettingsBetterT3TranscriptPortability",
  "SettingsEnvironments",
  "SettingsSecrets",
  "SettingsNotifications",
  "SettingsThreads",
  "SettingsAbout",
  "SettingsArchive",
  "SettingsAppearance",
  "SettingsDiffs",
  "SettingsNavigation",
  "SettingsOrganization",
  "SettingsProjectOverview",
  "SettingsEnvironmentSourceControl",
  "SettingsWorktrees",
  "SettingsDevices",
  "SettingsProjectScripts",
  "SettingsLabs",
  "SettingsEnvironmentMaintenance",
  "SettingsProviderAccounts",
  "SettingsKeyboard",
  "SettingsMicrophone",
  "SettingsFollowUp",
  "SettingsScheduledTasks",
  "SettingsProjectGrouping",
  "SettingsClientStorage",
  "SettingsDiagnostics",
  "SettingsServerDiagnostics",
  "SettingsUpdateEverything",
  "SettingsOpenSourceLicenses",
  "SettingsUsage",
] as const;

export type SettingsPageTarget = (typeof SETTINGS_PAGE_TARGETS)[number];

export type SettingsLegalDocumentTarget = "SettingsLegal";

export function settingsIndexRowId(
  route: { readonly name: string; readonly params?: object } | null | undefined,
): string | null {
  if (!route) return null;
  if (route.name === "SettingsBetterT3Category") {
    const category = (route.params as { readonly category?: unknown } | undefined)?.category;
    if (typeof category === "string") return `${route.name}:${category}`;
  }
  return route.name;
}
