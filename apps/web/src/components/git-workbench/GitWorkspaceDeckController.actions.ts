import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitQueuedWorkflow,
  GitQueuedWorkflowPlan,
  GitWorkbenchSnapshot as ContractWorkbenchSnapshot,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useCallback, type Dispatch, type SetStateAction } from "react";

import { requestGitActionsControl } from "~/components/gitActionsControlBus";
import { toastManager } from "~/components/ui/toast";
import { projectEnvironment } from "~/state/projects";
import { gitWorkbenchEnvironment } from "~/state/gitWorkbench";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import type {
  GitCurrentFileState,
  GitWorkbenchChange,
  GitWorkbenchPanelProps,
  GitWorkbenchSnapshot,
} from "./GitWorkbench.types";
import {
  actionForOperation,
  directIntent,
  mapDiff,
  mapOperation,
} from "./GitWorkspaceDeckController.model";
import { bufferedFileEdits, workspaceFileBufferKey } from "./GitWorkspaceDeckSessionState";

type DiffState = Readonly<Record<string, ReturnType<typeof mapDiff>>>;

export function useGitWorkspaceDeckActions(input: {
  readonly activeTurn: boolean;
  readonly changes: readonly GitWorkbenchChange[];
  readonly contractSnapshot: ContractWorkbenchSnapshot | null;
  readonly currentFile: GitCurrentFileState | null;
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId;
  readonly queuedWorkflow: GitQueuedWorkflow | null;
  readonly refreshChangesDiff: () => void;
  readonly refreshFile: () => void;
  readonly refreshWorkbenchQuery: () => void;
  readonly setCurrentFile: Dispatch<SetStateAction<GitCurrentFileState | null>>;
  readonly setDiffs: Dispatch<SetStateAction<DiffState>>;
  readonly snapshot: GitWorkbenchSnapshot | null;
  readonly threadId: ThreadId | null;
  readonly translate: InterfaceTranslator["message"];
  readonly turnId: TurnId | null;
}) {
  const applySelection = useAtomCommand(gitWorkbenchEnvironment.applyChangeSelection, {
    reportFailure: false,
  });
  const runOperation = useAtomCommand(gitWorkbenchEnvironment.runOperation, {
    reportFailure: false,
  });
  const restoreUndo = useAtomCommand(gitWorkbenchEnvironment.restoreUndoSnapshot, {
    reportFailure: false,
  });
  const createUndo = useAtomCommand(gitWorkbenchEnvironment.createUndoSnapshot, {
    reportFailure: false,
  });
  const refreshWorkbench = useAtomCommand(gitWorkbenchEnvironment.refresh, {
    reportFailure: false,
  });
  const upsertQueue = useAtomCommand(gitWorkbenchEnvironment.upsertQueuedWorkflow, {
    reportFailure: false,
  });
  const cancelQueue = useAtomCommand(gitWorkbenchEnvironment.cancelQueuedWorkflow, {
    reportFailure: false,
  });
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });

  const applyChangeSelection = useCallback<GitWorkbenchPanelProps["onApplySelection"]>(
    (selection) => {
      if (!input.cwd || !selection.expectedPatchId) return;
      const change = input.changes.find((candidate) => candidate.id === selection.changeId);
      if (!change) return;
      void (async () => {
        const result = await applySelection({
          environmentId: input.environmentId,
          input: {
            action: selection.action,
            ...(selection.action === "discard" && change.untracked
              ? { confirmedUntrackedDeletion: true }
              : {}),
            cwd: input.cwd!,
            expectedPatchId: selection.expectedPatchId!,
            expectedStateToken: selection.expectedStateToken,
            path: selection.path,
            selection:
              selection.lineIds.length > 0
                ? { ids: selection.lineIds, kind: "lines" as const }
                : selection.hunkIds.length > 0
                  ? { ids: selection.hunkIds, kind: "hunks" as const }
                  : { kind: "file" as const },
            source: selection.source === "index" ? "staged" : "unstaged",
          },
        });
        if (result._tag === "Success") {
          input.setDiffs((current) => {
            const next = { ...current };
            delete next[selection.changeId];
            return next;
          });
          input.refreshChangesDiff();
          return;
        }
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        if (
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "GitWorkbenchStaleStateError"
        ) {
          input.setDiffs((current) => {
            const existing = current[selection.changeId];
            return existing
              ? { ...current, [selection.changeId]: { ...existing, stale: true } }
              : current;
          });
          input.refreshChangesDiff();
        }
      })();
    },
    [applySelection, input],
  );

  const runWorkbenchOperation = useCallback<GitWorkbenchPanelProps["onRunOperation"]>(
    (operationInput) => {
      if (!input.cwd || !input.snapshot) return;
      const intent = directIntent(operationInput);
      if (intent) {
        requestGitActionsControl({
          cwd: input.cwd,
          environmentId: input.environmentId,
          intent,
        });
        return;
      }
      const action = actionForOperation(operationInput, mapOperation(input.contractSnapshot));
      if (!action) {
        toastManager.add({
          type: "info",
          title: input.translate("git.operation.refreshPlanRequired"),
        });
        return;
      }
      void runOperation({
        environmentId: input.environmentId,
        input: {
          action,
          cwd: input.cwd,
          expectedStateToken: input.snapshot.stateToken,
        },
      });
    },
    [input, runOperation],
  );

  const queueWorkflow = useCallback<GitWorkbenchPanelProps["onQueueWorkflow"]>(
    (operationInput) => {
      if (!input.cwd || !input.snapshot) return;
      const advanced = actionForOperation(operationInput, mapOperation(input.contractSnapshot));
      const plan = (() => {
        if (operationInput.kind === "stage-all-and-commit") {
          return {
            createPullRequest: false,
            kind: "delivery" as const,
            push: false,
            stage: { mode: "all" as const },
          };
        }
        if (operationInput.kind === "push" || operationInput.kind === "create-pull-request") {
          return {
            createPullRequest: operationInput.kind === "create-pull-request",
            kind: "delivery" as const,
            push: true,
            stage: { mode: "staged" as const },
          };
        }
        if (
          advanced &&
          (advanced.kind === "reset" ||
            advanced.kind === "revert" ||
            advanced.kind === "cherry_pick" ||
            advanced.kind === "guided_rebase" ||
            advanced.kind === "interactive_rebase")
        ) {
          return { action: advanced, kind: "advanced_operation" as const };
        }
        return null;
      })();
      if (!plan) return;
      const existing = input.queuedWorkflow;
      void upsertQueue({
        environmentId: input.environmentId,
        input: {
          cwd: input.cwd,
          ...(existing
            ? {
                expectedRevision: existing.revision,
                replaceExisting: true,
                workflowId: existing.id,
              }
            : {}),
          expectedStateToken: input.snapshot.stateToken,
          plan,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          ...(input.turnId ? { turnId: input.turnId } : {}),
        },
      });
    },
    [input, upsertQueue],
  );

  const resubmitQueuedWorkflow = useCallback(
    (queueId: string, plan: GitQueuedWorkflowPlan) => {
      const existing = input.queuedWorkflow;
      if (!input.cwd || !input.snapshot || !existing?.threadId || existing.id !== queueId) return;
      void upsertQueue({
        environmentId: input.environmentId,
        input: {
          cwd: input.cwd,
          expectedRevision: existing.revision,
          expectedStateToken: input.snapshot.stateToken,
          plan,
          replaceExisting: true,
          threadId: existing.threadId,
          ...(existing.turnId ? { turnId: existing.turnId } : {}),
          workflowId: existing.id,
        },
      });
    },
    [input, upsertQueue],
  );

  const saveCurrentFile = useCallback<GitWorkbenchPanelProps["onSaveCurrentFile"]>(
    (fileInput) => {
      if (!input.cwd || !input.currentFile) return;
      const currentFile = input.currentFile;
      const key = workspaceFileBufferKey(input.environmentId, input.cwd, fileInput.path);
      if (fileInput.resolution === "agent") {
        bufferedFileEdits.delete(key);
        input.setCurrentFile((current) => {
          if (!current) return current;
          const { serverContent, ...rest } = current;
          const content = serverContent ?? current.content;
          return { ...rest, baseContent: content, content, saveState: "idle" };
        });
        return;
      }
      if (input.activeTurn) {
        bufferedFileEdits.set(key, {
          baseContent: currentFile.baseContent,
          baseRevision: fileInput.expectedRevision,
          content: fileInput.content,
          ...(fileInput.resolution === "mine" ? { createUndoBeforeWrite: true } : {}),
          cwd: input.cwd,
          environmentId: input.environmentId,
          path: fileInput.path,
        });
        input.setCurrentFile({
          ...currentFile,
          content: fileInput.content,
          saveState: "buffered",
        });
        return;
      }
      input.setCurrentFile((current) => (current ? { ...current, saveState: "saving" } : current));
      void (async () => {
        if (fileInput.resolution === "mine") {
          if (!input.snapshot) return;
          const captured = await createUndo({
            environmentId: input.environmentId,
            input: {
              cwd: input.cwd!,
              expectedStateToken: input.snapshot.stateToken,
            },
          });
          if (captured._tag !== "Success") {
            if (!isAtomCommandInterrupted(captured)) {
              toastManager.add({
                type: "error",
                title: input.translate("git.operation.undoSnapshotCreateFailed"),
                description: input.translate("git.file.notOverwritten"),
              });
            }
            input.setCurrentFile((current) =>
              current ? { ...current, saveState: "conflict" } : current,
            );
            return;
          }
        }
        const result = await writeFile({
          environmentId: input.environmentId,
          input: {
            contents: fileInput.content,
            cwd: input.cwd!,
            expectedRevision: fileInput.expectedRevision,
            relativePath: fileInput.path,
          },
        });
        if (result._tag === "Success") {
          bufferedFileEdits.delete(key);
          input.setCurrentFile((current) =>
            current ? { ...current, content: fileInput.content, saveState: "saved" } : current,
          );
          input.refreshFile();
          void refreshVcsStatus({
            environmentId: input.environmentId,
            input: { cwd: input.cwd! },
          });
          input.refreshWorkbenchQuery();
          return;
        }
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        const conflict =
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          error._tag === "ProjectWriteConflictError";
        if (conflict) {
          bufferedFileEdits.set(key, {
            baseContent: currentFile.baseContent,
            baseRevision: fileInput.expectedRevision,
            conflict: true,
            content: fileInput.content,
            cwd: input.cwd!,
            environmentId: input.environmentId,
            error:
              error instanceof Error
                ? error.message
                : input.translate("git.file.changedBeforeSave"),
            path: fileInput.path,
          });
        }
        input.setCurrentFile((current) =>
          current
            ? {
                ...current,
                error:
                  error instanceof Error ? error.message : input.translate("git.file.saveFailed"),
                saveState: conflict ? "conflict" : "idle",
              }
            : current,
        );
        input.refreshFile();
      })();
    },
    [createUndo, input, refreshVcsStatus, writeFile],
  );

  return {
    applyChangeSelection,
    cancelQueue,
    createUndo,
    queueWorkflow,
    refreshVcsStatus,
    refreshWorkbench,
    resubmitQueuedWorkflow,
    restoreUndo,
    runOperation,
    runWorkbenchOperation,
    saveCurrentFile,
    upsertQueue,
    writeFile,
  };
}
