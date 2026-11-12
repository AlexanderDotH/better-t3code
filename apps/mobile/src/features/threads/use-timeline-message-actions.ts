import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  resolveBetterT3FeatureFlag,
  type EnvironmentId,
  type OrchestrationV2ThreadProjection,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { extractVoiceFileContext, appendVoiceFileContext } from "@t3tools/shared/voiceFileContext";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useMemo, useRef, useState } from "react";
import * as Dialog from "../../components/ui/Dialog";
import type { ThreadFeedMessage } from "../../lib/threadActivity";
import { createTimelineRewindResolver } from "../../lib/timelineRewind";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  appendComposerDraftAttachments,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  scheduleUnusedComposerAttachmentCleanup,
} from "../../state/use-composer-drafts";
import type { DraftComposerAttachment } from "../../lib/composerImages";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";
import { prepareTimelineRewindAttachments } from "./timeline-rewind-attachments";

export function useTimelineMessageActions(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly busy: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const runtime = useRemoteEnvironmentRuntime(input.environmentId);
  const canOperate = useEnvironmentScope(input.environmentId, AuthOrchestrationOperateScope);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const settings = AsyncResult.isSuccess(preferences)
    ? preferences.value.betterT3Device
    : undefined;
  const editingEnabled = resolveBetterT3FeatureFlag(
    settings ?? DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    "chat.messageEditing",
  );
  const edit = useAtomCommand(threadEnvironment.editMessage, { reportFailure: false });
  const revert = useAtomCommand(threadEnvironment.revertCheckpoint, { reportFailure: false });
  const [editing, setEditing] = useState<ThreadFeedMessage | null>(null);
  const [rewinding, setRewinding] = useState(false);
  const pending = useRef(false);
  const available =
    canOperate && runtime?.connectionState === "connected" && !input.busy && !rewinding;
  const projection = input.projection?.thread.id === input.threadId ? input.projection : null;
  const providerInstanceId =
    projection?.providerThreads.find(
      (thread) => thread.id === projection.thread.activeProviderThreadId,
    )?.providerInstanceId ?? projection?.thread.modelSelection.instanceId;
  const rollbackSupported =
    runtime?.serverConfig?.providers.find((provider) => provider.instanceId === providerInstanceId)
      ?.supportsConversationRollback !== false;
  const runs = projection?.runs;
  const checkpoints = projection?.checkpoints;
  const resolveTarget = useMemo(
    () =>
      createTimelineRewindResolver(input.threadId, {
        runs: runs ?? [],
        checkpoints: checkpoints ?? [],
      }),
    [runs, checkpoints, input.threadId],
  );
  const rewindTarget = (message: ThreadFeedMessage) =>
    rollbackSupported ? resolveTarget(message) : null;
  const rewind = async (message: ThreadFeedMessage, restoreFiles: boolean) => {
    if (pending.current || !available) return;
    const target = rewindTarget(message);
    if (!target) return;
    pending.current = true;
    setRewinding(true);
    const key = scopedThreadKey(input.environmentId, input.threadId);
    let restoredAttachments: ReadonlyArray<DraftComposerAttachment> = [];
    await (async () => {
      const draft = getComposerDraftSnapshot(key);
      if (
        draft.attachments.length + message.attachments.length >
        PROVIDER_SEND_TURN_MAX_ATTACHMENTS
      )
        throw new Error(translator.message("mobile.timeline.attachmentCapacity"));
      restoredAttachments = await prepareTimelineRewindAttachments(
        input.environmentId,
        message.attachments,
      );
      if (
        getComposerDraftSnapshot(key).attachments.length + restoredAttachments.length >
        PROVIDER_SEND_TURN_MAX_ATTACHMENTS
      )
        throw new Error(translator.message("mobile.timeline.attachmentCapacity"));
      const requestId = CommandId.make(uuidv4());
      const stateAtom = environmentThreadDetails.stateAtom(
        scopeThreadRef(input.environmentId, input.threadId),
      );
      const before = Option.getOrNull(appAtomRegistry.get(stateAtom).data);
      const providerThreadId = before?.thread.activeProviderThreadId;
      const providerThread = before?.providerThreads.find(
        (thread) => thread.id === providerThreadId,
      );
      const previousProviderThreadIds = new Set(before?.providerThreads.map((thread) => thread.id));
      const witness = before?.runs.reduce<(typeof before.runs)[number] | undefined>(
        (latest, run) => {
          if (
            run.ordinal <= target.turnCount ||
            !["completed", "interrupted", "failed", "cancelled"].includes(run.status)
          )
            return latest;
          return latest === undefined || run.ordinal > latest.ordinal ? run : latest;
        },
        undefined,
      );
      if (!witness) throw new Error(translator.message("mobile.timeline.editUnavailable"));
      await new Promise<void>((resolve, reject) => {
        let accepted = false;
        let settled = false;
        let unsubscribe = () => {};
        const timer = setTimeout(
          () => finish(new Error(translator.message("mobile.timeline.rewindTimeout"))),
          120_000,
        );
        const finish = (cause?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          if (cause === undefined) resolve();
          else reject(cause);
        };
        const inspect = () => {
          const next = Option.getOrNull(appAtomRegistry.get(stateAtom).data);
          if (next?.thread.rollbackFailure?.requestId === requestId) {
            finish(new Error(next.thread.rollbackFailure.message));
          } else if (
            accepted &&
            next?.runs.some((run) => run.id === witness.id && run.status === "rolled_back") &&
            next.providerThreads.some(
              (thread) =>
                (thread.id === providerThreadId ||
                  (target.turnCount === 0 &&
                    thread.ownerNodeId === null &&
                    thread.appThreadId === input.threadId &&
                    thread.providerInstanceId === providerThread?.providerInstanceId &&
                    !previousProviderThreadIds.has(thread.id))) &&
                thread.lastRunOrdinal === (target.turnCount === 0 ? null : target.turnCount),
            )
          )
            finish();
        };
        unsubscribe = appAtomRegistry.subscribe(stateAtom, inspect);
        void revert({
          environmentId: input.environmentId,
          input: { threadId: input.threadId, commandId: requestId, ...target, restoreFiles },
        }).then((result) => {
          if (result._tag === "Failure") finish(squashAtomCommandFailure(result));
          else {
            accepted = true;
            inspect();
          }
        }, finish);
      });
      await mergeComposerDraftContent(key, {
        text: message.text,
        attachments: restoredAttachments,
        context: message.context,
      });
      const attached = new Set(
        getComposerDraftSnapshot(key).attachments.map((attachment) => attachment.id),
      );
      const overflow = restoredAttachments.filter((attachment) => !attached.has(attachment.id));
      if (overflow.length) appendComposerDraftAttachments(key, overflow, { allowOverflow: true });
    })()
      .catch((cause) => {
        Dialog.alert(
          translator.message("mobile.timeline.rewindFailed"),
          cause instanceof Error ? cause.message : String(cause),
        );
      })
      .finally(() => {
        scheduleUnusedComposerAttachmentCleanup(restoredAttachments);
        pending.current = false;
        setRewinding(false);
      });
  };
  return {
    available,
    editing,
    canEdit: (message: ThreadFeedMessage) =>
      editingEnabled &&
      canOperate &&
      message.visibility !== "inherited" &&
      message.sourceThreadId === input.threadId,
    onEdit: setEditing,
    onCloseEditor: () => setEditing(null),
    onSave: async (text: string) => {
      if (!editing || !available)
        throw new Error(translator.message("mobile.timeline.editUnavailable"));
      const voice = extractVoiceFileContext(editing.text);
      const result = await edit({
        environmentId: input.environmentId,
        input: {
          threadId: input.threadId,
          messageId: editing.id,
          expectedText: editing.text,
          text: appendVoiceFileContext(text, voice.references),
        },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result))
          throw new Error(translator.message("mobile.timeline.editFailed"));
        throw squashAtomCommandFailure(result);
      }
    },
    rewindTarget,
    onRewind: (message: ThreadFeedMessage) =>
      Dialog.alert(
        translator.message("mobile.timeline.editFromHere"),
        translator.message("mobile.timeline.rewindConfirm"),
        [
          { text: translator.message("mobile.timeline.cancel"), style: "cancel" },
          {
            text: translator.message("mobile.timeline.rewindConversation"),
            onPress: () => void rewind(message, false),
          },
          {
            text: translator.message("mobile.timeline.rewindFiles"),
            style: "destructive",
            onPress: () => void rewind(message, true),
          },
        ],
      ),
  };
}

export type TimelineMessageActions = ReturnType<typeof useTimelineMessageActions>;
