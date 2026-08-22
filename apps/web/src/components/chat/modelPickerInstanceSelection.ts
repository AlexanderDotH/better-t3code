import type { ProviderInstanceId } from "@t3tools/contracts";

export type ModelPickerInstanceSelection = ProviderInstanceId | "favorites";

export function resolveInitialModelPickerInstance(input: {
  activeInstanceId: ProviderInstanceId;
  preferredInstanceId?: ProviderInstanceId | null | undefined;
  selectableInstanceIds: ReadonlySet<ProviderInstanceId>;
  isLocked: boolean;
  hasFavorites: boolean;
}): ModelPickerInstanceSelection {
  if (input.isLocked) {
    return input.activeInstanceId;
  }
  if (input.preferredInstanceId && input.selectableInstanceIds.has(input.preferredInstanceId)) {
    return input.preferredInstanceId;
  }
  if (input.hasFavorites) {
    return "favorites";
  }
  return input.activeInstanceId;
}
