import type { ChatVisualMode } from "@t3tools/contracts";

export interface ChatVisualModeSyncStatus {
  readonly isSyncing: boolean;
  readonly failedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
  readonly unsupportedEnvironmentLabels: readonly string[];
}

export const CHAT_VISUAL_MODE_OPTIONS: ReadonlyArray<{
  readonly mode: ChatVisualMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "current",
    label: "Current",
    description: "Shows the activity-focused transcript with larger work summaries.",
  },
  {
    mode: "classic",
    label: "Classic",
    description: "Restores the compact legacy transcript layout.",
  },
];

function environmentList(labels: readonly string[]): string {
  return labels.join(", ");
}

export function chatVisualModeSyncMessages(status: ChatVisualModeSyncStatus): readonly string[] {
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
