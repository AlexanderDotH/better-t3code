import { BETTER_T3_SETTINGS_CATEGORY_IDS } from "@t3tools/client-runtime/better-t3-settings-layout";
import { getSettingsNavGroups } from "@t3tools/client-runtime/settings-navigation";
import { EnvironmentId } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import { buildSettingsIndexSections } from "./SettingsRouteScreen.logic";
import { settingsIndexRowId } from "./components/settings-page-targets";
import { filterSettingsSections } from "./settings-search";

const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });

function index(overrides: Partial<Parameters<typeof buildSettingsIndexSections>[0]> = {}) {
  return buildSettingsIndexSections({
    translate: translator.message,
    connections: [
      { id: "account", icon: "person.crop.circle", label: "T3 Account" },
      {
        id: "SettingsEnvironments",
        icon: "desktopcomputer",
        label: "Environments",
        target: "SettingsEnvironments",
      },
    ],
    overflowRows: [],
    hasServerTargets: true,
    navigationCustomizationAvailable: true,
    secretsFeatureEnabled: false,
    ...overrides,
  });
}

describe("mobile settings index", () => {
  it("uses the web groups in order, inlining Better T3 categories and keeping mobile pages", () => {
    const sections = index();
    expect(sections.map((section) => section.title)).toEqual(
      getSettingsNavGroups({ secretsFeatureEnabled: false }).map((group) => group.heading),
    );
    expect(sections.map((section) => section.rows.map((row) => row.id))).toEqual([
      [
        ...BETTER_T3_SETTINGS_CATEGORY_IDS.map(
          (category) => `SettingsBetterT3Category:${category}`,
        ),
        "SettingsAgents",
        "SettingsProjects",
        "SettingsProjectIndexing",
      ],
      [
        "SettingsOrganization",
        "SettingsAppearance",
        "SettingsFollowUp",
        "SettingsDiffs",
        "SettingsKeyboard",
        "SettingsNavigation",
        "SettingsMicrophone",
        "SettingsUsage",
        "SettingsNotifications",
      ],
      ["SettingsProviderAccounts", "SettingsThreads", "SettingsDevices", "SettingsScheduledTasks"],
      [
        "SettingsProjectOverview",
        "SettingsEnvironmentSourceControl",
        "SettingsProjectScripts",
        "SettingsWorktrees",
      ],
      ["account", "SettingsEnvironments"],
      [
        "SettingsEnvironmentMaintenance",
        "SettingsLabs",
        "SettingsAbout",
        "SettingsUpdateEverything",
        "SettingsServerDiagnostics",
        "SettingsArchive",
      ],
    ]);
    expect(sections.flatMap((section) => section.rows).map((row) => row.target)).not.toContain(
      "SettingsBetterT3",
    );
  });

  it("opens each category directly in the selected environment and identifies its active row", () => {
    const environmentId = EnvironmentId.make("selected-server");
    const rows = index({ betterT3EnvironmentId: environmentId }).flatMap((section) => section.rows);
    for (const category of BETTER_T3_SETTINGS_CATEGORY_IDS) {
      const route = { name: "SettingsBetterT3Category", params: { category, environmentId } };
      const selected = settingsIndexRowId(route);
      const matches = rows.filter((row) => row.id === selected);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ target: route.name, params: route.params });
    }
    expect(settingsIndexRowId({ name: "SettingsAppearance" })).toBe("SettingsAppearance");
    expect(settingsIndexRowId(undefined)).toBeNull();
  });

  it("preserves server and project availability, feature flags, connections, and overflow tabs", () => {
    const sections = index({
      hasServerTargets: false,
      selectedProjectLabel: "Selected project",
      secretsFeatureEnabled: true,
      navigationCustomizationAvailable: false,
      connections: [{ id: "SettingsEnvironments", icon: "desktopcomputer", label: "Environments" }],
      overflowRows: [{ id: "pullRequests", icon: "arrow.triangle.branch", label: "Pull requests" }],
    });
    const rows = sections.flatMap((section) => section.rows);
    expect(rows.filter((row) => row.disabled).map((row) => row.id)).toEqual([
      "SettingsProviderAccounts",
      "SettingsThreads",
      "SettingsDevices",
      "SettingsEnvironmentSourceControl",
      "SettingsProjectScripts",
      "SettingsWorktrees",
      "SettingsSecrets",
      "SettingsEnvironmentMaintenance",
    ]);
    expect(rows.find((row) => row.id === "SettingsProjectOverview")?.value).toBe(
      "Selected project",
    );
    expect(rows.some((row) => row.id === "SettingsNavigation")).toBe(false);
    expect(rows.some((row) => row.id === "account")).toBe(false);
    expect(
      sections.find((section) => section.title === "Connections")?.rows.map((row) => row.id),
    ).toEqual(["SettingsEnvironments", "SettingsSecrets"]);
    expect(sections.find((section) => section.title === "T3 Code")?.rows.at(-1)?.id).toBe(
      "pullRequests",
    );
  });

  it.each([
    ["en", "Context usage indicator", "composer"],
    ["de", "Kontextnutzung", "composer"],
    ["fr", "contexte", "composer"],
    ["en", "Thinking trace", "chat"],
    ["de", "Kontextkompaktierung", "agents"],
  ] as const)("finds %s controls for %s", (language, query, category) => {
    const translate = createInterfaceTranslator({ language, locale: language }).message;
    const sections = index({ translate });
    expect(sections.map((section) => section.title)).toEqual(
      getSettingsNavGroups({ secretsFeatureEnabled: false }).map((group) =>
        translate(group.headingMessageId),
      ),
    );
    const matches = filterSettingsSections(sections, query).flatMap((section) => section.rows);
    expect(matches).toContainEqual(
      expect.objectContaining({ target: "SettingsBetterT3Category", params: { category } }),
    );
  });
});
