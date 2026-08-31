import {
  composerDraftHasUserContent,
  DraftId,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../../composerDraftStore";

export interface SidebarDraftRowData {
  readonly draftId: DraftId;
  readonly session: DraftSessionState;
  readonly composer: ComposerThreadDraftState;
}

export function sidebarDraftHasVisibleContent(
  session: DraftSessionState,
  composer: ComposerThreadDraftState | null | undefined,
): composer is ComposerThreadDraftState {
  return session.promotedTo == null && composerDraftHasUserContent(composer);
}

export function resolveSidebarDraftPreview(composer: ComposerThreadDraftState): string {
  const promptPreview = composer.prompt.trim().split("\n", 1)[0] ?? "";
  if (promptPreview.length > 0) return promptPreview;

  const attachmentCount =
    Math.max(composer.images.length, composer.persistedAttachments.length) +
    composer.files.length +
    composer.terminalContexts.length +
    composer.elementContexts.length +
    composer.previewAnnotations.length +
    composer.reviewComments.length;
  return `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
}

export function resolveSidebarDraftRows(input: {
  readonly sessionsByDraftId: Readonly<Record<string, DraftSessionState>>;
  readonly composersByDraftId: Readonly<Record<string, ComposerThreadDraftState>>;
  readonly activeDraftId: string | null;
  readonly frozenActiveRow: SidebarDraftRowData | null;
}): SidebarDraftRowData[] {
  const rows: SidebarDraftRowData[] = [];
  for (const [draftKey, session] of Object.entries(input.sessionsByDraftId)) {
    const composer = input.composersByDraftId[draftKey];
    if (!sidebarDraftHasVisibleContent(session, composer)) continue;
    if (draftKey === input.activeDraftId) {
      if (input.frozenActiveRow?.draftId === draftKey) rows.push(input.frozenActiveRow);
      continue;
    }
    rows.push({ draftId: DraftId.make(draftKey), session, composer });
  }
  return rows.toSorted((left, right) =>
    right.session.createdAt.localeCompare(left.session.createdAt),
  );
}
