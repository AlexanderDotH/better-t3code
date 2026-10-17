import { useBlocker } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef } from "react";

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
  const onDraftChange = useCallback(
    (draft: GitCurrentFileDraftInput) => {
      if (!input.scopeReady || !input.cwd || input.currentFile?.path !== draft.path) return;
      const key = workspaceFileBufferKey(input.environmentId, input.cwd, draft.path);
      useGitFileDraftStore
        .getState()
        .setDraft(key, draft.content === input.currentFile.content ? null : draft);
    },
    [input.currentFile, input.cwd, input.environmentId, input.scopeReady],
  );

  const navigate = useCallback(
    (apply: () => void) => {
      if (!input.active) {
        apply();
        return;
      }
      if (input.currentFile?.saveState === "saving") {
        toastManager.add({ type: "info", title: translate("git.file.waitForSave") });
        return;
      }
      if (
        !fileKey ||
        (!useGitFileDraftStore.getState().drafts.has(fileKey) && !bufferedFileEdits.has(fileKey))
      ) {
        apply();
        return;
      }
      if (confirmationPending.current) return;
      confirmationPending.current = true;
      void ensureLocalApi()
        .dialogs.confirm(translate("git.file.leaveEdits"))
        .then(
          (leave) => {
            confirmationPending.current = false;
            if (leave && activeScope.current === input.scopeKey && !navigationBlocked.current)
              apply();
          },
          () => {
            confirmationPending.current = false;
          },
        );
    },
    [fileKey, input.active, input.currentFile?.saveState, input.scopeKey, translate],
  );

  const confirmPageNavigation = useCallback(async () => {
    if (useGitFileDraftStore.getState().drafts.size === 0 && bufferedFileEdits.size === 0)
      return false;
    return !(await ensureLocalApi().dialogs.confirm(translate("git.file.leaveEdits")));
  }, [translate]);
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
