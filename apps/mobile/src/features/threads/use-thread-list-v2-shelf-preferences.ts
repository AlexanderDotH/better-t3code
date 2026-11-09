import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  resolveThreadListShelfPreferences,
  toggleSettledShelfPreference,
  toggleSnoozedShelfPreference,
} from "./thread-list-shelf-preferences";

export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const { snoozedShelfExpanded, settledShelfExpanded } = resolveThreadListShelfPreferences(
    loaded ? preferencesResult.value : undefined,
  );
  const workingShelfEnabled = loaded && preferencesResult.value.workingShelfEnabled !== false;
  const workingShelfExpanded =
    loaded && preferencesResult.value.threadListWorkingShelfExpanded === true;
  const olderProjectsExpanded = loaded && preferencesResult.value.olderProjectsExpanded === true;

  // Transforms read optimistic state so same-frame presses toggle twice.
  const toggleSnoozedShelf = () => {
    if (!loaded) return;
    savePreferences({ transform: toggleSnoozedShelfPreference });
  };
  const toggleSettledShelf = () => {
    if (!loaded) return;
    savePreferences({ transform: toggleSettledShelfPreference });
  };
  const toggleWorkingShelf = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({
        threadListWorkingShelfExpanded: current.threadListWorkingShelfExpanded !== true,
      }),
    });
  };

  const toggleOlderProjects = () => {
    if (!loaded) return;
    savePreferences({
      transform: (current) => ({ olderProjectsExpanded: current.olderProjectsExpanded !== true }),
    });
  };

  return {
    loaded,
    olderProjectsExpanded,
    settledShelfExpanded,
    snoozedShelfExpanded,
    workingShelfEnabled,
    workingShelfExpanded,
    toggleOlderProjects,
    toggleSettledShelf,
    toggleSnoozedShelf,
    toggleWorkingShelf,
  } as const;
}
