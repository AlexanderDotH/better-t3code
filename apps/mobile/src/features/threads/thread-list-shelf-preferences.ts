import type { Preferences } from "../../persistence/mobile-preferences";

type ThreadListShelfPreferences = Pick<
  Preferences,
  | "threadListSnoozedShelfExpanded"
  | "threadListSettledShelfExpanded"
  | "threadListV2SnoozedShelfExpanded"
  | "threadListV2SettledShelfExpanded"
>;

export function resolveThreadListShelfPreferences(
  preferences: ThreadListShelfPreferences | undefined,
) {
  return {
    snoozedShelfExpanded:
      preferences?.threadListSnoozedShelfExpanded ??
      preferences?.threadListV2SnoozedShelfExpanded ??
      false,
    settledShelfExpanded:
      preferences?.threadListSettledShelfExpanded ??
      preferences?.threadListV2SettledShelfExpanded ??
      true,
  };
}

export function toggleSnoozedShelfPreference(current: ThreadListShelfPreferences) {
  return {
    threadListSnoozedShelfExpanded:
      !resolveThreadListShelfPreferences(current).snoozedShelfExpanded,
  };
}

export function toggleSettledShelfPreference(current: ThreadListShelfPreferences) {
  return {
    threadListSettledShelfExpanded:
      !resolveThreadListShelfPreferences(current).settledShelfExpanded,
  };
}
