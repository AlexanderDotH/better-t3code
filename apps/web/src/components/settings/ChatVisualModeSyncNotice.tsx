import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

import { useChatVisualModeSyncStatus } from "../../chatVisualModeSync";

export function ChatVisualModeSyncNotice({
  translate,
}: {
  readonly translate: InterfaceTranslator["message"];
}) {
  const status = useChatVisualModeSyncStatus();
  const messages = [
    ...(status.isLocalOnly ? [translate("settings.chatVisuals.sync.local")] : []),
    ...(status.isSyncing ? [translate("settings.chatVisuals.sync.pending")] : []),
    ...(status.deferredEnvironmentLabels.length > 0
      ? [
          translate("settings.chatVisuals.sync.deferred", {
            environments: status.deferredEnvironmentLabels.join(", "),
          }),
        ]
      : []),
    ...(status.unsupportedEnvironmentLabels.length > 0
      ? [
          translate("settings.chatVisuals.sync.unsupported", {
            environments: status.unsupportedEnvironmentLabels.join(", "),
          }),
        ]
      : []),
  ];
  if (messages.length === 0) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground" role="status">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
