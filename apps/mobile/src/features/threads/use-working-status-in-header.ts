import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom } from "../../state/preferences";
import { useSelectedThreadTokenUsage } from "../../state/use-thread-detail";
import { formatTokenTotal } from "@t3tools/client-runtime/thread-token-usage";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function useWorkingHeaderTokenLabel(enabled: boolean): string | null {
  const usage = useSelectedThreadTokenUsage();
  const translator = useMobileInterfaceTranslator();
  if (!enabled || usage === null) return null;
  return `${formatTokenTotal(usage.inputTokens, usage.inputIsPartial)} ${translator.message("chat.tokens.inShort")} · ${formatTokenTotal(usage.outputTokens, usage.outputIsPartial)} ${translator.message("chat.tokens.outShort")}`;
}

export function useWorkingStatusInHeader(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return (
    AsyncResult.isSuccess(preferences) &&
    resolveBetterT3FeatureFlag(
      preferences.value.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      "chat.workingStatusInHeader",
    )
  );
}
