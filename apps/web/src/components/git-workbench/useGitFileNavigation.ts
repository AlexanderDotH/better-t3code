import { useBlocker } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";
import { ensureLocalApi } from "~/localApi";
import { toastManager } from "~/components/ui/toast";

import type { GitCurrentFileState } from "./GitWorkbench.types";
import type { GitCurrentFileDraftInput } from "./gitCurrentFileDraft";
import { useGitFileDraftStore } from "./gitFileDraftStore";
import { bufferedFileEdits, workspaceFileBufferKey } from "./GitWorkspaceDeckSessionState";

export function useGitFileNavigation(input: {
  readonly active: boolean;
  readonly blocked: boolean;
  readonly currentFile: GitCurrentFileState | null;
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId;
  readonly scopeKey: string;
  readonly scopeReady: boolean;
}) {
  const translate = useInterfaceTranslator().message;
  const activeScope = useRef<string | null>(input.scopeKey);
  const navigationBlocked = useRef(input.blocked);
  const confirmationPending = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds pending native navigation confirmations to the current workspace and invalidates them on unmount
  useEffect(() => {
    activeScope.current = input.scopeKey;
    navigationBlocked.current = input.blocked;
    return () => {
      activeScope.current = null;
    };
  }, [input.blocked, input.scopeKey]);

  const fileKey =
    input.scopeReady && input.cwd && input.currentFile
      ? workspaceFileBufferKey(input.environmentId, input.cwd, input.currentFile.path)
      : null;
  const initialDraft = useGitFileDraftStore((state) =>
    fileKey ? (state.drafts.get(fileKey) ?? null) : null,
  );
  const onDraftChange = (draft: GitCurrentFileDraftInput) => {
    if (!input.scopeReady || !input.cwd || input.currentFile?.path !== draft.path) return;
    const key = workspaceFileBufferKey(input.environmentId, input.cwd, draft.path);
    useGitFileDraftStore
      .getState()
      .setDraft(key, draft.content === input.currentFile.content ? null : draft);
  };

  const navigate = (apply: () => void) => {
    if (!input.active) {
      apply();
      return true;
    }
    if (input.currentFile?.saveState === "saving") {
      toastManager.add({ type: "info", title: translate("git.file.waitForSave") });
      return false;
    }
    if (
      !fileKey ||
      (!useGitFileDraftStore.getState().drafts.has(fileKey) && !bufferedFileEdits.has(fileKey))
    ) {
      apply();
      return true;
    }
    if (confirmationPending.current) return false;
    confirmationPending.current = true;
    return ensureLocalApi()
      .dialogs.confirm(translate("git.file.leaveEdits"))
      .then(
        (leave) => {
          confirmationPending.current = false;
          if (!leave || activeScope.current !== input.scopeKey || navigationBlocked.current)
            return false;
          apply();
          return true;
        },
        () => {
          confirmationPending.current = false;
          return false;
        },
      );
  };

  const confirmPageNavigation = async () => {
    if (useGitFileDraftStore.getState().drafts.size === 0 && bufferedFileEdits.size === 0)
      return false;
    return !(await ensureLocalApi().dialogs.confirm(translate("git.file.leaveEdits")));
  };
  useBlocker({
    shouldBlockFn: confirmPageNavigation,
    enableBeforeUnload: () =>
      useGitFileDraftStore.getState().drafts.size > 0 || bufferedFileEdits.size > 0,
  });

  return {
    initialDraft,
    navigate,
    onDraftChange,
  };
}
