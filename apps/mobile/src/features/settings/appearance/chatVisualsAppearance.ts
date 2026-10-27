import { CHAT_VISUAL_MODES } from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

export interface ChatVisualModeSyncStatus {
  readonly isSyncing: boolean;
  readonly isLocalOnly?: boolean;
  readonly failedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
  readonly unsupportedEnvironmentLabels: readonly string[];
}

export function chatVisualModeOptions(translate: InterfaceTranslator["message"]) {
  return CHAT_VISUAL_MODES.map((mode) => ({
    mode,
    label: translate(`settings.chatVisuals.${mode}`),
    description: translate(`settings.chatVisuals.${mode}.description`),
  }));
}

export function chatVisualModeSyncMessages(
  status: ChatVisualModeSyncStatus,
  translate: InterfaceTranslator["message"],
): readonly string[] {
  const messages: string[] = [];
  if (status.isLocalOnly) messages.push(translate("settings.chatVisuals.sync.local"));
  if (status.isSyncing) messages.push(translate("settings.chatVisuals.sync.pending"));
  if (status.failedEnvironmentLabels.length > 0) {
    messages.push(
      translate("settings.chatVisuals.sync.failed", {
        environments: status.failedEnvironmentLabels.join(", "),
      }),
    );
  }
  if (status.deferredEnvironmentLabels.length > 0) {
    messages.push(
      translate("settings.chatVisuals.sync.deferred", {
        environments: status.deferredEnvironmentLabels.join(", "),
      }),
    );
  }
  if (status.unsupportedEnvironmentLabels.length > 0) {
    messages.push(
      translate("settings.chatVisuals.sync.unsupported", {
        environments: status.unsupportedEnvironmentLabels.join(", "),
      }),
    );
  }
  return messages;
}
