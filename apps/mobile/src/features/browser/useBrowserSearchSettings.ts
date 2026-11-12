import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";

export function useBrowserSearchSettings() {
  const result = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.isSuccess(result) ? result.value : null;
  const update = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  return {
    browserSearchEngine:
      preferences?.browserSearchEngine ?? MOBILE_CLIENT_PREFERENCE_DEFAULTS.browserSearchEngine,
    browserCustomSearchUrl:
      preferences?.browserCustomSearchUrl ??
      MOBILE_CLIENT_PREFERENCE_DEFAULTS.browserCustomSearchUrl,
    update,
  };
}
