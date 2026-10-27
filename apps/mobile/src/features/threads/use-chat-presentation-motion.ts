import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import type { EnvironmentId, OrchestrationCheckpointSummary } from "@t3tools/contracts";
import { environmentCatalog } from "../../connection/catalog";
import { useEnvironmentQuery } from "../../state/query";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { createChatMotionAdmission, type ChatMotionItem } from "./chat-presentation-motion";
import type { PendingThreadFeedEntry } from "./pending-thread-feed";
import { changedFileMotionId, COLLAPSED_CHANGED_FILE_COUNT } from "./changed-files-summary";

export function useNativeChatPresentationMotion(input: {
  readonly threadKey: string;
  readonly environmentId: EnvironmentId;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly feed: readonly PendingThreadFeedEntry[];
  readonly presentedFeed: readonly PendingThreadFeedEntry[];
  readonly checkpointsByMessage: ReadonlyMap<string, OrchestrationCheckpointSummary>;
}) {
  const { chatPresentation } = useAppearancePreferences();
  const { data: connection } = useEnvironmentQuery(
    environmentCatalog.stateAtom(input.environmentId),
  );
  const generation = connection?.generation ?? null;
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [registry] = useState(createChatMotionAdmission);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const enabled =
    chatPresentation.presentationMotion && focused && active && input.connected && input.ready;
  const resetKey = `${input.threadKey}:${chatPresentation.mode}:${input.connected}:${input.ready}:${generation}`;
  const disabledMotion = useMemo(
    () => ({
      betterT3: chatPresentation.variant === "better-t3",
      enabled: false,
      resetKey,
      claim: () => null,
      discardPending: registry.discardPending,
    }),
    [chatPresentation.variant, registry.discardPending, resetKey],
  );
  const observation = useMemo(() => {
    const items: ChatMotionItem[] = [];
    if (enabled) {
      const presentedIds = new Set(
        input.presentedFeed.flatMap((entry) =>
          entry.type === "activity-group"
            ? entry.activities.map((activity) => activity.id)
            : [entry.id],
        ),
      );
      for (const entry of input.feed) {
        if (entry.type === "message") {
          items.push({
            id: entry.id,
            createdAt: entry.createdAt,
            kind: entry.message.role === "user" ? "user" : "response",
            revision: entry.id,
            presented: presentedIds.has(entry.id),
          });
          if (
            entry.message.role === "assistant" &&
            (entry.message.text.trim().length > 0 ||
              (entry.message.attachments?.length ?? 0) > 0 ||
              input.checkpointsByMessage.has(entry.id))
          ) {
            items.push({
              id: `surface:${entry.id}`,
              createdAt: entry.createdAt,
              kind: "surface",
              revision: entry.id,
              presented: presentedIds.has(entry.id),
            });
          }
        } else if (entry.type === "activity-group") {
          for (const activity of entry.activities) {
            items.push({
              id: activity.id,
              createdAt: activity.createdAt,
              kind: "result",
              revision: activity.id,
              presented: presentedIds.has(activity.id),
            });
          }
        }
      }
      for (const entry of input.presentedFeed) {
        if (entry.type === "work-toggle") {
          items.push({
            id: entry.id,
            createdAt: entry.createdAt,
            kind: "status",
            revision: `${entry.summary}:${entry.live}`,
          });
        } else if (entry.type === "thinking") {
          items.push({
            id: entry.id,
            createdAt: entry.createdAt,
            kind: "status",
            revision: entry.createdAt,
          });
        } else if (entry.type === "agent-spawn") {
          items.push({
            id: entry.id,
            createdAt: entry.createdAt,
            kind: "status",
            revision: `${entry.summary.status}:${entry.summary.tone}`,
          });
        }
      }
      for (const [messageId, checkpoint] of input.checkpointsByMessage) {
        checkpoint.files.forEach((file, index) =>
          items.push({
            id: changedFileMotionId(checkpoint, file.path),
            createdAt: checkpoint.completedAt,
            kind: "result",
            revision: checkpoint.checkpointRef,
            presented: presentedIds.has(messageId) && index < COLLAPSED_CHANGED_FILE_COUNT,
          }),
        );
      }
    }
    const snapshot = {
      context: resetKey,
      enabled,
      items,
      characterStreamingMotion: chatPresentation.characterStreamingMotion,
    };
    const observe = () => {
      registry.observe({
        ...snapshot,
        snapshot,
        now: Date.now(),
      });
    };
    return {
      observe,
      motion: {
        betterT3: chatPresentation.variant === "better-t3",
        enabled,
        resetKey,
        claim: (id: string, now: number) => {
          // Child layout effects can claim before the feed's layout effect runs.
          observe();
          return registry.claim(id, now);
        },
        discardPending: registry.discardPending,
      },
    };
  }, [
    chatPresentation,
    enabled,
    input.checkpointsByMessage,
    input.feed,
    input.presentedFeed,
    registry,
    resetKey,
  ]);
  useLayoutEffect(() => observation.observe(), [observation]);
  return {
    motion: enabled ? observation.motion : disabledMotion,
    disclose: registry.disclose,
    discardPending: registry.discardPending,
  };
}
