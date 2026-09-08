import type { Preferences } from "../../persistence/mobile-preferences";

export function resolveThreadListShelfPreferences(
  preferences:
    | Pick<
        Preferences,
        | "threadListSnoozedShelfExpanded"
        | "threadListSettledShelfExpanded"
        | "threadListV2SnoozedShelfExpanded"
        | "threadListV2SettledShelfExpanded"
      >
    | undefined,
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
