import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";

export function errorsAndWarningsSuppressed() {
  const preferences = AsyncResult.getOrElse(appAtomRegistry.get(mobilePreferencesAtom), () => null);
  return resolveBetterT3FeatureFlag(
    preferences?.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    "integration.suppressErrorsAndWarnings",
  );
}

export function useErrorsAndWarningsSuppressed() {
  const preferences = AsyncResult.getOrElse(useAtomValue(mobilePreferencesAtom), () => null);
  return resolveBetterT3FeatureFlag(
    preferences?.betterT3Device ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    "integration.suppressErrorsAndWarnings",
  );
}
