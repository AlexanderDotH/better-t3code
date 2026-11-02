import {
  createInterfaceTranslator,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";

import { useInterfaceLocaleRuntime } from "../interfaceLanguageRuntime";

export function useInterfaceTranslator(): InterfaceTranslator {
  const locale = useInterfaceLocaleRuntime();
  return createInterfaceTranslator(locale);
}
