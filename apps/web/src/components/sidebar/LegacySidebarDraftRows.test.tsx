import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createEmptyThreadDraft,
  DraftId,
  type ComposerThreadDraftState,
  type DraftSessionState,
} from "../../composerDraftStore";
import {
  LegacySidebarDraftRow,
  resolveLegacySidebarDraftPreview,
  resolveLegacySidebarDraftRows,
} from "./LegacySidebarDraftRows";

const environmentId = EnvironmentId.make("environment-1");
const projectId = ProjectId.make("project-1");

function makeSession(
  draftId: DraftId,
  overrides: Partial<DraftSessionState> = {},
): DraftSessionState {
  return {
    threadId: ThreadId.make(`thread-for-${draftId}`),
    environmentId,
    projectId,
    logicalProjectKey: `${environmentId}:${projectId}`,
    createdAt: "2026-08-22T10:00:00.000Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    startFromOrigin: false,
    promotedTo: null,
    ...overrides,
  };
}

function makeComposer(prompt: string): ComposerThreadDraftState {
  return { ...createEmptyThreadDraft(), prompt };
}

describe("classic sidebar draft rows", () => {
  it("orders invested drafts newest-first and omits blank or promoted sessions", () => {
    const olderId = DraftId.make("draft-older");
    const newerId = DraftId.make("draft-newer");
    const blankId = DraftId.make("draft-blank");
    const promotedId = DraftId.make("draft-promoted");

    const rows = resolveLegacySidebarDraftRows({
      sessionsByDraftId: {
        [olderId]: makeSession(olderId),
        [newerId]: makeSession(newerId, { createdAt: "2026-08-22T11:00:00.000Z" }),
        [blankId]: makeSession(blankId, { createdAt: "2026-08-22T12:00:00.000Z" }),
        [promotedId]: makeSession(promotedId, {
          promotedTo: { environmentId, threadId: ThreadId.make("promoted-thread") },
        }),
      },
      composersByDraftId: {
        [olderId]: makeComposer("Older prompt"),
        [newerId]: makeComposer("Newer prompt"),
        [blankId]: makeComposer("  "),
        [promotedId]: makeComposer("Already sent"),
      },
      activeDraftId: null,
      frozenActiveRow: null,
    });

    expect(rows.map((row) => row.draftId)).toEqual([newerId, olderId]);
  });

  it("keeps an active draft frozen and removes it when the live session is promoted", () => {
    const draftId = DraftId.make("draft-active");
    const frozenActiveRow = {
      draftId,
      session: makeSession(draftId),
      composer: makeComposer("Frozen prompt"),
    };

    expect(
      resolveLegacySidebarDraftRows({
        sessionsByDraftId: { [draftId]: makeSession(draftId) },
        composersByDraftId: { [draftId]: makeComposer("Live prompt") },
        activeDraftId: draftId,
        frozenActiveRow,
      })[0]?.composer.prompt,
    ).toBe("Frozen prompt");

    expect(
      resolveLegacySidebarDraftRows({
        sessionsByDraftId: {
          [draftId]: makeSession(draftId, {
            promotedTo: { environmentId, threadId: ThreadId.make("promoted-thread") },
          }),
        },
        composersByDraftId: { [draftId]: makeComposer("Live prompt") },
        activeDraftId: draftId,
        frozenActiveRow,
      }),
    ).toEqual([]);
  });

  it("uses the first prompt line or an attachment-count fallback", () => {
    expect(resolveLegacySidebarDraftPreview(makeComposer("  First line\nSecond line  "))).toBe(
      "First line",
    );

    expect(
      resolveLegacySidebarDraftPreview({
        ...createEmptyThreadDraft(),
        persistedAttachments: [
          {
            id: "attachment-1",
            name: "image.png",
            mimeType: "image/png",
            sizeBytes: 42,
            dataUrl: "data:image/png;base64,AA==",
          },
        ],
      }),
    ).toBe("1 attachment");
  });

  it("renders a navigable amber draft row with a discard affordance", () => {
    const draftId = DraftId.make("draft-row");
    const html = renderToStaticMarkup(
      <LegacySidebarDraftRow
        row={{
          draftId,
          session: makeSession(draftId),
          composer: makeComposer("Bring drafts to classic"),
        }}
        isActive={false}
        onNavigate={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    expect(html).toContain('data-testid="classic-sidebar-draft-row-draft-row"');
    expect(html).toContain("Bring drafts to classic");
    expect(html).toContain('aria-label="Discard draft"');
    expect(html).toContain("text-amber");
  });
});
