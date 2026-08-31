import {
  createInterfaceTranslator,
  type InterfaceTranslator,
} from "@t3tools/shared/interfaceLanguage";
import { useMemo } from "react";

import { useInterfaceLocaleRuntime } from "../interfaceLanguageRuntime";

export function useInterfaceTranslator(): InterfaceTranslator {
  const locale = useInterfaceLocaleRuntime();
  return useMemo(() => createInterfaceTranslator(locale), [locale]);
}
