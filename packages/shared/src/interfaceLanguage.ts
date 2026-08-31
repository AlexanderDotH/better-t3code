import type { InterfaceLocalePreferenceV1 } from "@t3tools/contracts";

import {
  getInterfaceMessageTemplate,
  type InterfaceMessageKey,
} from "./interfaceLanguageCatalog.ts";

export { INTERFACE_MESSAGE_KEYS, isInterfaceMessageKey } from "./interfaceLanguageCatalog.ts";
export type { InterfaceMessageKey } from "./interfaceLanguageCatalog.ts";
export type { SettingsDiagnosticsInterfaceMessageKey } from "./interfaceLanguageCatalog.settings.diagnostics.ts";

export type ResolvedInterfaceLanguage = "en" | "de" | "fr";

export interface ResolvedInterfaceLocale {
  readonly language: ResolvedInterfaceLanguage;
  readonly locale: string;
}

const DEFAULT_LOCALE_BY_LANGUAGE: Readonly<Record<ResolvedInterfaceLanguage, string>> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
};

const SUPPORTED_GERMAN_LOCALES = new Set(["de-DE", "de-AT", "de-CH"]);

function canonicalizeLocale(value: string): string | null {
  const candidate = value.trim().replaceAll("_", "-");
  if (!candidate) return null;
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

function resolveSupportedLocale(locale: string): ResolvedInterfaceLocale | null {
  const language = locale.split("-")[0]?.toLowerCase();
  if (language === "en") return { language, locale };
  if (language === "de") {
    return {
      language,
      locale: SUPPORTED_GERMAN_LOCALES.has(locale) ? locale : DEFAULT_LOCALE_BY_LANGUAGE.de,
    };
  }
  if (language === "fr") {
    return { language, locale: DEFAULT_LOCALE_BY_LANGUAGE.fr };
  }
  return null;
}

export function resolveInterfaceLocale(
  preference: InterfaceLocalePreferenceV1,
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
    const supported = resolveSupportedLocale(locale);
    if (supported) return supported;
  }

  return { language: "en", locale: DEFAULT_LOCALE_BY_LANGUAGE.en };
}

type InterfaceMessageValues = Readonly<Record<string, string | number>>;

function selectMessageTemplate(
  language: ResolvedInterfaceLanguage,
  locale: string,
  key: InterfaceMessageKey,
  values: InterfaceMessageValues,
): string {
  const template = getInterfaceMessageTemplate(language, key);
  if (typeof template === "string") return template;
  const count = values.count;
  if (typeof count !== "number") return template.other;
  return new Intl.PluralRules(locale).select(count) === "one" ? template.one : template.other;
}

function interpolateMessage(template: string, values: InterfaceMessageValues): string {
  return template.replace(/{{([A-Za-z0-9_]+)}}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

export interface InterfaceTranslator {
  readonly message: (key: InterfaceMessageKey, values?: InterfaceMessageValues) => string;
  readonly number: (value: number, options?: Intl.NumberFormatOptions) => string;
  readonly list: (values: readonly string[], options?: Intl.ListFormatOptions) => string;
  readonly date: (
    value: number | Date,
    options?: Omit<Intl.DateTimeFormatOptions, "dateStyle">,
  ) => string;
}

export function createInterfaceTranslator(resolved: ResolvedInterfaceLocale): InterfaceTranslator {
  return {
    message: (key, values = {}) =>
      interpolateMessage(
        selectMessageTemplate(resolved.language, resolved.locale, key, values),
        values,
      ),
    number: (value, options) => new Intl.NumberFormat(resolved.locale, options).format(value),
    list: (values, options = { style: "long", type: "conjunction" }) =>
      new Intl.ListFormat(resolved.locale, options).format(values),
    date: (value, options) =>
      new Intl.DateTimeFormat(resolved.locale, { dateStyle: "medium", ...options }).format(value),
  };
}

export function translateInterfaceMessage(
  language: ResolvedInterfaceLanguage,
  key: InterfaceMessageKey,
  values: InterfaceMessageValues = {},
): string {
  return createInterfaceTranslator({
    language,
    locale: DEFAULT_LOCALE_BY_LANGUAGE[language],
  }).message(key, values);
}

const PSEUDO_CHARACTER_MAP: Readonly<Record<string, string>> = {
  a: "à",
  c: "ç",
  e: "ë",
  i: "ï",
  o: "ö",
  u: "ü",
  A: "À",
  C: "Ç",
  E: "Ë",
  I: "Ï",
  O: "Ö",
  U: "Ü",
};

function pseudoLocalizeLiteral(value: string): string {
  return value.replace(
    /[ACEIOUaceiou]/g,
    (character) => PSEUDO_CHARACTER_MAP[character] ?? character,
  );
}

export function pseudoLocalizeInterfaceMessage(
  key: InterfaceMessageKey,
  values: InterfaceMessageValues = {},
): string {
  const template = selectMessageTemplate("en", "en-US", key, values);
  const pseudoTemplate = template.replace(/(^|}})([^{}]*)(?={{|$)/g, (segment) =>
    pseudoLocalizeLiteral(segment),
  );
  return `⟦${interpolateMessage(pseudoTemplate, values)}⟧`;
}
