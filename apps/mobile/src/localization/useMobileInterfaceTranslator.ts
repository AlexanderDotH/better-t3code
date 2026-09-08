import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useMemo } from "react";

import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

export function useMobileInterfaceTranslator() {
  const { interfaceLanguage } = useAppearancePreferences();
  return useMemo(
    () =>
      createInterfaceTranslator({
        language: interfaceLanguage.language,
        locale: interfaceLanguage.locale,
      }),
    [interfaceLanguage.language, interfaceLanguage.locale],
  );
}
