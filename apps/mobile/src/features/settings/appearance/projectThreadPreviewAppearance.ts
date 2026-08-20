import {
  MAX_PROJECT_THREAD_PREVIEW_COUNT,
  MIN_PROJECT_THREAD_PREVIEW_COUNT,
  type ProjectThreadPreviewCount,
} from "@t3tools/contracts";

export interface ProjectThreadPreviewSyncStatus {
  readonly isSyncing: boolean;
  readonly failedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
  readonly unsupportedEnvironmentLabels: readonly string[];
}

export function stepProjectThreadPreviewCount(
  current: ProjectThreadPreviewCount,
  direction: -1 | 1,
): ProjectThreadPreviewCount {
  return Math.min(
    MAX_PROJECT_THREAD_PREVIEW_COUNT,
    Math.max(MIN_PROJECT_THREAD_PREVIEW_COUNT, current + direction),
  );
}

function environmentList(labels: readonly string[]): string {
  return labels.join(", ");
}

export function projectThreadPreviewSyncMessages(
  status: ProjectThreadPreviewSyncStatus,
): readonly string[] {
  const messages: string[] = [];
  if (status.isSyncing) {
    messages.push("Syncing with connected environments…");
  }
  if (status.failedEnvironmentLabels.length > 0) {
    const subject = environmentList(status.failedEnvironmentLabels);
    const reconnect =
      status.failedEnvironmentLabels.length === 1 ? "it reconnects" : "they reconnect";
    messages.push(`Could not sync with ${subject}. T3 Code will retry after ${reconnect}.`);
  }
  if (status.deferredEnvironmentLabels.length > 0) {
    messages.push(`Waiting for ${environmentList(status.deferredEnvironmentLabels)} to reconnect.`);
  }
  if (status.unsupportedEnvironmentLabels.length > 0) {
    messages.push(
      `Update ${environmentList(status.unsupportedEnvironmentLabels)} to sync this setting.`,
    );
  }
  return messages;
}
