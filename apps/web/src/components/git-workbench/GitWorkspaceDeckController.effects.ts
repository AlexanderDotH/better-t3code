import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";

import type { ChatWorkspaceCardId } from "./ChatWorkspaceDeck";
import { bufferedRevisionDisposition, selectBufferedPathsForScope } from "./gitWorkspaceDeck.logic";
import type { useGitWorkspaceDeckActions } from "./GitWorkspaceDeckController.actions";
import {
  mapDiff,
  mapInteractiveRebasePlan,
  type GitWorkspaceDeckControllerProps,
} from "./GitWorkspaceDeckController.model";
import type { useGitWorkspaceDeckQueries } from "./GitWorkspaceDeckController.queries";
import type { useGitWorkspaceDeckSession } from "./GitWorkspaceDeckController.session";
import { bufferedFileEdits, workspaceFileBufferKey } from "./GitWorkspaceDeckSessionState";
import { useGitFileDraftStore } from "./gitFileDraftStore";

export function useGitWorkspaceDeckEffects(input: {
  readonly actions: ReturnType<typeof useGitWorkspaceDeckActions>;
  readonly availableCardIds: readonly ChatWorkspaceCardId[];
  readonly isDesktop: boolean;
  readonly props: GitWorkspaceDeckControllerProps;
  readonly queries: ReturnType<typeof useGitWorkspaceDeckQueries>;
  readonly resolvedActiveCard: ChatWorkspaceCardId;
  readonly scopeKey: string;
  readonly session: ReturnType<typeof useGitWorkspaceDeckSession>;
}): void {
  const { actions, props, queries, session } = input;
  const { setDiffs } = session;
  const { onNonChatActiveChange, onExpandedChange } = props;
  const nonChatLayout = input.isDesktop && input.resolvedActiveCard !== "chat";
  const expandedLayout = input.isDesktop && session.expandedCard !== null;
  const stateToken = queries.contractSnapshot?.stateToken;

  const flushingBufferKeyRef = useRef<string | null>(null);
  const snapshot = {
    stateToken,
    diff: queries.changesDiffQuery.data,
    selectedChangeId: queries.selectedChange?.id,
    file: queries.fileQuery.data,
    fileError: queries.fileQuery.error,
    selectedFilePath: session.selectedFilePath,
    cwd: props.cwd,
    environmentId: props.environmentId,
    activeTurn: props.activeTurn,
    history: queries.historyQuery.data,
    historyCursor: session.historyCursor,
    historySnapshotOid: session.historySnapshotOid,
    patch: queries.commitPatchQuery.data,
    patchTarget: session.commitPatchTarget,
    rebase: queries.interactiveRebasePlanQuery.data,
    rebaseTarget: session.rebasePlanTarget,
  };
  const [observed, setObserved] = useState<typeof snapshot | null>(null);
  if (
    observed === null ||
    observed.stateToken !== snapshot.stateToken ||
    observed.diff !== snapshot.diff ||
    observed.selectedChangeId !== snapshot.selectedChangeId ||
    observed.file !== snapshot.file ||
    observed.fileError !== snapshot.fileError ||
    observed.selectedFilePath !== snapshot.selectedFilePath ||
    observed.cwd !== snapshot.cwd ||
    observed.environmentId !== snapshot.environmentId ||
    observed.activeTurn !== snapshot.activeTurn ||
    observed.history !== snapshot.history ||
    observed.historyCursor !== snapshot.historyCursor ||
    observed.historySnapshotOid !== snapshot.historySnapshotOid ||
    observed.patch !== snapshot.patch ||
    observed.patchTarget !== snapshot.patchTarget ||
    observed.rebase !== snapshot.rebase ||
    observed.rebaseTarget !== snapshot.rebaseTarget
  ) {
    setObserved(snapshot);
    if (observed?.stateToken !== snapshot.stateToken && snapshot.stateToken) setDiffs({});
    if (
      observed?.diff !== snapshot.diff ||
      observed?.selectedChangeId !== snapshot.selectedChangeId ||
      observed?.stateToken !== snapshot.stateToken
    )
      (() => {
        const result = queries.changesDiffQuery.data;
        const selectedChange = queries.selectedChange;
        if (!result || !selectedChange || result.path !== selectedChange.path) return;
        const expectedSource = selectedChange.id.endsWith("::index") ? "staged" : "unstaged";
        if (
          result.source !== expectedSource ||
          result.stateToken !== queries.contractSnapshot?.stateToken
        ) {
          return;
        }
        setDiffs((current) => {
          const existing = current[selectedChange.id];
          return existing?.patchId === result.patchId && !existing.stale
            ? current
            : { ...current, [selectedChange.id]: mapDiff(result) };
        });
      })();
    if (
      observed?.file !== snapshot.file ||
      observed?.selectedFilePath !== snapshot.selectedFilePath ||
      observed?.cwd !== snapshot.cwd ||
      observed?.environmentId !== snapshot.environmentId
    )
      (() => {
        const data = queries.fileQuery.data;
        if (!data || !props.cwd || data.relativePath !== session.selectedFilePath) return;
        const key = workspaceFileBufferKey(props.environmentId, props.cwd, data.relativePath);
        const buffered = bufferedFileEdits.get(key);
        if (buffered?.conflict) {
          session.setCurrentFile({
            baseContent: buffered.baseContent,
            content: buffered.content,
            ...(buffered.error ? { error: buffered.error } : {}),
            loading: false,
            path: data.relativePath,
            revision: data.revision ?? buffered.baseRevision,
            saveState: "conflict",
            serverContent: data.contents,
          });
          return;
        }
        session.setCurrentFile({
          baseContent: buffered?.baseContent ?? data.contents,
          content: buffered?.content ?? data.contents,
          ...(buffered?.error ? { error: buffered.error } : {}),
          loading: false,
          path: data.relativePath,
          ...(data.truncated
            ? { readOnlyReason: "Files over the preview limit are read-only" }
            : {}),
          revision: buffered?.baseRevision ?? data.revision ?? "legacy-no-revision",
          saveState: buffered ? "buffered" : "idle",
        });
      })();
    if (
      observed?.fileError !== snapshot.fileError ||
      observed?.file !== snapshot.file ||
      observed?.selectedFilePath !== snapshot.selectedFilePath
    )
      (() => {
        if (!session.selectedFilePath || !queries.fileQuery.error || queries.fileQuery.data) return;
        session.setCurrentFile({
          baseContent: "",
          content: "",
          loading: false,
          path: session.selectedFilePath,
          readOnlyReason: queries.fileQuery.error,
          revision: "unavailable",
          saveState: "idle",
        });
      })();
    if (observed?.activeTurn === true && !props.activeTurn && props.cwd)
      session.setBufferFlushQueue(
        selectBufferedPathsForScope(bufferedFileEdits.values(), props.environmentId, props.cwd),
      );
    if (
      observed?.history !== snapshot.history ||
      observed?.historyCursor !== snapshot.historyCursor ||
      observed?.historySnapshotOid !== snapshot.historySnapshotOid
    )
      (() => {
        const page = queries.historyQuery.data;
        if (!page) return;
        if (session.historyCursor === 0) {
          session.setHistoryItems(page.items);
          session.setHistorySnapshotOid(page.snapshotOid);
        } else if (page.snapshotOid === session.historySnapshotOid) {
          session.setHistoryItems((current) => {
            const seen = new Set(current.map((item) => item.oid));
            return [...current, ...page.items.filter((item) => !seen.has(item.oid))];
          });
        }
        session.setHistoryNextCursor(page.nextCursor);
      })();
    if (observed?.patch !== snapshot.patch || observed?.patchTarget !== snapshot.patchTarget)
      (() => {
        const patch = queries.commitPatchQuery.data;
        const target = session.commitPatchTarget;
        if (!patch || !target || patch.oid !== target.oid || patch.path !== target.path) return;
        session.setCommitPatches((current) => ({
          ...current,
          [`${patch.oid}:${patch.path}`]: patch,
        }));
      })();
    if (observed?.rebase !== snapshot.rebase || observed?.rebaseTarget !== snapshot.rebaseTarget)
      (() => {
        const prepared = queries.interactiveRebasePlanQuery.data;
        if (!prepared || prepared.upstreamRef !== session.rebasePlanTarget) return;
        session.setRebasePlan(mapInteractiveRebasePlan(prepared.items));
        session.setRebaseUpstreamRef(prepared.upstreamOid);
        session.setRebasePreparedTarget(prepared.upstreamRef);
        session.setRebasePlanTarget(null);
        session.setActiveTab("operations");
      })();
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reconciles persistent editor drafts with authoritative workspace file reads
  useEffect(() => {
    const data = queries.fileQuery.data;
    if (!data || !props.cwd) return;
    const key = workspaceFileBufferKey(props.environmentId, props.cwd, data.relativePath);
    const drafts = useGitFileDraftStore.getState();
    if (drafts.drafts.get(key)?.content === data.contents) drafts.setDraft(key, null);
  }, [queries.fileQuery.data, props.cwd, props.environmentId]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the mounted deck layout with its host and releases that registration on unmount
  useEffect(() => {
    onNonChatActiveChange(nonChatLayout);
    onExpandedChange(expandedLayout);
    return () => {
      onNonChatActiveChange(false);
      onExpandedChange(false);
    };
  }, [nonChatLayout, expandedLayout, onNonChatActiveChange, onExpandedChange]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns queued writes to workspace files after the provider turn releases the workspace
  useEffect(() => {
    const path = session.bufferFlushQueue[0];
    const data = queries.bufferedFileQuery.data;
    if (!path || !data || !props.cwd || data.relativePath !== path) return;
    const key = workspaceFileBufferKey(props.environmentId, props.cwd, path);
    const buffered = bufferedFileEdits.get(key);
    const dequeue = () => {
      flushingBufferKeyRef.current = null;
      session.setBufferFlushQueue((current) => (current[0] === path ? current.slice(1) : current));
    };
    if (!buffered) {
      dequeue();
      return;
    }
    if (bufferedRevisionDisposition(buffered.baseRevision, data.revision) === "conflict") {
      const conflicted = { ...buffered, conflict: true };
      bufferedFileEdits.set(key, conflicted);
      if (session.selectedFilePath === path) {
        session.setCurrentFile({
          baseContent: buffered.baseContent,
          content: buffered.content,
          loading: false,
          path,
          revision: data.revision ?? buffered.baseRevision,
          saveState: "conflict",
          serverContent: data.contents,
        });
      }
      dequeue();
      return;
    }
    if (flushingBufferKeyRef.current === key) return;
    flushingBufferKeyRef.current = key;
    void (async () => {
      if (buffered.createUndoBeforeWrite) {
        const refreshed = await actions.refreshWorkbench({
          environmentId: props.environmentId,
          input: { cwd: props.cwd! },
        });
        if (refreshed._tag !== "Success") {
          const failure = isAtomCommandInterrupted(refreshed)
            ? null
            : squashAtomCommandFailure(refreshed);
          if (failure && bufferedFileEdits.get(key) === buffered) {
            bufferedFileEdits.set(key, {
              ...buffered,
              error:
                failure instanceof Error
                  ? failure.message
                  : "Could not create an undo snapshot before saving.",
            });
          }
          dequeue();
          return;
        }
        const captured = await actions.createUndo({
          environmentId: props.environmentId,
          input: { cwd: props.cwd!, expectedStateToken: refreshed.value.stateToken },
        });
        if (captured._tag !== "Success") {
          const failure = isAtomCommandInterrupted(captured)
            ? null
            : squashAtomCommandFailure(captured);
          if (failure && bufferedFileEdits.get(key) === buffered) {
            bufferedFileEdits.set(key, {
              ...buffered,
              error:
                failure instanceof Error
                  ? failure.message
                  : "Could not create an undo snapshot before saving.",
            });
          }
          dequeue();
          return;
        }
      }
      const result = await actions.writeFile({
        environmentId: props.environmentId,
        input: {
          contents: buffered.content,
          cwd: props.cwd!,
          expectedRevision: buffered.baseRevision,
          relativePath: path,
        },
      });
      if (result._tag === "Success") {
        if (bufferedFileEdits.get(key) === buffered) bufferedFileEdits.delete(key);
        if (session.selectedFilePath === path) {
          session.setCurrentFile((current) =>
            current ? { ...current, content: buffered.content, saveState: "saved" } : current,
          );
          queries.fileQuery.refresh();
        }
        void actions.refreshVcsStatus({
          environmentId: props.environmentId,
          input: { cwd: props.cwd! },
        });
        queries.workbenchQuery.refresh();
        dequeue();
        return;
      }
      if (isAtomCommandInterrupted(result)) {
        dequeue();
        return;
      }
      const failure = squashAtomCommandFailure(result);
      const conflict =
        typeof failure === "object" &&
        failure !== null &&
        "_tag" in failure &&
        failure._tag === "ProjectWriteConflictError";
      if (bufferedFileEdits.get(key) === buffered) {
        bufferedFileEdits.set(key, {
          ...buffered,
          ...(conflict ? { conflict: true } : {}),
          error: failure instanceof Error ? failure.message : "Buffered file save failed.",
        });
      }
      if (session.selectedFilePath === path) {
        session.setCurrentFile((current) =>
          current
            ? {
                ...current,
                error: failure instanceof Error ? failure.message : "Buffered file save failed.",
                saveState: conflict ? "conflict" : "buffered",
              }
            : current,
        );
        queries.fileQuery.refresh();
      }
      dequeue();
    })();
  }, [actions, props, queries, session]);
}
