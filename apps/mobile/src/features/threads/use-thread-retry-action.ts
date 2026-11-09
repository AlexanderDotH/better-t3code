import { useAtomValue } from "@effect/atom-react";
import { composerFetchMode } from "@t3tools/client-runtime/composer-send-workflow";
import { resolveComposerMode } from "@t3tools/client-runtime/deep-planning";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  resolveResultlessRetryTarget,
  type EnvironmentId,
  type MessageId,
  type OrchestrationV2ThreadProjection,
  type ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";

import * as Dialog from "../../components/ui/Dialog";
import {
  describeUnavailableModelSelection,
  isModelSelectionUnavailable,
} from "../../lib/modelOptions";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { getComposerDraftSnapshot } from "../../state/use-composer-drafts";
import { useRemoteEnvironmentRuntime } from "../../state/use-remote-environment-registry";

export interface ThreadRetryAction {
  readonly messageId: MessageId;
  readonly available: boolean;
  readonly pending: boolean;
  readonly onRetry: () => void;
}

/** Retries the latest user message whose turn ended without an answer. */
export function useThreadRetryAction(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projection: OrchestrationV2ThreadProjection | null;
}): ThreadRetryAction | null {
  const translator = useMobileInterfaceTranslator();
  const runtime = useRemoteEnvironmentRuntime(input.environmentId);
  const serverConfig = runtime?.serverConfig ?? null;
  const supported = serverConfig?.environment.capabilities.threadRetry === true;
  const permitted = useAtomValue(threadEnvironment.retryTurn.permissionAtom(input.environmentId));
  const retryTurn = useAtomCommand(threadEnvironment.retryTurn, { reportFailure: false });
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const projection = input.projection;
  const target =
    supported && projection !== null && projection.thread.id === input.threadId
      ? resolveResultlessRetryTarget(projection)
      : null;
  if (target === null || projection === null) return null;

  const retry = async () => {
    const thread = projection.thread;
    const draft = getComposerDraftSnapshot(scopedThreadKey(input.environmentId, thread.id));
    const modelSelection = draft.modelSelection ?? thread.modelSelection;
    if (isModelSelectionUnavailable(serverConfig, modelSelection, thread.projectId)) {
      const { title, detail } = describeUnavailableModelSelection(
        serverConfig,
        modelSelection,
        thread.projectId,
      );
      Dialog.alert(title, detail);
      return;
    }
    const preferences = appAtomRegistry.get(mobilePreferencesAtom);
    const originalText =
      projection.messages.find((message) => message.id === target.messageId)?.text ?? "";
    const fetchMode = composerFetchMode({
      prompt: originalText,
      composerMode: resolveComposerMode(
        draft.composerMode,
        draft.interactionMode ?? thread.interactionMode,
      ),
      supportsAgentWorkflow:
        serverConfig?.environment.capabilities.agentWorkflowVersion !== undefined,
      experimentalFetch:
        AsyncResult.isSuccess(preferences) && preferences.value.experimentalFetch === true,
    });
    const result = await retryTurn({
      environmentId: input.environmentId,
      input: {
        type: "message.retry",
        commandId: CommandId.make(uuidv4()),
        threadId: thread.id,
        messageId: target.messageId,
        runId: target.runId,
        modelSelection,
        fetchMode: fetchMode ?? null,
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      throw squashAtomCommandFailure(result);
    }
    void Haptics.selectionAsync().catch(() => undefined);
  };

  return {
    messageId: target.messageId,
    available: permitted && runtime?.connectionState === "connected" && !pending,
    pending,
    onRetry: () => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      void retry()
        .catch((error: unknown) => {
          Dialog.alert(
            translator.message("mobile.thread.retryFailed"),
            error instanceof Error
              ? error.message
              : translator.message("mobile.thread.retryFailedDetail"),
          );
        })
        .finally(() => {
          pendingRef.current = false;
          setPending(false);
        });
    },
  };
}
