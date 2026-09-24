import {
  EMPTY_PROJECT_INDEX_CLIENT_STATE,
  applyProjectIndexStreamEvent,
  deriveProjectIndexChatStatus,
} from "@t3tools/client-runtime/project-indexing";
import type { EnvironmentId, ProjectId, ServerConfig, ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { projectIndexEnvironment } from "../../state/project-index";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";
import { mobileProjectIndexPermissions } from "./mobile-project-indexing";
import {
  mobileProjectIndexDefaults,
  mobileProjectIndexStatusWithDefaults,
} from "./mobile-project-index-settings";

const statusDotClasses = {
  active: "bg-primary",
  ready: "bg-switch-active-track",
  attention: "bg-warning-foreground",
  idle: "bg-foreground-muted",
} as const;

export function ProjectIndexChatStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectLabel: string;
  readonly threadId: ThreadId;
  readonly config: ServerConfig;
  readonly onOpenIndex: () => void;
  readonly onOpenSettings: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const session = useEnvironmentQuery(environmentSession.sessionStateAtom(props.environmentId));
  const canRead = mobileProjectIndexPermissions(session.data).canRead;
  const target = useMemo(
    () =>
      canRead
        ? {
            environmentId: props.environmentId,
            input: { projectId: props.projectId, threadId: props.threadId },
          }
        : null,
    [canRead, props.environmentId, props.projectId, props.threadId],
  );
  const statusQuery = useEnvironmentQuery(target ? projectIndexEnvironment.status(target) : null);
  const updates = useEnvironmentQuery(target ? projectIndexEnvironment.events(target) : null);
  const status =
    statusQuery.data === null
      ? (updates.data?.status ?? null)
      : applyProjectIndexStreamEvent(updates.data ?? EMPTY_PROJECT_INDEX_CLIENT_STATE, {
          type: "status",
          status: statusQuery.data,
        }).status;
  const chatStatus = deriveProjectIndexChatStatus(
    status === null
      ? null
      : mobileProjectIndexStatusWithDefaults(status, mobileProjectIndexDefaults(props.config)),
  );
  if (chatStatus === null) return null;

  const stateLabel = translator.message(`projectIndexing.state.${chatStatus.stage}`);
  const fileProgress =
    chatStatus.eligibleFiles > 0
      ? translator.message("projectIndexing.chatFileProgress", {
          indexed: translator.number(chatStatus.indexedFiles),
          eligible: translator.number(chatStatus.eligibleFiles),
        })
      : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.projectLabel} · ${translator.message("projectIndexing.title")}: ${stateLabel}${fileProgress ? ` · ${fileProgress}` : ""}`}
      accessibilityHint={translator.message(
        chatStatus.openSettings ? "projectIndexing.openSettings" : "projectIndexing.graph",
      )}
      className="mx-3 mt-2 min-h-11 flex-row items-center rounded-xl border border-border-subtle bg-subtle px-3 py-2 active:opacity-75"
      onPress={chatStatus.openSettings ? props.onOpenSettings : props.onOpenIndex}
    >
      <View className={`me-2 size-2 rounded-full ${statusDotClasses[chatStatus.tone]}`} />
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-t3-semibold text-foreground">{props.projectLabel}</Text>
        <Text numberOfLines={1} className="text-xs text-foreground-muted">
          {stateLabel}
          {fileProgress ? ` · ${fileProgress}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}
