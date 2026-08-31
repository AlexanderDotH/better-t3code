import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect } from "react";

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
import {
  bufferedFileEdits,
  deckSelectionByThread,
  rememberDeckSelection,
  workspaceFileBufferKey,
} from "./GitWorkspaceDeckSessionState";
import { resolveWorkspaceDeckActiveCard } from "../workspace-deck/workspaceCardDeck.logic";

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

  useEffect(() => {
    const rememberedCard = deckSelectionByThread.get(input.scopeKey) ?? "chat";
    const nextCard =
      resolveWorkspaceDeckActiveCard({
        activeCard: rememberedCard,
        cardIds: input.availableCardIds,
        fallbackCard: "chat",
      }) ?? "chat";
    if (nextCard !== rememberedCard) rememberDeckSelection(input.scopeKey, nextCard);
    session.setCurrentSelection({ card: nextCard, scopeKey: input.scopeKey });
    if (session.expandedCard !== null && !input.availableCardIds.includes(session.expandedCard)) {
      session.setExpandedCard(null);
    }
  }, [input.availableCardIds, input.scopeKey, session.expandedCard]);

  useEffect(() => {
    props.onNonChatActiveChange(input.isDesktop && input.resolvedActiveCard !== "chat");
  }, [input.isDesktop, input.resolvedActiveCard, props.onNonChatActiveChange]);

  useEffect(() => {
    props.onExpandedChange(input.isDesktop && session.expandedCard !== null);
  }, [input.isDesktop, props.onExpandedChange, session.expandedCard]);

  useEffect(
    () => () => {
      props.onNonChatActiveChange(false);
      props.onExpandedChange(false);
    },
    [props.onExpandedChange, props.onNonChatActiveChange],
  );

  useEffect(() => {
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
    session.setDiffs((current) => ({ ...current, [selectedChange.id]: mapDiff(result) }));
  }, [queries.changesDiffQuery.data, queries.contractSnapshot?.stateToken, queries.selectedChange]);

  useEffect(() => {
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
      ...(data.truncated ? { readOnlyReason: "Files over the preview limit are read-only" } : {}),
      revision: buffered?.baseRevision ?? data.revision ?? "legacy-no-revision",
      saveState: buffered ? "buffered" : "idle",
    });
  }, [queries.fileQuery.data, props.cwd, props.environmentId, session.selectedFilePath]);

  useEffect(() => {
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
  }, [queries.fileQuery.data, queries.fileQuery.error, session.selectedFilePath]);

  useEffect(() => {
    const wasActive = session.previousActiveTurnRef.current;
    session.previousActiveTurnRef.current = props.activeTurn;
    if (!wasActive || props.activeTurn || !props.cwd) return;
    session.setBufferFlushQueue(
      selectBufferedPathsForScope(bufferedFileEdits.values(), props.environmentId, props.cwd),
    );
  }, [props.activeTurn, props.cwd, props.environmentId]);

  useEffect(() => {
    const path = session.bufferFlushQueue[0];
    const data = queries.bufferedFileQuery.data;
    if (!path || !data || !props.cwd || data.relativePath !== path) return;
    const key = workspaceFileBufferKey(props.environmentId, props.cwd, path);
    const buffered = bufferedFileEdits.get(key);
    const dequeue = () => {
      session.flushingBufferKeyRef.current = null;
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
    if (session.flushingBufferKeyRef.current === key) return;
    session.flushingBufferKeyRef.current = key;
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
  }, [
    actions.createUndo,
    actions.refreshVcsStatus,
    actions.refreshWorkbench,
    actions.writeFile,
    props.cwd,
    props.environmentId,
    queries.bufferedFileQuery.data,
    queries.fileQuery.refresh,
    queries.workbenchQuery.refresh,
    session.bufferFlushQueue,
    session.selectedFilePath,
  ]);

  useEffect(() => {
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
  }, [queries.historyQuery.data, session.historyCursor, session.historySnapshotOid]);

  useEffect(() => {
    const patch = queries.commitPatchQuery.data;
    const target = session.commitPatchTarget;
    if (!patch || !target || patch.oid !== target.oid || patch.path !== target.path) return;
    session.setCommitPatches((current) => ({
      ...current,
      [`${patch.oid}:${patch.path}`]: patch,
    }));
  }, [queries.commitPatchQuery.data, session.commitPatchTarget]);

  useEffect(() => {
    const prepared = queries.interactiveRebasePlanQuery.data;
    if (!prepared || prepared.upstreamRef !== session.rebasePlanTarget) return;
    session.setRebasePlan(mapInteractiveRebasePlan(prepared.items));
    session.setRebaseUpstreamRef(prepared.upstreamOid);
    session.setRebasePlanTarget(null);
    session.setActiveTab("operations");
  }, [queries.interactiveRebasePlanQuery.data, session.rebasePlanTarget]);
}
