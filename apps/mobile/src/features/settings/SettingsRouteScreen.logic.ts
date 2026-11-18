import {
  BETTER_T3_SETTINGS_CATEGORY_IDS,
  getBetterT3SettingsSubgroups,
  type BetterT3SettingsCategoryId,
  type BetterT3SettingsSubgroupId,
} from "@t3tools/client-runtime/better-t3-settings-layout";
import {
  getSettingsNavGroups,
  type SettingsPath,
} from "@t3tools/client-runtime/settings-navigation";
import { BETTER_T3_FEATURE_REGISTRY, type EnvironmentId } from "@t3tools/contracts";
import {
  isInterfaceMessageKey,
  type InterfaceMessageKey,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";
import type { ComponentProps } from "react";

import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
import { BETTER_T3_CATEGORY_ICONS } from "./better-t3-category-icons";
import type { SettingsRow } from "./components/SettingsRow";
import { settingsIndexRowId, type SettingsPageTarget } from "./components/settings-page-targets";
import type { SettingsSearchRow } from "./settings-search";

export type SettingsListRow = ComponentProps<typeof SettingsRow> & SettingsSearchRow;

interface SettingsListSection {
  readonly title: string;
  readonly rows: readonly SettingsListRow[];
}

const SUPPLEMENTAL_BETTER_T3_SEARCH_MESSAGES: Partial<
  Record<BetterT3SettingsSubgroupId, readonly InterfaceMessageKey[]>
> = {
  "context-display": ["settings.contextMeter.label", "settings.contextMeter.description"],
  "response-metrics": ["settings.responseMetrics.label", "settings.responseMetrics.description"],
};

function betterT3CategorySearchTerms(
  category: BetterT3SettingsCategoryId,
  translate: InterfaceTranslator["message"],
): string[] {
  return getBetterT3SettingsSubgroups(category).flatMap((group) => [
    translate(group.titleMessageId),
    ...(SUPPLEMENTAL_BETTER_T3_SEARCH_MESSAGES[group.id] ?? []).map((key) => translate(key)),
    ...group.targetIds.map((target) => target.replaceAll(/[.-]/g, " ")),
    ...BETTER_T3_FEATURE_REGISTRY.filter(
      (feature) =>
        group.featureIds.includes(feature.id) &&
        feature.availability.surfaces.some(
          (surface) => surface === "phone" || surface === "tablet",
        ),
    ).flatMap((feature) =>
      [feature.labelMessageId, feature.descriptionMessageId].flatMap((key) =>
        isInterfaceMessageKey(key) ? [translate(key)] : [],
      ),
    ),
  ]);
}

export function buildSettingsIndexSections(input: {
  readonly translate: InterfaceTranslator["message"];
  readonly connections: readonly SettingsListRow[];
  readonly overflowRows: readonly SettingsListRow[];
  readonly hasServerTargets: boolean;
  readonly navigationCustomizationAvailable: boolean;
  readonly secretsFeatureEnabled: boolean;
  readonly selectedProjectLabel?: string;
  readonly betterT3EnvironmentId?: EnvironmentId;
}): SettingsListSection[] {
  const { translate } = input;
  const page = (
    target: SettingsPageTarget,
    icon: SettingsListRow["icon"],
    label: string,
    extra?: Pick<SettingsListRow, "disabled" | "value">,
  ): SettingsListRow => ({ id: target, icon, label, target, ...extra });
  const serverPage = (target: SettingsPageTarget, icon: SettingsListRow["icon"], label: string) =>
    page(target, icon, label, { disabled: !input.hasServerTargets });
  const pages: Partial<Record<SettingsPath, readonly SettingsListRow[]>> = {
    "/settings/better-t3": BETTER_T3_SETTINGS_CATEGORY_IDS.map((category) => ({
      id: settingsIndexRowId({ name: "SettingsBetterT3Category", params: { category } })!,
      target: "SettingsBetterT3Category",
      params: {
        category,
        ...(input.betterT3EnvironmentId ? { environmentId: input.betterT3EnvironmentId } : {}),
      },
      icon: BETTER_T3_CATEGORY_ICONS[category],
      label: translate(`settings.betterT3.tab.${category}`),
      searchTerms: betterT3CategorySearchTerms(category, translate),
    })),
    "/settings/mcp": [
      page("SettingsAgents", "person.2", translate("mobile.settings.agentSettings")),
    ],
    "/settings/import-chats": [
      page("SettingsProjects", "text.bubble", translate("settings.application.title.importChats")),
      page(
        "SettingsProjectIndexing",
        "folder",
        translate("settings.betterT3.subgroup.project-indexing"),
      ),
    ],
    "/settings/general": [
      page("SettingsOrganization", "gearshape", translate("settings.general.title")),
    ],
    "/settings/appearance": [
      page("SettingsAppearance", "paintbrush", translate("settings.appearance.title")),
    ],
    "/settings/chat": [
      page(
        "SettingsFollowUp",
        "bubble.left.and.bubble.right",
        translate("settings.betterT3.tab.chat"),
      ),
    ],
    "/settings/diffs": [
      page(
        "SettingsDiffs",
        "chevron.left.forwardslash.chevron.right",
        translate("mobile.prefs.diffs"),
      ),
    ],
    "/settings/keybindings": [
      page("SettingsKeyboard", "keyboard", translate("mobile.settings.keyboard")),
    ],
    "/settings/providers": [
      serverPage(
        "SettingsProviderAccounts",
        "person.crop.circle",
        translate("settings.application.section.providers"),
      ),
    ],
    "/settings/threads": [
      serverPage("SettingsThreads", "text.bubble", translate("mobile.settings.section.threads")),
    ],
    "/settings/devices": [
      serverPage("SettingsDevices", "iphone", translate("mobile.projects.devices.title")),
    ],
    "/settings/scheduled-tasks": [
      page("SettingsScheduledTasks", "clock", translate("mobile.settings.scheduledTasks")),
    ],
    "/settings/projects": [
      page(
        "SettingsProjectOverview",
        "folder",
        translate("settings.projects.detail.projects"),
        input.selectedProjectLabel !== undefined
          ? { value: input.selectedProjectLabel }
          : undefined,
      ),
    ],
    "/settings/source-control": [
      serverPage(
        "SettingsEnvironmentSourceControl",
        "arrow.triangle.branch",
        translate("settings.application.title.sourceControl"),
      ),
      serverPage("SettingsProjectScripts", "terminal", translate("mobile.projects.scripts.title")),
    ],
    "/settings/worktrees": [
      serverPage("SettingsWorktrees", "square.on.square", translate("mobile.settings.worktrees")),
    ],
    "/settings/connections": input.connections,
    "/settings/secrets": [
      serverPage("SettingsSecrets", "lock", translate("mobile.access.secrets")),
    ],
    "/settings/maintenance": [
      serverPage(
        "SettingsEnvironmentMaintenance",
        "arrow.clockwise",
        translate("mobile.settings.maintenance"),
      ),
    ],
    "/settings/labs": [page("SettingsLabs", "sparkles", translate("mobile.settings.labs"))],
    "/settings/about": [
      page("SettingsAbout", "info.circle", translate("settings.about.title")),
      page(
        "SettingsUpdateEverything",
        "arrow.clockwise",
        translate("mobile.insights.updates.title"),
      ),
      page(
        "SettingsServerDiagnostics",
        "stethoscope",
        translate("mobile.insights.serverDiagnostics"),
      ),
    ],
    "/settings/archived": [
      page("SettingsArchive", "archivebox", translate("settings.application.section.archive")),
    ],
  };
  const mobilePreferences = [
    ...(input.navigationCustomizationAvailable
      ? [
          page(
            "SettingsNavigation",
            "line.3.horizontal",
            translate("mobile.settings.navigationTabs"),
          ),
        ]
      : []),
    page("SettingsMicrophone", "mic", translate("mobile.settings.microphone")),
    page("SettingsUsage", "chart.bar.xaxis", translate("sidebar.navigation.usage")),
    page("SettingsNotifications", "bell.badge", translate("mobile.ui.notifications")),
    ...input.overflowRows,
  ];
  return getSettingsNavGroups({ secretsFeatureEnabled: input.secretsFeatureEnabled }).flatMap(
    (group) => {
      const rows = [
        ...group.paths.flatMap((path) => pages[path] ?? []),
        ...(group.heading === "T3 Code" ? mobilePreferences : []),
      ];
      return rows.length ? [{ title: translate(group.headingMessageId), rows }] : [];
    },
  );
}

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
