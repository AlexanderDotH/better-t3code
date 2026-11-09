import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_USAGE_URL,
  CHATGPT_WORKSPACE_ADMIN_REQUEST,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@t3tools/shared/usageLimits";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Linking, View } from "react-native";
import { ProviderIcon } from "../../components/ProviderIcon";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ChatGptUsageLimitNotice({ thread }: { thread: EnvironmentThreadShell }) {
  const translator = useMobileInterfaceTranslator();
  const [status, setStatus] = useState<"copied" | "copy-failed" | "open-failed" | null>(null);
  const code = thread.runtime?.lastErrorCode;
  const workspaceLimit = code === CHATGPT_WORKSPACE_USAGE_LIMIT_CODE;
  if (thread.runtime?.status !== "failed" || (!workspaceLimit && code !== CHATGPT_USAGE_LIMIT_CODE))
    return null;
  return (
    <View
      accessibilityRole="alert"
      className="mx-3 mb-2 gap-2 rounded-xl border border-border-subtle bg-screen p-3"
    >
      <View className="flex-row items-center gap-2">
        <ProviderIcon provider="codex" size={16} />
        <Text className="text-sm font-t3-medium text-foreground">
          {translator.message("mobile.ui.chatgptUsageLimitReached")}
        </Text>
      </View>
      <Text className="text-xs text-foreground-muted">
        {workspaceLimit
          ? status === "copied"
            ? translator.message("mobile.ui.requestCopiedSendItToYourWorkspace")
            : translator.message("mobile.ui.youveReachedYourWorkspacesLimitForUsing")
          : translator.message("mobile.ui.reviewYourUsageSettingsInChatgpt")}
      </Text>
      {workspaceLimit ? (
        <Button
          label={translator.message("mobile.ui.copyRequestForAdmin")}
          tone="primary"
          onPress={() =>
            void Clipboard.setStringAsync(CHATGPT_WORKSPACE_ADMIN_REQUEST).then(
              () => setStatus("copied"),
              () => setStatus("copy-failed"),
            )
          }
        />
      ) : (
        <Button
          label={translator.message("mobile.ui.manageUsage")}
          tone="primary"
          onPress={() =>
            void Linking.openURL(CHATGPT_USAGE_URL).then(
              () => setStatus(null),
              () => setStatus("open-failed"),
            )
          }
        />
      )}
      {status === "copy-failed" || status === "open-failed" ? (
        <Text accessibilityRole="alert" className="text-xs text-danger-foreground">
          {status === "copy-failed"
            ? translator.message("mobile.ui.couldNotCopyTheRequestTryAgain")
            : translator.message("mobile.ui.couldNotOpenChatgptGoToChatgpt")}
        </Text>
      ) : null}
    </View>
  );
}
