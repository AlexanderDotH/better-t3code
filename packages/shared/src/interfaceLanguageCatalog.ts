import {
  betterT3InterfaceCatalog,
  type BetterT3InterfaceMessageKey,
} from "./interfaceLanguageCatalog.betterT3.ts";
import {
  browserInterfaceCatalog,
  type BrowserInterfaceMessageKey,
} from "./interfaceLanguageCatalog.browser.ts";
import {
  chatInterfaceCatalog,
  type ChatInterfaceMessageKey,
} from "./interfaceLanguageCatalog.chat.ts";
import {
  composerInterfaceCatalog,
  type ComposerInterfaceMessageKey,
} from "./interfaceLanguageCatalog.composer.ts";
import {
  cloudInterfaceCatalog,
  type CloudInterfaceMessageKey,
} from "./interfaceLanguageCatalog.cloud.ts";
import {
  coreInterfaceCatalog,
  type CoreInterfaceMessageKey,
} from "./interfaceLanguageCatalog.core.ts";
import {
  desktopInterfaceCatalog,
  type DesktopInterfaceMessageKey,
} from "./interfaceLanguageCatalog.desktop.ts";
import {
  gitInterfaceCatalog,
  type GitInterfaceMessageKey,
} from "./interfaceLanguageCatalog.git.ts";
import {
  knowledgeGraphInterfaceCatalog,
  type KnowledgeGraphInterfaceMessageKey,
} from "./interfaceLanguageCatalog.knowledgeGraph.ts";
import {
  mobileInterfaceCatalog,
  type MobileInterfaceMessageKey,
} from "./interfaceLanguageCatalog.mobile.ts";
import {
  settingsInterfaceCatalog,
  type SettingsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.ts";
import {
  settingsApplicationInterfaceCatalog,
  type SettingsApplicationInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.application.ts";
import {
  settingsConnectionsInterfaceCatalog,
  type SettingsConnectionsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.connections.ts";
import {
  settingsDiagnosticsInterfaceCatalog,
  type SettingsDiagnosticsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.diagnostics.ts";
import {
  settingsEnvironmentsInterfaceCatalog,
  type SettingsEnvironmentsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.environments.ts";
import {
  settingsMcpInterfaceCatalog,
  type SettingsMcpInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.mcp.ts";
import {
  settingsPanelsInterfaceCatalog,
  type SettingsPanelsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.panels.ts";
import {
  settingsProjectsInterfaceCatalog,
  type SettingsProjectsInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.projects.ts";
import {
  settingsProvidersInterfaceCatalog,
  type SettingsProvidersInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.providers.ts";
import {
  settingsThemeVoiceInterfaceCatalog,
  type SettingsThemeVoiceInterfaceMessageKey,
} from "./interfaceLanguageCatalog.settings.themeVoice.ts";
import {
  sidebarInterfaceCatalog,
  type SidebarInterfaceMessageKey,
} from "./interfaceLanguageCatalog.sidebar.ts";
import {
  type InterfaceCatalogLanguage,
  type InterfaceMessageTemplate,
  type LocalizedInterfaceCatalog,
} from "./interfaceLanguageCatalog.types.ts";
import { uiInterfaceCatalog, type UiInterfaceMessageKey } from "./interfaceLanguageCatalog.ui.ts";
import {
  webInterfaceCatalog,
  type WebInterfaceMessageKey,
} from "./interfaceLanguageCatalog.web.ts";
import {
  webShellInterfaceCatalog,
  type WebShellInterfaceMessageKey,
} from "./interfaceLanguageCatalog.webShell.ts";

export type {
  InterfaceCatalogLanguage,
  InterfaceMessageTemplate,
} from "./interfaceLanguageCatalog.types.ts";

export type InterfaceMessageKey =
  | CoreInterfaceMessageKey
  | BrowserInterfaceMessageKey
  | ChatInterfaceMessageKey
  | ComposerInterfaceMessageKey
  | CloudInterfaceMessageKey
  | WebInterfaceMessageKey
  | WebShellInterfaceMessageKey
  | DesktopInterfaceMessageKey
  | GitInterfaceMessageKey
  | MobileInterfaceMessageKey
  | SettingsInterfaceMessageKey
  | SettingsApplicationInterfaceMessageKey
  | SettingsConnectionsInterfaceMessageKey
  | SettingsDiagnosticsInterfaceMessageKey
  | SettingsEnvironmentsInterfaceMessageKey
  | SettingsMcpInterfaceMessageKey
  | SettingsPanelsInterfaceMessageKey
  | SettingsProjectsInterfaceMessageKey
  | SettingsProvidersInterfaceMessageKey
  | SettingsThemeVoiceInterfaceMessageKey
  | SidebarInterfaceMessageKey
  | UiInterfaceMessageKey
  | BetterT3InterfaceMessageKey
  | KnowledgeGraphInterfaceMessageKey;

const catalogs = [
  coreInterfaceCatalog,
  browserInterfaceCatalog,
  chatInterfaceCatalog,
  composerInterfaceCatalog,
  cloudInterfaceCatalog,
  webInterfaceCatalog,
  webShellInterfaceCatalog,
  desktopInterfaceCatalog,
  gitInterfaceCatalog,
  mobileInterfaceCatalog,
  settingsInterfaceCatalog,
  settingsApplicationInterfaceCatalog,
  settingsConnectionsInterfaceCatalog,
  settingsDiagnosticsInterfaceCatalog,
  settingsEnvironmentsInterfaceCatalog,
  settingsMcpInterfaceCatalog,
  settingsPanelsInterfaceCatalog,
  settingsProjectsInterfaceCatalog,
  settingsProvidersInterfaceCatalog,
  settingsThemeVoiceInterfaceCatalog,
  sidebarInterfaceCatalog,
  uiInterfaceCatalog,
  betterT3InterfaceCatalog,
  knowledgeGraphInterfaceCatalog,
] as const satisfies readonly LocalizedInterfaceCatalog<string>[];

export const INTERFACE_MESSAGE_KEYS = Object.freeze(
  catalogs.flatMap(({ keys }) => keys) as InterfaceMessageKey[],
);

const uniqueKeys: ReadonlySet<string> = new Set(INTERFACE_MESSAGE_KEYS);
if (uniqueKeys.size !== INTERFACE_MESSAGE_KEYS.length) {
  throw new Error("Interface message keys must have exactly one owning catalog.");
}

export function isInterfaceMessageKey(value: string): value is InterfaceMessageKey {
  return uniqueKeys.has(value);
}

const messages = Object.fromEntries(
  (["en", "de", "fr"] as const).map((language) => [
    language,
    Object.assign({}, ...catalogs.map((catalog) => catalog.messages[language])),
  ]),
) as Readonly<
  Record<InterfaceCatalogLanguage, Readonly<Record<InterfaceMessageKey, InterfaceMessageTemplate>>>
>;

export function getInterfaceMessageTemplate(
  language: InterfaceCatalogLanguage,
  key: InterfaceMessageKey,
): InterfaceMessageTemplate {
  return messages[language][key];
}
