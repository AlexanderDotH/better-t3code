import * as Dialog from "../../components/ui/Dialog";
import { useCallback } from "react";

import { removeThreadOutboxMessage } from "../../state/thread-outbox-removal";
import { clearComposerDraftContent } from "../../state/use-composer-drafts";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  editingQueuedMessageIdsAtom,
  holdEditingQueuedMessage,
  releaseEditingQueuedMessage,
} from "../../state/use-thread-outbox";
import { withThreadDismissal } from "./thread-dismissal";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function usePendingTaskListActions(
  selectThreadRoute: (params: ReactNavigation.RootParamList["Thread"]) => void,
): {
  readonly openPendingTask: (pendingTask: PendingNewTask) => void;
  readonly confirmDeletePendingTask: (pendingTask: PendingNewTask) => void;
} {
  const translator = useMobileInterfaceTranslator();
  const openPendingTask = useCallback(
    (pendingTask: PendingNewTask) => {
      selectThreadRoute(
        pendingTask.kind === "pending"
          ? {
              environmentId: String(pendingTask.environmentId),
              threadId: String(pendingTask.message.threadId),
            }
          : {
              draft: {
                environmentId: String(pendingTask.environmentId),
                projectId: String(pendingTask.projectId),
                draftId: pendingTask.draftKey,
              },
            },
      );
    },
    [selectThreadRoute],
  );

  const confirmDeletePendingTask = useCallback(
    (pendingTask: PendingNewTask) => {
      if (pendingTask.kind === "draft") {
        Dialog.alert(
          translator.message("mobile.ui.discardDraft"),
          `“${pendingTask.title}” will be removed.`,
          [
            {
              text: translator.message("mobile.settings.projects.settings.cancel"),
              style: "cancel",
            },
            {
              text: translator.message("mobile.git.discard"),
              style: "destructive",
              onPress: () => {
                void withThreadDismissal(
                  pendingTask.key,
                  async () =>
                    clearComposerDraftContent(pendingTask.draftKey, {
                      clearModelSelection: true,
                      clearWorkspaceSelection: true,
                    }),
                  () => true,
                );
              },
            },
          ],
        );
        return;
      }
      Dialog.alert(
        translator.message("mobile.ui.deletePendingTask"),
        `“${pendingTask.title}” has not been sent yet and will be removed from the outbox.`,
        [
          { text: translator.message("mobile.settings.projects.settings.cancel"), style: "cancel" },
          {
            text: translator.message("mobile.git.delete"),
            style: "destructive",
            onPress: () => {
              // Hold delivery from confirmation so reconnects cannot send a task during removal.
              // The editor can release the shared hold mid-animation; remove edited tasks at once.
              // Keep an editor's hold unless removal succeeds.
              const messageId = pendingTask.message.messageId;
              const heldByEditor = appAtomRegistry.get(editingQueuedMessageIdsAtom)[messageId];
              holdEditingQueuedMessage(messageId);
              const releaseUnlessEditing = () => {
                if (!heldByEditor) releaseEditingQueuedMessage(messageId);
              };
              const remove = () => removeThreadOutboxMessage(pendingTask.message);
              void (
                heldByEditor
                  ? remove()
                  : withThreadDismissal(pendingTask.key, remove, (removed) => removed)
              )
                .then((removed) =>
                  removed ? releaseEditingQueuedMessage(messageId) : releaseUnlessEditing(),
                )
                .catch((error) => {
                  releaseUnlessEditing();
                  Dialog.alert(
                    translator.message("mobile.ui.couldNotDeletePendingTask"),
                    error instanceof Error
                      ? error.message
                      : translator.message("mobile.ui.thePendingTaskCouldNotBeRemoved"),
                  );
                });
            },
          },
        ],
      );
    },
    [translator],
  );

  return { openPendingTask, confirmDeletePendingTask };
}
