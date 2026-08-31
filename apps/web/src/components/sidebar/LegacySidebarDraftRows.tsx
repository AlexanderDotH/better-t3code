import type { ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { SquarePenIcon, XIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

import {
  DraftId,
  useComposerDraftStore,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../../composerDraftStore";
import {
  resolveSidebarDraftPreview,
  resolveSidebarDraftRows,
  sidebarDraftHasVisibleContent,
  type SidebarDraftRowData,
} from "./sidebarDraftViewModel";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "../ui/sidebar";

export type LegacySidebarDraftRowData = SidebarDraftRowData;
export const resolveLegacySidebarDraftPreview = resolveSidebarDraftPreview;
export const resolveLegacySidebarDraftRows = resolveSidebarDraftRows;

function projectRefKeySet(projectRefs: readonly ScopedProjectRef[]): ReadonlySet<string> {
  return new Set(projectRefs.map(scopedProjectKey));
}

function sessionBelongsToProject(
  session: DraftSessionState,
  projectRefKeys: ReadonlySet<string>,
): boolean {
  return projectRefKeys.has(
    scopedProjectKey(scopeProjectRef(session.environmentId, session.projectId)),
  );
}

export function useProjectHasDraftContent(projectRefs: readonly ScopedProjectRef[]): boolean {
  const projectRefKeys = useMemo(() => projectRefKeySet(projectRefs), [projectRefs]);
  return useComposerDraftStore((store) => {
    for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
      if (
        sessionBelongsToProject(session, projectRefKeys) &&
        sidebarDraftHasVisibleContent(session, store.draftsByThreadKey[draftKey])
      ) {
        return true;
      }
    }
    return false;
  });
}

export const LegacySidebarDraftRow = memo(function LegacySidebarDraftRow(props: {
  row: LegacySidebarDraftRowData;
  isActive: boolean;
  onNavigate: (draftId: DraftId) => void;
  onDiscard: (draftId: DraftId) => void;
}) {
  const translator = useInterfaceTranslator();
  const { draftId } = props.row;
  const preview = resolveLegacySidebarDraftPreview(props.row.composer);
  const handleActivate = useCallback(() => props.onNavigate(draftId), [draftId, props.onNavigate]);
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if ((event.target as HTMLElement).closest("button")) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        props.onNavigate(draftId);
      }
    },
    [draftId, props.onNavigate],
  );
  const handleDiscard = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      props.onDiscard(draftId);
    },
    [draftId, props.onDiscard],
  );
  const stopPointerDownPropagation = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  }, []);
  const rowButtonRender = useMemo(() => <div role="button" tabIndex={0} />, []);

  return (
    <SidebarMenuSubItem className="group/classic-draft w-full" data-thread-selection-safe>
      <SidebarMenuSubButton
        render={rowButtonRender}
        size="sm"
        isActive={props.isActive}
        data-thread-selection-safe
        data-testid={`classic-sidebar-draft-row-${draftId}`}
        className="relative isolate bg-amber-400/[0.04] hover:bg-amber-400/[0.08]"
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <SquarePenIcon
            aria-hidden
            className="size-3 shrink-0 text-amber-600 dark:text-amber-300/80"
          />
          <Tooltip>
            <TooltipTrigger
              render={<span className="min-w-0 flex-1 truncate text-sm">{preview}</span>}
            />
            <TooltipPopup side="top" className="max-w-80 whitespace-normal leading-tight">
              {preview}
            </TooltipPopup>
          </Tooltip>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={translator.message("sidebar.thread.discardDraft")}
                data-thread-selection-safe
                className="pointer-events-none absolute top-1/2 right-0.5 inline-flex h-6 min-w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md px-1 text-icon-muted opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring max-sm:pointer-events-auto max-sm:opacity-100 group-hover/classic-draft:pointer-events-auto group-hover/classic-draft:opacity-100 group-focus-within/classic-draft:pointer-events-auto group-focus-within/classic-draft:opacity-100"
                onPointerDown={stopPointerDownPropagation}
                onClick={handleDiscard}
              >
                <XIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">
            {translator.message("sidebar.thread.discardDraft")}
          </TooltipPopup>
        </Tooltip>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
});

export const LegacySidebarDraftRows = memo(function LegacySidebarDraftRows(props: {
  projectRefs: readonly ScopedProjectRef[];
  activeDraftId: string | null;
  visible: boolean;
  onNavigate: (draftId: DraftId) => void;
}) {
  const projectRefKeys = useMemo(() => projectRefKeySet(props.projectRefs), [props.projectRefs]);
  const sessionsByDraftId = useComposerDraftStore(
    useShallow((store) => {
      const sessions: Record<string, DraftSessionState> = {};
      for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
        if (sessionBelongsToProject(session, projectRefKeys)) {
          sessions[draftKey] = session;
        }
      }
      return sessions;
    }),
  );
  const composersByDraftId = useComposerDraftStore(
    useShallow((store) => {
      const composers: Record<string, ComposerThreadDraftState> = {};
      for (const draftKey of Object.keys(sessionsByDraftId)) {
        const composer = store.draftsByThreadKey[draftKey];
        if (composer) {
          composers[draftKey] = composer;
        }
      }
      return composers;
    }),
  );
  const clearDraftThread = useComposerDraftStore((store) => store.clearDraftThread);
  const [frozenActive, setFrozenActive] = useState<{
    draftId: string | null;
    row: LegacySidebarDraftRowData | null;
  }>({ draftId: null, row: null });
  if (frozenActive.draftId !== props.activeDraftId) {
    const session =
      props.activeDraftId === null ? undefined : sessionsByDraftId[props.activeDraftId];
    const composer =
      props.activeDraftId === null ? undefined : composersByDraftId[props.activeDraftId];
    const row =
      props.activeDraftId !== null &&
      session !== undefined &&
      composer !== undefined &&
      sidebarDraftHasVisibleContent(session, composer)
        ? { draftId: DraftId.make(props.activeDraftId), session, composer }
        : null;
    setFrozenActive({ draftId: props.activeDraftId, row });
  }
  const rows = useMemo(
    () =>
      resolveLegacySidebarDraftRows({
        sessionsByDraftId,
        composersByDraftId,
        activeDraftId: props.activeDraftId,
        frozenActiveRow: frozenActive.row,
      }),
    [composersByDraftId, frozenActive.row, props.activeDraftId, sessionsByDraftId],
  );
  const handleDiscard = useCallback(
    (draftId: DraftId) => {
      clearDraftThread(draftId);
    },
    [clearDraftThread],
  );

  if (!props.visible || rows.length === 0) {
    return null;
  }

  return rows.map((row) => (
    <LegacySidebarDraftRow
      key={row.draftId}
      row={row}
      isActive={row.draftId === props.activeDraftId}
      onNavigate={props.onNavigate}
      onDiscard={handleDiscard}
    />
  ));
});
