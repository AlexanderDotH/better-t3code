import type { ResolvedInterfaceLocale } from "@t3tools/shared/interfaceLanguage";
import { useSyncExternalStore } from "react";

const DEFAULT_INTERFACE_LOCALE: ResolvedInterfaceLocale = Object.freeze({
  language: "en",
  locale: "en-US",
});

let currentLocale = DEFAULT_INTERFACE_LOCALE;
const listeners = new Set<() => void>();

export function readInterfaceLocaleRuntime(): ResolvedInterfaceLocale {
  return currentLocale;
}

export function setInterfaceLocaleRuntime(locale: ResolvedInterfaceLocale): void {
  if (currentLocale.language === locale.language && currentLocale.locale === locale.locale) return;
  currentLocale = Object.freeze({ ...locale });
  for (const listener of listeners) listener();
}

export function subscribeInterfaceLocaleRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInterfaceLocaleRuntime(): ResolvedInterfaceLocale {
  return useSyncExternalStore(
    subscribeInterfaceLocaleRuntime,
    readInterfaceLocaleRuntime,
    () => DEFAULT_INTERFACE_LOCALE,
  );
}
