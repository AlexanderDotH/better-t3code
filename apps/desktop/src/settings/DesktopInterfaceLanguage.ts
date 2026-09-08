import {
  translateInterfaceMessage,
  type InterfaceMessageKey,
  type ResolvedInterfaceLanguage,
} from "@t3tools/shared/interfaceLanguage";

let currentLanguage: ResolvedInterfaceLanguage = "en";

export function readDesktopInterfaceLanguage(): ResolvedInterfaceLanguage {
  return currentLanguage;
}

export function setDesktopInterfaceLanguage(language: ResolvedInterfaceLanguage): void {
  currentLanguage = language;
}

export function translateDesktopInterfaceMessage(
  key: InterfaceMessageKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  return translateInterfaceMessage(currentLanguage, key, values);
}
