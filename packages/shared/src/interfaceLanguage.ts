import type { InterfaceLanguagePreference } from "@t3tools/contracts";

export type ResolvedInterfaceLanguage = "en" | "de";

export interface ResolvedInterfaceLocale {
  readonly language: ResolvedInterfaceLanguage;
  readonly locale: string;
}

const DEFAULT_LOCALE_BY_LANGUAGE: Readonly<Record<ResolvedInterfaceLanguage, string>> = {
  en: "en-US",
  de: "de-DE",
};

function canonicalizeLocale(value: string): string | null {
  const candidate = value.trim().replaceAll("_", "-");
  if (!candidate) return null;
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

function supportedLanguage(locale: string): ResolvedInterfaceLanguage | null {
  const language = locale.split("-")[0]?.toLowerCase();
  return language === "en" || language === "de" ? language : null;
}

export function resolveInterfaceLocale(
  preference: InterfaceLanguagePreference,
  systemLocales: readonly string[],
): ResolvedInterfaceLocale {
  if (preference !== "system") {
    return {
      language: preference,
      locale: DEFAULT_LOCALE_BY_LANGUAGE[preference],
    };
  }

  for (const systemLocale of systemLocales) {
    const locale = canonicalizeLocale(systemLocale);
    if (!locale) continue;
    const language = supportedLanguage(locale);
    if (language) return { language, locale };
  }

  return { language: "en", locale: DEFAULT_LOCALE_BY_LANGUAGE.en };
}

const englishMessages = {
  "resourceProtection.waiting.label": "Subagent waiting for memory",
  "resourceProtection.waiting.description":
    "The start resumes automatically when memory is available; stopping remains possible at any time.",
  "resourceProtection.throttled.label": "Provider temporarily throttled",
  "resourceProtection.throttled.description":
    "T3 automatically resumes the provider after five healthy memory readings.",
  "resourceProtection.recovering.description":
    "The memory reserve is stabilizing; T3 automatically resumes the provider.",
  "resourceProtection.unavailableWaiting.description":
    "The start resumes as soon as T3 can safely measure available memory again; stopping remains possible.",
  "resourceProtection.unavailableThrottled.description":
    "T3 resumes the provider as soon as available memory can be measured safely again.",
  "settings.interfaceLanguage.title": "Language",
  "settings.interfaceLanguage.description":
    "Choose the interface language. System follows this device; explicit choices synchronize across connected T3 environments.",
  "settings.interfaceLanguage.system": "System",
  "settings.interfaceLanguage.english": "English",
  "settings.interfaceLanguage.german": "German",
  "settings.interfaceLanguage.systemDescription": "Follow this device's preferred language.",
  "settings.interfaceLanguage.englishDescription": "Always use English on every connected client.",
  "settings.interfaceLanguage.germanDescription": "Always use German on every connected client.",
  "settings.interfaceLanguage.syncing": "Syncing with connected servers…",
  "settings.interfaceLanguage.syncFailed":
    "Couldn’t sync to {{environments}}. Retrying automatically.",
  "settings.interfaceLanguage.syncUnsupported":
    "Update {{environments}} to synchronize this setting.",
  "settings.interfaceLanguage.syncDeferred": "Waiting for {{environments}} to reconnect.",
  "desktop.menu.file": "File",
  "desktop.menu.view": "View",
  "desktop.menu.help": "Help",
  "desktop.menu.settings": "Settings...",
  "desktop.menu.checkForUpdates": "Check for Updates...",
  "desktop.menu.actualSize": "Actual Size",
  "desktop.menu.zoomIn": "Zoom In",
  "desktop.menu.zoomOut": "Zoom Out",
  "desktop.update.upToDateTitle": "You're up to date!",
  "desktop.update.upToDateMessage":
    "T3 Code {{version}} is currently the newest version available.",
  "desktop.update.checkFailedTitle": "Update check failed",
  "desktop.update.checkFailedMessage": "Could not check for updates.",
  "desktop.update.unknownError": "An unknown error occurred. Please try again later.",
  "desktop.update.unavailableTitle": "Updates unavailable",
  "desktop.update.unavailableMessage": "Automatic updates are not available right now.",
  "common.ok": "OK",
} as const;

export type InterfaceMessageKey = keyof typeof englishMessages;

const germanMessages = {
  "resourceProtection.waiting.label": "Subagent wartet auf freien Speicher",
  "resourceProtection.waiting.description":
    "Der Start wird automatisch fortgesetzt, sobald Speicher verfügbar ist; Stoppen bleibt jederzeit möglich.",
  "resourceProtection.throttled.label": "Provider vorübergehend gedrosselt",
  "resourceProtection.throttled.description":
    "T3 setzt den Provider nach fünf gesunden Speichermessungen automatisch fort.",
  "resourceProtection.recovering.description":
    "Die Speicherreserve stabilisiert sich; T3 setzt den Provider automatisch fort.",
  "resourceProtection.unavailableWaiting.description":
    "Der Start wird fortgesetzt, sobald T3 den verfügbaren Speicher wieder sicher messen kann; Stoppen bleibt möglich.",
  "resourceProtection.unavailableThrottled.description":
    "T3 setzt den Provider fort, sobald der verfügbare Speicher wieder sicher messbar ist.",
  "settings.interfaceLanguage.title": "Sprache",
  "settings.interfaceLanguage.description":
    "Legt die Sprache der Oberfläche fest. „System“ folgt diesem Gerät; eine feste Auswahl wird über verbundene T3-Umgebungen synchronisiert.",
  "settings.interfaceLanguage.system": "System",
  "settings.interfaceLanguage.english": "Englisch",
  "settings.interfaceLanguage.german": "Deutsch",
  "settings.interfaceLanguage.systemDescription": "Folgt der bevorzugten Sprache dieses Geräts.",
  "settings.interfaceLanguage.englishDescription":
    "Verwendet auf allen verbundenen Clients immer Englisch.",
  "settings.interfaceLanguage.germanDescription":
    "Verwendet auf allen verbundenen Clients immer Deutsch.",
  "settings.interfaceLanguage.syncing": "Synchronisierung mit verbundenen Servern…",
  "settings.interfaceLanguage.syncFailed":
    "Synchronisierung mit {{environments}} fehlgeschlagen. Ein neuer Versuch erfolgt automatisch.",
  "settings.interfaceLanguage.syncUnsupported":
    "{{environments}} aktualisieren, um diese Einstellung zu synchronisieren.",
  "settings.interfaceLanguage.syncDeferred":
    "Warten auf die erneute Verbindung mit {{environments}}.",
  "desktop.menu.file": "Datei",
  "desktop.menu.view": "Ansicht",
  "desktop.menu.help": "Hilfe",
  "desktop.menu.settings": "Einstellungen...",
  "desktop.menu.checkForUpdates": "Nach Updates suchen...",
  "desktop.menu.actualSize": "Tatsächliche Größe",
  "desktop.menu.zoomIn": "Vergrößern",
  "desktop.menu.zoomOut": "Verkleinern",
  "desktop.update.upToDateTitle": "T3 Code ist aktuell",
  "desktop.update.upToDateMessage":
    "T3 Code {{version}} ist derzeit die neueste verfügbare Version.",
  "desktop.update.checkFailedTitle": "Update-Prüfung fehlgeschlagen",
  "desktop.update.checkFailedMessage": "Es konnte nicht nach Updates gesucht werden.",
  "desktop.update.unknownError": "Ein unbekannter Fehler ist aufgetreten. Später erneut versuchen.",
  "desktop.update.unavailableTitle": "Updates nicht verfügbar",
  "desktop.update.unavailableMessage": "Automatische Updates sind derzeit nicht verfügbar.",
  "common.ok": "OK",
} as const satisfies Readonly<Record<InterfaceMessageKey, string>>;

const messages: Readonly<
  Record<ResolvedInterfaceLanguage, Readonly<Record<InterfaceMessageKey, string>>>
> = {
  en: englishMessages,
  de: germanMessages,
};

export function translateInterfaceMessage(
  language: ResolvedInterfaceLanguage,
  key: InterfaceMessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{{${name}}}`, String(value)),
    messages[language][key],
  );
}
