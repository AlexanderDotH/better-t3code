import {
  executeAtomQuery,
  isAtomCommandInterrupted,
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  GitQueuedWorkflow,
  GitQueuedWorkflowPlan,
  GitWorkbenchSnapshot as ContractWorkbenchSnapshot,
  ThreadId,
  TurnId,
  RunId,
} from "@t3tools/contracts";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { RegistryContext } from "@effect/atom-react";
import { useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { requestGitActionsControl } from "~/components/gitActionsControlBus";
import { toastManager } from "~/components/ui/toast";
import { projectEnvironment } from "~/state/projects";
import { gitWorkbenchEnvironment } from "~/state/gitWorkbench";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { useStableCallback } from "~/hooks/useStableCallback";

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
import { setGitFilesStaged } from "./gitStagingBatch";
import { useGitFileDraftStore } from "./gitFileDraftStore";

type DiffState = Readonly<Record<string, ReturnType<typeof mapDiff>>>;

function commandValue<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") return result.value;
  if (isAtomCommandInterrupted(result)) throw new DOMException("Request interrupted", "AbortError");
  throw squashAtomCommandFailure(result);
}

function staleGitState(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "GitWorkbenchStaleStateError"
  );
}

function withoutPathDiffs(current: DiffState, path: string): DiffState {
  const next = { ...current };
  for (const source of ["index", "worktree", "conflict"]) delete next[`${path}::${source}`];
  return next;
}

function indexEditingBlocked(input: {
  readonly activeTurn: boolean;
  readonly readOnly?: boolean | undefined;
  readonly snapshot: GitWorkbenchSnapshot | null;
}): boolean {
  return Boolean(input.readOnly || input.activeTurn || !input.snapshot || input.snapshot.stale);
}

export function useGitWorkspaceDeckActions(input: {
  readonly activeTurn: boolean;
  readonly changes: readonly GitWorkbenchChange[];
  readonly contractSnapshot: ContractWorkbenchSnapshot | null;
  readonly currentFile: GitCurrentFileState | null;
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId;
  readonly queuedWorkflow: GitQueuedWorkflow | null;
  readonly readOnly?: boolean | undefined;
  readonly refreshChangesDiff: () => void;
  readonly refreshFile: () => void;
  readonly refreshWorkbenchQuery: () => void;
  readonly setCurrentFile: Dispatch<SetStateAction<GitCurrentFileState | null>>;
  readonly setDiffs: Dispatch<SetStateAction<DiffState>>;
  readonly snapshot: GitWorkbenchSnapshot | null;
  readonly threadId: ThreadId | null;
  readonly translate: InterfaceTranslator["message"];
  readonly turnId: TurnId | null;
  readonly runId?: RunId | null;
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

  const registry = useContext(RegistryContext);
  const readLatestInput = useStableCallback(() => input);
  const stagingRequestRef = useRef<{ readonly scope: string } | null>(null);
  const scope = JSON.stringify([input.environmentId, input.cwd]);
  const [stagingState, setStagingState] = useState<{
    readonly scope: string;
    readonly pending: boolean;
    readonly error: string | null;
  }>({ scope, pending: false, error: null });
  if (stagingState.scope !== scope) setStagingState({ scope, pending: false, error: null });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- invalidates an in-flight staging request when its workspace unmounts or changes
  useEffect(() => {
    return () => {
      if (stagingRequestRef.current?.scope === scope) stagingRequestRef.current = null;
    };
  }, [scope]);

  const beginStaging = () => {
    if (stagingRequestRef.current?.scope === scope) return null;
    const request = { scope };
    stagingRequestRef.current = request;
    setStagingState({ scope, pending: true, error: null });
    return request;
  };

  const finishStaging = (request: { readonly scope: string }, error: string | null) => {
    if (stagingRequestRef.current !== request) return;
    stagingRequestRef.current = null;
    setStagingState({ scope: request.scope, pending: false, error });
  };

  const applyChangeSelection: GitWorkbenchPanelProps["onApplySelection"] = (selection) => {
    if (stagingRequestRef.current?.scope === scope) return;
    if (!input.cwd || !selection.expectedPatchId) return;
    const change = input.changes.find((candidate) => candidate.id === selection.changeId);
    if (!change) return;
    const operationActive = input.contractSnapshot?.operation.kind !== "none";
    if (indexEditingBlocked(input) || (selection.action === "discard" && operationActive)) {
      setStagingState({
        scope,
        pending: false,
        error: input.translate("git.changes.stagingBlocked"),
      });
      return;
    }
    if (selection.expectedStateToken !== input.snapshot?.stateToken) {
      input.setDiffs({});
      setStagingState({
        scope,
        pending: false,
        error: input.translate("git.changes.stagingStateChanged"),
      });
      input.refreshChangesDiff();
      input.refreshWorkbenchQuery();
      return;
    }
    const request = beginStaging();
    if (!request) return;
    const isCurrent = () =>
      stagingRequestRef.current === request &&
      JSON.stringify([readLatestInput().environmentId, readLatestInput().cwd]) === scope;
    let failure: string | null = null;
    void (async () => {
      try {
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
        commandValue(result);
        if (!isCurrent()) return;
        input.setDiffs((current) => withoutPathDiffs(current, selection.path));
      } catch (error) {
        if (!isCurrent() || (error instanceof DOMException && error.name === "AbortError")) return;
        failure = staleGitState(error)
          ? input.translate("git.changes.stagingStateChanged")
          : error instanceof Error
            ? error.message
            : input.translate("git.changes.stagingFailed");
        if (staleGitState(error)) input.setDiffs({});
      }
    })().finally(() => {
      if (isCurrent()) {
        input.refreshChangesDiff();
        input.refreshWorkbenchQuery();
        finishStaging(request, failure);
      }
    });
  };

  const setFilesStaged = (paths: readonly string[], staged: boolean) => {
    if (stagingRequestRef.current?.scope === scope) return;
    if (!input.cwd || paths.length === 0) return;
    if (indexEditingBlocked(input) || input.contractSnapshot?.operation.kind !== "none") {
      setStagingState({
        scope,
        pending: false,
        error: input.translate("git.changes.stagingBlocked"),
      });
      return;
    }
    const request = beginStaging();
    if (!request) return;
    const isCurrent = () =>
      stagingRequestRef.current === request &&
      JSON.stringify([readLatestInput().environmentId, readLatestInput().cwd]) === scope;
    const canContinue = () =>
      isCurrent() &&
      !indexEditingBlocked(readLatestInput()) &&
      readLatestInput().contractSnapshot?.operation.kind === "none";

    void (async () => {
      const result = await setGitFilesStaged({
        paths,
        staged,
        expectedStateToken: input.snapshot!.stateToken,
        canContinue,
        refreshSnapshot: async () =>
          commandValue(
            await refreshWorkbench({
              environmentId: input.environmentId,
              input: { cwd: input.cwd! },
            }),
          ),
        readDiff: async (diffInput) =>
          commandValue(
            await executeAtomQuery(
              registry,
              gitWorkbenchEnvironment.changesDiff({
                environmentId: input.environmentId,
                input: { ...diffInput, cwd: input.cwd! },
              }),
              { refresh: true, reportFailure: false },
            ),
          ),
        applyFile: async (fileInput) => {
          const applied = commandValue(
            await applySelection({
              environmentId: input.environmentId,
              input: { ...fileInput, cwd: input.cwd! },
            }),
          );
          if (isCurrent()) input.setDiffs((current) => withoutPathDiffs(current, fileInput.path));
          return applied;
        },
      });
      if (!isCurrent()) return;
      let failure: string | null = null;
      if (
        result.status === "stopped" &&
        result.reason !== "cancelled" &&
        !(result.error instanceof DOMException && result.error.name === "AbortError")
      ) {
        const stale = result.reason === "stale" || staleGitState(result.error);
        if (stale) input.setDiffs({});
        const message = stale
          ? input.translate("git.changes.stagingStateChanged")
          : result.reason === "operation"
            ? input.translate("git.changes.stagingBlocked")
            : result.reason === "conflicted"
              ? input.translate("git.quick.resolveConflicts")
              : result.error instanceof Error
                ? result.error.message
                : input.translate("git.changes.stagingFailed");
        failure = `${input.translate("git.changes.stagingStopped", {
          path: result.path,
          count: result.completedPaths.length,
        })} ${message}`;
      }
      input.refreshChangesDiff();
      input.refreshWorkbenchQuery();
      finishStaging(request, failure);
    })();
  };

  const runWorkbenchOperation: GitWorkbenchPanelProps["onRunOperation"] = (operationInput) => {
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
  };

  const queueWorkflow: GitWorkbenchPanelProps["onQueueWorkflow"] = (operationInput) => {
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
        ...(input.runId ? { runId: input.runId } : {}),
      },
    });
  };

  const resubmitQueuedWorkflow = (queueId: string, plan: GitQueuedWorkflowPlan) => {
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
        ...(existing.runId ? { runId: existing.runId } : {}),
        workflowId: existing.id,
      },
    });
  };

  const saveCurrentFile: GitWorkbenchPanelProps["onSaveCurrentFile"] = (fileInput) => {
    if (!input.cwd || !input.currentFile) return;
    const currentFile = input.currentFile;
    const key = workspaceFileBufferKey(input.environmentId, input.cwd, fileInput.path);
    if (fileInput.resolution === "agent") {
      bufferedFileEdits.delete(key);
      useGitFileDraftStore.getState().setDraft(key, null);
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
            error instanceof Error ? error.message : input.translate("git.file.changedBeforeSave"),
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
  };

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
    setFilesStaged,
    stagingPending: stagingState.scope === scope && stagingState.pending,
    stagingError: stagingState.scope === scope ? stagingState.error : null,
    upsertQueue,
    writeFile,
  };
}
