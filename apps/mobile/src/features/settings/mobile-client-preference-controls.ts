import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";

export const MOBILE_CLIENT_PREFERENCE_GROUPS = {
  general: [
    "confirmThreadUnpin",
    "confirmThreadArchive",
    "confirmThreadDelete",
    "timestampFormat",
    "inAppNotificationsEnabled",
  ],
  appearance: ["effortDisplay"],
  chat: ["composerRichTextEnabled", "showSkillsInSlashMenu"],
  diffs: [
    "pullRequestLinksOpenInApp",
    "diffIgnoreWhitespace",
    "diffFilesCollapsed",
    "diffColorScheme",
  ],
} as const;

export type MobileClientPreferenceGroup = keyof typeof MOBILE_CLIENT_PREFERENCE_GROUPS;
type MobileClientControlKey =
  (typeof MOBILE_CLIENT_PREFERENCE_GROUPS)[MobileClientPreferenceGroup][number];

export const MOBILE_CLIENT_CONTROL_LABELS = {
  confirmThreadUnpin: "mobile.prefs.confirmThreadUnpin",
  confirmThreadArchive: "mobile.prefs.confirmThreadArchive",
  confirmThreadDelete: "mobile.prefs.confirmThreadDelete",
  timestampFormat: "mobile.prefs.timestampFormat",
  inAppNotificationsEnabled: "mobile.prefs.inAppNotificationsEnabled",
  effortDisplay: "mobile.prefs.effortDisplay",
  composerRichTextEnabled: "mobile.prefs.composerRichTextEnabled",
  showSkillsInSlashMenu: "mobile.prefs.showSkillsInSlashMenu",
  pullRequestLinksOpenInApp: "mobile.prefs.pullRequestLinksOpenInApp",
  diffIgnoreWhitespace: "mobile.prefs.diffIgnoreWhitespace",
  diffFilesCollapsed: "mobile.prefs.diffFilesCollapsed",
  diffColorScheme: "mobile.prefs.diffColorScheme",
} as const satisfies Record<MobileClientControlKey, InterfaceMessageKey>;

export const MOBILE_CLIENT_CONTROL_OPTIONS = {
  timestampFormat: ["locale", "12h", "24h"],
  effortDisplay: ["label", "bars"],
  diffColorScheme: ["red-green", "blue-orange"],
} as const;

export function mobileClientControlValue<Key extends MobileClientControlKey>(
  preferences: Partial<Record<Key, unknown>> | undefined,
  key: Key,
) {
  return preferences?.[key] ?? MOBILE_CLIENT_PREFERENCE_DEFAULTS[key];
}
