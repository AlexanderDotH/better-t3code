import type { EnvironmentApi, EnvironmentId } from "@t3tools/contracts";

import { ensureEnvironmentApi } from "../../environmentApi";

interface SettingsEnvironmentSelection {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly selectedEnvironmentId: EnvironmentId | null;
}

export function resolveSettingsEnvironmentId(
  selection: SettingsEnvironmentSelection,
): EnvironmentId | null {
  return selection.selectedEnvironmentId ?? selection.primaryEnvironmentId;
}

export function requireSettingsEnvironment(selection: SettingsEnvironmentSelection): {
  readonly environmentId: EnvironmentId;
  readonly api: EnvironmentApi;
} {
  const environmentId = resolveSettingsEnvironmentId(selection);
  if (environmentId === null) {
    throw new Error("No environment is available for this settings operation.");
  }
  return {
    environmentId,
    api: ensureEnvironmentApi(environmentId),
  };
}
