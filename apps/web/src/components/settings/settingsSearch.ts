import { isElectron, isMacElectron } from "~/env";
import {
  translateInterfaceMessage,
  type InterfaceMessageKey,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";

export type SettingsPath =
  | "/settings/general"
  | "/settings/projects"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/better-t3"
  | "/settings/skills"
  | "/settings/mcp"
  | "/settings/integrations"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/experimental"
  | "/settings/import-chats"
  | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  // Its row only renders in the desktop app, so a browser result would land on
  // an anchor that isn't there.
  readonly desktopOnly?: boolean;
  readonly macosOnly?: boolean;
}

type Translate = InterfaceTranslator["message"];

interface SettingsSearchItemDefinition extends Omit<SettingsSearchItem, "title"> {
  readonly titleMessageId: InterfaceMessageKey;
}

const translateEnglish: Translate = (key, values) => translateInterfaceMessage("en", key, values);

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
const SETTINGS_SECTION_MESSAGE_IDS: Readonly<Record<SettingsPath, InterfaceMessageKey>> = {
  "/settings/general": "settings.application.section.general",
  "/settings/projects": "settings.application.section.projects",
  "/settings/appearance": "settings.application.section.appearance",
  "/settings/keybindings": "settings.application.section.keybindings",
  "/settings/providers": "settings.application.section.providers",
  "/settings/better-t3": "settings.application.section.betterT3",
  "/settings/skills": "settings.application.section.skills",
  "/settings/mcp": "settings.application.section.mcp",
  "/settings/integrations": "settings.application.section.integrations",
  "/settings/source-control": "settings.application.section.sourceControl",
  "/settings/connections": "settings.application.section.connections",
  "/settings/experimental": "settings.application.section.experimental",
  "/settings/import-chats": "settings.application.section.importChats",
  "/settings/archived": "settings.application.section.archive",
};

export function resolveSettingsSectionLabels(
  translate: Translate,
): Readonly<Record<SettingsPath, string>> {
  return Object.fromEntries(
    (
      Object.entries(SETTINGS_SECTION_MESSAGE_IDS) as Array<
        readonly [SettingsPath, InterfaceMessageKey]
      >
    ).map(([path, messageId]) => [path, translate(messageId)]),
  ) as Readonly<Record<SettingsPath, string>>;
}

/** English compatibility projection for older consumers and behavior tests. */
export const SETTINGS_SECTION_LABELS = resolveSettingsSectionLabels(translateEnglish);

/**
 * Every searchable setting, in result order. This catalog is the single
 * source of truth for anchor ids and visible titles: panels render both via
 * `searchableSetting`, so a retitle (or, later, a translation pass) happens
 * here once instead of separately in the panel and the index.
 */
const SETTINGS_SEARCH_ITEM_DEFINITIONS = [
  {
    id: "better-t3",
    titleMessageId: "settings.application.title.betterT3",
    to: "/settings/better-t3",
  },
  {
    id: "better-t3-knowledge-graph",
    titleMessageId: "settings.application.title.knowledgeGraph",
    to: "/settings/better-t3",
    targetId: "knowledge.graph",
  },
  {
    id: "harness-chat-sync",
    titleMessageId: "settings.application.title.harnessChatSync",
    to: "/settings/projects",
  },
  {
    id: "checkpoints",
    titleMessageId: "settings.application.title.checkpoints",
    to: "/settings/projects",
  },
  {
    id: "color-scheme",
    titleMessageId: "settings.application.title.colorScheme",
    to: "/settings/appearance",
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    titleMessageId: "settings.application.title.themes",
    to: "/settings/appearance",
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    id: "interface-language",
    titleMessageId: "settings.application.title.interfaceLanguage",
    to: "/settings/appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    titleMessageId: "settings.application.title.contrast",
    to: "/settings/appearance",
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    titleMessageId: "settings.application.title.glassOpacity",
    to: "/settings/appearance",
  },
  {
    id: "model-reasoning",
    titleMessageId: "settings.application.title.modelReasoning",
    to: "/settings/appearance",
  },
  {
    id: "macos-window-transparency",
    titleMessageId: "settings.application.title.macosTransparency",
    to: "/settings/appearance",
    macosOnly: true,
  },
  {
    id: "chat-visuals",
    titleMessageId: "settings.application.title.chatVisuals",
    to: "/settings/appearance",
  },
  {
    id: "expanded-chat-controls",
    titleMessageId: "settings.application.title.expandedChatControls",
    to: "/settings/appearance",
  },
  {
    id: "environment-identification",
    titleMessageId: "settings.application.title.environmentIdentification",
    to: "/settings/appearance",
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance",
  },
  {
    id: "sidebar-layout",
    titleMessageId: "settings.application.title.sidebarLayout",
    to: "/settings/appearance",
  },
  {
    id: "chats-per-project",
    titleMessageId: "settings.application.title.chatsPerProject",
    to: "/settings/appearance",
  },
  {
    id: "interface-font",
    titleMessageId: "settings.application.title.interfaceFont",
    to: "/settings/appearance",
  },
  {
    id: "prompt-font",
    titleMessageId: "settings.application.title.promptFont",
    to: "/settings/appearance",
  },
  {
    id: "code-font",
    titleMessageId: "settings.application.title.codeFont",
    to: "/settings/appearance",
  },
  {
    id: "terminal-font",
    titleMessageId: "settings.application.title.terminalFont",
    to: "/settings/appearance",
  },
  {
    id: "font-smoothing",
    titleMessageId: "settings.application.title.fontSmoothing",
    to: "/settings/appearance",
  },
  {
    id: "word-wrap",
    titleMessageId: "settings.application.title.wordWrap",
    to: "/settings/appearance",
  },
  {
    id: "project-grouping",
    titleMessageId: "settings.application.title.projectGrouping",
    to: "/settings/general",
  },
  {
    id: "auto-settle-inactive-threads",
    titleMessageId: "settings.application.title.autoSettleInactive",
    to: "/settings/general",
  },
  {
    id: "auto-settle-merged-threads",
    titleMessageId: "settings.application.title.autoSettleMerged",
    to: "/settings/general",
  },
  {
    id: "time-format",
    titleMessageId: "settings.application.title.timeFormat",
    to: "/settings/general",
  },
  {
    id: "hide-whitespace-changes",
    titleMessageId: "settings.application.title.hideWhitespace",
    to: "/settings/general",
  },
  {
    id: "skills-in-slash-menu",
    titleMessageId: "settings.application.title.skillsSlashMenu",
    to: "/settings/skills",
  },
  {
    id: "provider-update-checks",
    titleMessageId: "settings.application.title.providerUpdateChecks",
    to: "/settings/general",
  },
  {
    id: "new-threads",
    titleMessageId: "settings.application.title.newThreads",
    to: "/settings/general",
  },
  {
    id: "start-from-origin",
    titleMessageId: "settings.application.title.startFromOrigin",
    to: "/settings/general",
    targetId: "new-threads",
  },
  {
    id: "add-project-starts-in",
    titleMessageId: "settings.application.title.addProjectStartsIn",
    to: "/settings/general",
  },
  {
    id: "unpin-confirmation",
    titleMessageId: "settings.application.title.unpinConfirmation",
    to: "/settings/general",
  },
  {
    id: "archive-confirmation",
    titleMessageId: "settings.application.title.archiveConfirmation",
    to: "/settings/general",
  },
  {
    id: "delete-confirmation",
    titleMessageId: "settings.application.title.deleteConfirmation",
    to: "/settings/general",
  },
  {
    id: "quit-confirmation",
    titleMessageId: "settings.application.title.quitConfirmation",
    to: "/settings/general",
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    titleMessageId: "settings.application.title.textGenerationModel",
    to: "/settings/general",
  },
  {
    id: "prompt-improvement",
    titleMessageId: "settings.application.title.promptImprovement",
    to: "/settings/general",
  },
  {
    id: "diagnostics",
    titleMessageId: "settings.application.title.diagnostics",
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    titleMessageId: "settings.application.title.legacyPlanMode",
    to: "/settings/general",
  },
  {
    id: "legacy-token-streaming",
    titleMessageId: "settings.application.title.legacyTokenStreaming",
    to: "/settings/general",
  },
  {
    id: "keybindings",
    titleMessageId: "settings.application.title.keybindings",
    to: "/settings/keybindings",
  },
  {
    id: "providers",
    titleMessageId: "settings.application.title.providers",
    to: "/settings/providers",
  },
  {
    id: "skills",
    titleMessageId: "settings.application.title.skills",
    to: "/settings/skills",
  },
  {
    id: "mcp-servers",
    titleMessageId: "settings.application.title.mcpServers",
    to: "/settings/mcp",
  },
  {
    id: "agent-browser-access",
    titleMessageId: "settings.application.title.agentBrowserAccess",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-viewport",
    titleMessageId: "settings.application.title.browserDefaultViewport",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-zoom",
    titleMessageId: "settings.application.title.browserDefaultZoom",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-appearance",
    titleMessageId: "settings.application.title.browserDefaultAppearance",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-auto-show-floating-preview",
    titleMessageId: "settings.application.title.browserFloatingPreview",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "source-control",
    titleMessageId: "settings.application.title.sourceControl",
    to: "/settings/source-control",
  },
  {
    id: "remote-environments",
    titleMessageId: "settings.application.title.remoteEnvironments",
    to: "/settings/connections",
  },
  {
    id: "experimental",
    titleMessageId: "settings.application.title.experimentalFeatures",
    to: "/settings/experimental",
  },
  {
    id: "import-chats",
    titleMessageId: "settings.application.title.importChats",
    to: "/settings/import-chats",
  },
  {
    id: "archive",
    titleMessageId: "settings.application.title.archivedThreads",
    to: "/settings/archived",
  },
] as const satisfies ReadonlyArray<SettingsSearchItemDefinition>;

export function localizeSettingsSearchItems(
  translate: Translate,
): ReadonlyArray<SettingsSearchItem> {
  return SETTINGS_SEARCH_ITEM_DEFINITIONS.map(({ titleMessageId, ...item }) => ({
    ...item,
    title: translate(titleMessageId),
  }));
}

/** English compatibility projection for callers that do not render UI. */
export const SETTINGS_SEARCH_ITEMS = localizeSettingsSearchItems(translateEnglish);

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEM_DEFINITIONS)[number]["id"];

const SEARCH_ITEM_DEFINITIONS_BY_ID = Object.fromEntries(
  SETTINGS_SEARCH_ITEM_DEFINITIONS.map((item) => [item.id, item]),
) as Readonly<Record<SettingsSearchItemId, SettingsSearchItemDefinition>>;

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(
  id: SettingsSearchItemId,
  translate: Translate = translateEnglish,
): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, titleMessageId } = SEARCH_ITEM_DEFINITIONS_BY_ID[id];
  return { id: anchorId, title: translate(titleMessageId) };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];

  return items.filter(
    (item) =>
      (isElectron || item.desktopOnly !== true) &&
      (isMacElectron || item.macosOnly !== true) &&
      normalizeSearchText(item.title).includes(normalizedQuery),
  );
}
