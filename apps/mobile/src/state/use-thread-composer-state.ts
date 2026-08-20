import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CommandId,
  MessageId,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationProposedPlan,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import {
  buildPlanImplementationPrompt,
  type PlanImplementationStrategy,
} from "@t3tools/client-runtime/plan-implementation";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import {
  consumeReasoningRecommendationOverride,
  reconcileReasoningRecommendationState,
  resolveReasoningTurnModelSelection,
  type ReasoningRecommendationState,
} from "@t3tools/client-runtime/reasoning-recommendation";
import { resolveCodexContextWindowTokens } from "@t3tools/shared/model";
import { deriveActiveWorkStartedAt } from "@t3tools/shared/orchestrationTiming";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import { makeQueuedMessageMetadata } from "../lib/commandMetadata";
import {
  convertPastedImagesToAttachments,
  pasteComposerClipboard,
  pickComposerImages,
} from "../lib/composerImages";
import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { scopedThreadKey } from "../lib/scopedEntities";
import { buildThreadFeed } from "../lib/threadActivity";
import { appAtomRegistry } from "../state/atom-registry";
import {
  appendComposerDraftAttachments,
  appendComposerDraftText,
  clearComposerDraftContent,
  composerDraftsAtom,
  ensureComposerDraftsLoaded,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  removeComposerDraftAttachment,
  setComposerDraftText,
  updateComposerDraftSettings,
  useComposerDraft,
} from "./use-composer-drafts";
import {
  setPendingConnectionError,
  useRemoteConnectionStatus,
} from "../state/use-remote-environment-registry";
import { useSelectedThreadDetail } from "../state/use-thread-detail";
import { useThreadSelection } from "../state/use-thread-selection";
import { enqueueThreadOutboxMessage } from "./thread-outbox";
import { useThreadOutboxMessages } from "./use-thread-outbox";
import { useEnvironmentServerConfig } from "./entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";
import { serverEnvironment } from "./server";
import { threadEnvironment } from "./threads";
import { useAtomCommand } from "./use-atom-command";
import { resolveMobileAgentWorkflowSettings } from "./agent-workflow-settings";

export function appendReviewCommentToDraft(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly text: string;
  readonly attachments?: ReadonlyArray<DraftComposerImageAttachment>;
}): void {
  const threadKey = scopedThreadKey(input.environmentId, input.threadId);
  const existing = appAtomRegistry.get(composerDraftsAtom)[threadKey]?.text ?? "";
  const separator = existing.trim().length > 0 && !existing.endsWith("\n") ? "\n\n" : "";
  setComposerDraftText(threadKey, `${existing}${separator}${input.text}`);
  if (input.attachments && input.attachments.length > 0) {
    appendComposerDraftAttachments(threadKey, input.attachments);
  }
}

export function useThreadDraftForThread(input: {
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
}) {
  const threadKey =
    input.environmentId && input.threadId
      ? scopedThreadKey(input.environmentId, input.threadId)
      : null;
  const draft = useComposerDraft(threadKey);

  return {
    draftMessage: draft.text,
    draftAttachments: draft.attachments,
  };
}

export function useThreadComposerState() {
  const { selectedThread: selectedThreadShell } = useThreadSelection();
  const selectedThreadDetail = useSelectedThreadDetail();
  const composerDrafts = useAtomValue(composerDraftsAtom);
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const improvePrompt = useAtomCommand(serverEnvironment.improvePrompt, { reportFailure: false });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [isImprovingPrompt, setIsImprovingPrompt] = useState(false);
  const serverConfig = useEnvironmentServerConfig(selectedThreadShell?.environmentId ?? null);
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : {};
  const workflowSettings = useMemo(
    () =>
      resolveMobileAgentWorkflowSettings({
        agentWorkflowVersion: serverConfig?.environment.capabilities.agentWorkflowVersion,
        experimentalFetch: preferences.experimentalFetch,
      }),
    [preferences.experimentalFetch, serverConfig?.environment.capabilities.agentWorkflowVersion],
  );

  useEffect(() => {
    ensureComposerDraftsLoaded();
  }, []);

  const selectedThreadKey = selectedThreadShell
    ? scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id)
    : null;
  const selectedThreadQueuedMessages = useMemo(
    () => (selectedThreadKey ? (queuedMessagesByThreadKey[selectedThreadKey] ?? []) : []),
    [queuedMessagesByThreadKey, selectedThreadKey],
  );
  const selectedThreadFeed = useMemo(
    () => (selectedThreadDetail ? buildThreadFeed(selectedThreadDetail) : []),
    [selectedThreadDetail],
  );

  const selectedDraft = selectedThreadKey ? composerDrafts[selectedThreadKey] : null;
  const draftMessage = selectedDraft?.text ?? "";
  const draftAttachments = selectedDraft?.attachments ?? [];
  const selectedThreadQueueCount = selectedThreadQueuedMessages.length;
  const selectedThread = selectedThreadDetail ?? selectedThreadShell;
  const modelSelection = selectedDraft?.modelSelection ?? selectedThread?.modelSelection ?? null;
  const runtimeMode = selectedDraft?.runtimeMode ?? selectedThread?.runtimeMode ?? null;
  const interactionMode = selectedDraft?.interactionMode ?? selectedThread?.interactionMode ?? null;
  const reasoningRecommendationState = selectedDraft?.reasoningRecommendation ?? null;

  const selectedThreadSessionActivity = useMemo(() => {
    const selectedThread = selectedThreadDetail ?? selectedThreadShell;
    if (!selectedThread?.session) {
      return null;
    }

    return {
      orchestrationStatus: selectedThread.session.status,
      activeTurnId: selectedThread.session.activeTurnId ?? undefined,
    };
  }, [selectedThreadDetail, selectedThreadShell]);

  const activeWorkStartedAt = useMemo(() => {
    const selectedThread = selectedThreadDetail ?? selectedThreadShell;
    if (!selectedThread) {
      return null;
    }

    return deriveActiveWorkStartedAt(
      selectedThread.latestTurn,
      selectedThreadSessionActivity,
      null,
    );
  }, [selectedThreadDetail, selectedThreadSessionActivity, selectedThreadShell]);

  const activeThreadBusy =
    !!selectedThread &&
    (selectedThread.session?.status === "running" || selectedThread.session?.status === "starting");

  const onSendMessage = useCallback(async () => {
    if (!selectedThreadShell) {
      return null;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const draft = getComposerDraftSnapshot(threadKey);
    const thread = selectedThreadDetail ?? selectedThreadShell;
    let text = draft.text.trim();
    const attachments = draft.attachments;
    if (text.length === 0 && attachments.length === 0) {
      return null;
    }

    const shouldImprovePromptBeforeSend =
      workflowSettings.supported && preferences.improvePromptBeforeSend === true && text.length > 0;
    const environmentConnected = connectedEnvironments.some(
      (environment) =>
        environment.environmentId === selectedThreadShell.environmentId &&
        environment.connectionState === "connected",
    );

    if (shouldImprovePromptBeforeSend && environmentConnected) {
      setIsImprovingPrompt(true);
      const result = await improvePrompt({
        environmentId: selectedThreadShell.environmentId,
        input: { projectId: selectedThreadShell.projectId, text },
      });
      setIsImprovingPrompt(false);
      if (AsyncResult.isFailure(result)) {
        const error = Cause.squash(result.cause);
        setPendingConnectionError(
          error instanceof Error ? error.message : "Could not improve the prompt.",
        );
        return null;
      }
      const currentDraft = getComposerDraftSnapshot(threadKey);
      if (currentDraft.text !== draft.text) {
        return null;
      }
      text = result.value.text.trim();
    }

    const metadata = makeQueuedMessageMetadata();
    const messageId = MessageId.make(metadata.messageId);
    // Enqueue publishes the queued atom synchronously (the durable write
    // happens behind it), so clearing the draft here gives send feedback on
    // the tap frame instead of after file I/O. If the write fails the message
    // is rolled out of the queue and the content is merged back into the
    // draft, preserving anything typed since.
    const durableModelSelection = draft.modelSelection ?? thread.modelSelection;
    const reasoningTurnSelection = resolveReasoningTurnModelSelection(
      durableModelSelection,
      draft.reasoningRecommendation?.pendingOverride,
    );
    const consumedPendingOverride = reasoningTurnSelection.applied
      ? draft.reasoningRecommendation?.pendingOverride
      : undefined;
    const enqueuePromise = enqueueThreadOutboxMessage({
      environmentId: selectedThreadShell.environmentId,
      threadId: selectedThreadShell.id,
      messageId,
      commandId: CommandId.make(metadata.commandId),
      text,
      attachments,
      modelSelection: durableModelSelection,
      ...(reasoningTurnSelection.applied
        ? { turnModelSelection: reasoningTurnSelection.turnModelSelection }
        : {}),
      ...(workflowSettings.fetchMode === undefined
        ? {}
        : { fetchMode: workflowSettings.fetchMode }),
      ...(shouldImprovePromptBeforeSend && !environmentConnected
        ? { improvePromptBeforeSend: true }
        : {}),
      runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
      interactionMode: draft.interactionMode ?? thread.interactionMode,
      createdAt: metadata.createdAt,
    });
    clearComposerDraftContent(threadKey);
    void enqueuePromise.then(
      () => {
        if (!consumedPendingOverride) {
          return;
        }
        const current = getComposerDraftSnapshot(threadKey).reasoningRecommendation;
        if (!current) {
          return;
        }
        const next = consumeReasoningRecommendationOverride(current, consumedPendingOverride);
        if (next !== current) {
          updateComposerDraftSettings(threadKey, { reasoningRecommendation: next });
        }
      },
      () => undefined,
    );
    enqueuePromise.catch((error: unknown) => {
      // Restore text via merge (idempotent) but attachments via the uncapped
      // append: the merge path slots existing attachments first and truncates
      // at the send limit, which would silently drop this message's images if
      // the user attached new ones while the write was in flight.
      void mergeComposerDraftContent(threadKey, { text, attachments: [] });
      appendComposerDraftAttachments(threadKey, attachments);
      setPendingConnectionError(
        error instanceof Error ? error.message : "Failed to save the queued message.",
      );
    });
    return messageId;
  }, [
    improvePrompt,
    connectedEnvironments,
    preferences.improvePromptBeforeSend,
    selectedThreadDetail,
    selectedThreadShell,
    workflowSettings.fetchMode,
    workflowSettings.supported,
  ]);

  const onImproveDraft = useCallback(async () => {
    if (!selectedThreadShell || !workflowSettings.supported || isImprovingPrompt) {
      return;
    }
    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const original = getComposerDraftSnapshot(threadKey).text;
    const text = original.trim();
    if (text.length === 0) {
      return;
    }

    setIsImprovingPrompt(true);
    const result = await improvePrompt({
      environmentId: selectedThreadShell.environmentId,
      input: { projectId: selectedThreadShell.projectId, text },
    });
    setIsImprovingPrompt(false);
    if (AsyncResult.isFailure(result)) {
      const error = Cause.squash(result.cause);
      setPendingConnectionError(
        error instanceof Error ? error.message : "Could not improve the prompt.",
      );
      return;
    }
    if (getComposerDraftSnapshot(threadKey).text !== original) {
      return;
    }
    setComposerDraftText(threadKey, result.value.text);
    setPendingConnectionError(null);
  }, [improvePrompt, isImprovingPrompt, selectedThreadShell, workflowSettings.supported]);

  const onImplementPlan = useCallback(
    async (
      proposedPlan: OrchestrationProposedPlan,
      strategy: PlanImplementationStrategy,
    ): Promise<MessageId | null> => {
      if (
        !selectedThreadShell ||
        !workflowSettings.supported ||
        proposedPlan.implementedAt !== null
      ) {
        return null;
      }
      const thread = selectedThreadDetail ?? selectedThreadShell;
      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      const draft = getComposerDraftSnapshot(threadKey);
      const durableModelSelection = draft.modelSelection ?? thread.modelSelection;
      const provider = serverConfig?.providers.find(
        (candidate) => candidate.instanceId === durableModelSelection.instanceId,
      );
      let text: string;
      try {
        text = buildPlanImplementationPrompt(proposedPlan.planMarkdown, {
          strategy,
          ...(provider ? { provider } : {}),
        });
      } catch (error) {
        setPendingConnectionError(
          error instanceof Error ? error.message : "This provider cannot implement in parallel.",
        );
        return null;
      }

      const metadata = makeQueuedMessageMetadata();
      const messageId = MessageId.make(metadata.messageId);
      try {
        await enqueueThreadOutboxMessage({
          environmentId: selectedThreadShell.environmentId,
          threadId: selectedThreadShell.id,
          messageId,
          commandId: CommandId.make(metadata.commandId),
          text,
          attachments: [],
          modelSelection: durableModelSelection,
          ...(workflowSettings.fetchMode === undefined
            ? {}
            : { fetchMode: workflowSettings.fetchMode }),
          runtimeMode: draft.runtimeMode ?? thread.runtimeMode,
          interactionMode: "default",
          sourceProposedPlan: {
            threadId: selectedThreadShell.id,
            planId: proposedPlan.id,
          },
          createdAt: metadata.createdAt,
        });
      } catch (error) {
        setPendingConnectionError(
          error instanceof Error ? error.message : "Failed to queue plan implementation.",
        );
        return null;
      }
      setPendingConnectionError(null);
      return messageId;
    },
    [
      selectedThreadDetail,
      selectedThreadShell,
      serverConfig,
      workflowSettings.fetchMode,
      workflowSettings.supported,
    ],
  );

  const onChangeDraftMessage = useCallback(
    (value: string) => {
      if (!selectedThreadShell) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      setComposerDraftText(threadKey, value);
    },
    [selectedThreadShell],
  );

  const onPickDraftImages = useCallback(async () => {
    if (!selectedThreadShell) {
      return;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const result = await pickComposerImages({
      existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
    });
    if (result.images.length > 0) {
      appendComposerDraftAttachments(threadKey, result.images);
    }
    if (result.error) {
      setPendingConnectionError(result.error);
    }
  }, [composerDrafts, selectedThreadShell]);

  const onPasteIntoDraft = useCallback(async () => {
    if (!selectedThreadShell) {
      return;
    }

    const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
    const result = await pasteComposerClipboard({
      existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
    });
    if (result.images.length > 0) {
      appendComposerDraftAttachments(threadKey, result.images);
    }
    if (result.text) {
      appendComposerDraftText(threadKey, result.text);
    }
    if (result.error) {
      setPendingConnectionError(result.error);
    }
  }, [composerDrafts, selectedThreadShell]);

  const onNativePasteImages = useCallback(
    async (uris: ReadonlyArray<string>) => {
      if (!selectedThreadShell || uris.length === 0) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      try {
        const images = await convertPastedImagesToAttachments({
          uris,
          existingCount: composerDrafts[threadKey]?.attachments.length ?? 0,
        });
        if (images.length > 0) {
          appendComposerDraftAttachments(threadKey, images);
        }
      } catch (error) {
        console.error("[native paste] error converting images", {
          environmentId: selectedThreadShell.environmentId,
          threadId: selectedThreadShell.id,
          uriCount: uris.length,
          ...safeErrorLogAttributes(error),
        });
      }
    },
    [composerDrafts, selectedThreadShell],
  );

  const onRemoveDraftImage = useCallback(
    (imageId: string) => {
      if (!selectedThreadShell) {
        return;
      }

      const threadKey = scopedThreadKey(selectedThreadShell.environmentId, selectedThreadShell.id);
      removeComposerDraftAttachment(threadKey, imageId);
    },
    [selectedThreadShell],
  );

  const onUpdateModelSelection = useCallback(
    (value: ModelSelection) => {
      if (!selectedThreadKey) {
        return;
      }
      const current = getComposerDraftSnapshot(selectedThreadKey).reasoningRecommendation;
      const reconciled = reconcileReasoningRecommendationState(current, value);
      updateComposerDraftSettings(selectedThreadKey, {
        modelSelection: value,
        ...(reconciled && reconciled !== current ? { reasoningRecommendation: reconciled } : {}),
      });

      const updatesCurrentChatContext =
        modelSelection !== null &&
        selectedThreadShell !== null &&
        value.instanceId === modelSelection.instanceId &&
        value.model === modelSelection.model &&
        resolveCodexContextWindowTokens(value) !== resolveCodexContextWindowTokens(modelSelection);
      if (updatesCurrentChatContext) {
        void updateThreadMetadata({
          environmentId: selectedThreadShell.environmentId,
          input: {
            threadId: selectedThreadShell.id,
            modelSelection: value,
          },
        });
      }
    },
    [modelSelection, selectedThreadKey, selectedThreadShell, updateThreadMetadata],
  );

  const onSetReasoningRecommendation = useCallback(
    (value: ReasoningRecommendationState) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { reasoningRecommendation: value });
    },
    [selectedThreadKey],
  );

  const onUpdateRuntimeMode = useCallback(
    (value: RuntimeMode) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { runtimeMode: value });
    },
    [selectedThreadKey],
  );

  const onUpdateInteractionMode = useCallback(
    (value: ProviderInteractionMode) => {
      if (!selectedThreadKey) {
        return;
      }
      updateComposerDraftSettings(selectedThreadKey, { interactionMode: value });
    },
    [selectedThreadKey],
  );

  const onUpdateFetchEnabled = useCallback(
    (value: boolean) => {
      if (!workflowSettings.supported) {
        return;
      }
      savePreferences({ experimentalFetch: value });
    },
    [savePreferences, workflowSettings.supported],
  );

  return {
    selectedThreadFeed,
    selectedThreadQueueCount,
    activeWorkStartedAt,
    draftMessage,
    draftAttachments,
    modelSelection,
    runtimeMode,
    interactionMode,
    reasoningRecommendationState,
    fetchSupported: workflowSettings.supported,
    fetchEnabled: workflowSettings.fetchEnabled,
    parallelPlanImplementationEnabled:
      workflowSettings.supported && preferences.experimentalParallelPlanImplementation === true,
    isImprovingPrompt,
    activeThreadBusy,
    onChangeDraftMessage,
    onPickDraftImages,
    onPasteIntoDraft,
    onNativePasteImages,
    onRemoveDraftImage,
    onSendMessage,
    onImproveDraft,
    onImplementPlan,
    onUpdateFetchEnabled,
    onUpdateModelSelection,
    onUpdateRuntimeMode,
    onUpdateInteractionMode,
    onSetReasoningRecommendation,
  };
}
