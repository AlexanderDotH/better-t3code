import {
  createInterfaceTranslator,
  type InterfaceTranslator,
  type ResolvedInterfaceLocale,
} from "@t3tools/shared/interfaceLanguage";

let translator = createInterfaceTranslator({ language: "en", locale: "en-US" });

/** For route options and helpers outside React. Components use useMobileInterfaceTranslator. */
export function currentInterfaceTranslator(): InterfaceTranslator {
  return translator;
}

export function setCurrentInterfaceLocale(locale: ResolvedInterfaceLocale): void {
  translator = createInterfaceTranslator(locale);
}
