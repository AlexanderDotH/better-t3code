import { EnvironmentId, MessageId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { appendVoiceFileContext } from "@t3tools/shared/voiceFileContext";
import { useLayoutEffect, useRef } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { composerTargetKey, useComposerDraftStore } from "../../composerDraftStore";
import { usePromptStashStore } from "../../promptStashStore";
import { useComposerStash } from "./useComposerStash";
import { composerCommandKeyHandler } from "./composerCommandKey";

function Composer({ target }: { target: ScopedThreadRef }) {
  const draft = useComposerDraftStore((store) => store.getComposerDraft(target));
  const prompt = draft?.prompt ?? "";
  const promptRef = useRef(prompt);
  const composerEditorRef = useRef(null);
  const pendingThreadImportsRef = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);
  const stash = useComposerStash({
    environmentId: target.environmentId,
    composerDraftTarget: target,
    promptRef,
    readAttachmentDraft: () =>
      useComposerDraftStore.getState().getComposerDraft(target) ?? { images: [], files: [] },
    readTerminalContexts: () => [],
    routeThreadRef: target,
    projectSelectionRequired: false,
    pendingUserInputs: [],
    activePendingProgress: null,
    prompt,
    composerMenuOpen: false,
    isComposerCollapsedMobile: false,
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerThreadContexts: [],
    attachmentTargetKey: composerTargetKey(target),
    isComposerDraftTargetOpen: (key) => key === composerTargetKey(target),
    composerEditorRef,
    isRevertingCheckpoint: () => false,
    pendingThreadImportsRef,
    setComposerCursor: () => {},
    setComposerTrigger: () => {},
    importContextRecords: () => new Map(),
    expandMobileComposer: () => {},
  });
  return (
    <>
      <textarea aria-label="Message" value={prompt} readOnly />
      {stash.stashQueue.map((entry) => (
        <button key={entry.id} onClick={() => void stash.restoreStashEntryStable(entry)}>
          Restore {entry.prompt}
        </button>
      ))}
    </>
  );
}

it("stashes dictated file alternatives and merges them with the restored draft", async () => {
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  usePromptStashStore.setState({ entries: [] });
  const target = {
    environmentId: EnvironmentId.make("voice-stash"),
    threadId: ThreadId.make("voice-stash"),
  };
  const prompt = "Change [index.ts](apps/web/index.ts) please.";
  const references = [
    {
      label: "index.ts",
      previewPath: "apps/web/index.ts",
      candidates: [
        { path: "apps/web/index.ts", symbols: [] },
        { path: "apps/server/index.ts", symbols: [] },
      ],
      truncated: false,
    },
  ];
  useComposerDraftStore.getState().setPrompt(target, prompt);
  useComposerDraftStore.getState().setVoiceFileReferences(target, references);
  await using screen = await render(<Composer target={target} />);
  await screen.getByRole("textbox").click();
  const modifier = /Mac/.test(navigator.platform) ? "Meta" : "Control";
  await userEvent.keyboard(`{${modifier}>}s{/${modifier}}`);
  await expect.element(page.getByRole("button", { name: `Restore ${prompt}` })).toBeVisible();
  expect(usePromptStashStore.getState().entries[0]?.voiceFileReferences).toEqual(references);
  expect(
    useComposerDraftStore.getState().getComposerDraft(target)?.voiceFileReferences ?? [],
  ).toEqual([]);

  const otherReference = {
    label: "README.md",
    previewPath: "README.md",
    candidates: [{ path: "README.md", symbols: [] }],
    truncated: false,
  };
  await act(() => {
    useComposerDraftStore.getState().setPrompt(target, "Read [README.md](README.md).");
    useComposerDraftStore.getState().setVoiceFileReferences(target, [otherReference]);
  });
  await page.getByRole("button", { name: `Restore ${prompt}` }).click();
  await expect
    .element(screen.getByRole("textbox"))
    .toHaveValue(`Read [README.md](README.md).\n\n${prompt}`);
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.voiceFileReferences).toEqual([
    otherReference,
    ...references,
  ]);
  expect(usePromptStashStore.getState().entries).toHaveLength(0);
});

it("recalls dictated file alternatives and clears them when returning to an empty draft", () => {
  useComposerDraftStore.setState({ draftsByThreadKey: {} });
  const target = {
    environmentId: EnvironmentId.make("voice-history"),
    threadId: ThreadId.make("voice-history"),
  };
  const prompt = "Change [index.ts](apps/web/index.ts) please.";
  const references = [
    {
      label: "index.ts",
      previewPath: "apps/web/index.ts",
      candidates: [
        { path: "apps/web/index.ts", symbols: [] },
        { path: "apps/server/index.ts", symbols: [] },
      ],
      truncated: false,
    },
  ];
  const promptRef = { current: "" };
  const key = composerCommandKeyHandler({
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    sendShortcut: "enter",
    routeKind: "server",
    phase: "ready",
    isCompacting: false,
    followUpBehavior: "queue",
    isSoftwareKeyboardOpen: false,
    isLiteralPendingAnswer: false,
    pendingUserInputs: [],
    promptHistoryEntries: [
      {
        id: "voice-message",
        kind: "message",
        createdAt: "2026-01-01T00:00:00.000Z",
        message: {
          id: MessageId.make("voice-message"),
          role: "user",
          text: appendVoiceFileContext(prompt, references),
          runId: null,
          streaming: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ],
    promptHistoryPositionRef: { current: null },
    composerDraftTarget: target,
    promptRef,
    composerImagesRef: { current: [] },
    composerFilesRef: { current: [] },
    composerTerminalContextsRef: { current: [] },
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerEditorRef: {
      current: {
        isCaretOnVisualEdge: () => true,
        readSelectionRange: () => ({ start: 0, end: 0 }),
        readSnapshot: () => ({
          value: promptRef.current,
          cursor: 0,
          expandedCursor: 0,
          contextIds: [],
        }),
        focus: () => {},
        focusAt: () => {},
        focusAtEnd: () => {},
        requestCitationComment: () => {},
      },
    },
    composerMenuOpenRef: { current: false },
    composerMenuItemsRef: { current: [] },
    activeComposerMenuItemRef: { current: null },
    setComposerDraftPrompt: useComposerDraftStore.getState().setPrompt,
    setComposerCursor: () => {},
    setComposerTrigger: () => {},
    setComposerHighlightedItemId: () => {},
    dismissComposerTrigger: () => {},
    toggleInteractionMode: () => {},
    nudgeComposerMenuHighlight: () => {},
    onSelectComposerItem: () => {},
    resolveActiveComposerTrigger: () => ({ trigger: null }),
    readComposerSnapshot: () => ({ value: promptRef.current }),
    applyPromptReplacement: () => false,
    submitComposer: () => {},
  });
  expect(key("ArrowUp", new KeyboardEvent("keydown", { key: "ArrowUp" }))).toBe(true);
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(prompt);
  expect(useComposerDraftStore.getState().getComposerDraft(target)?.voiceFileReferences).toEqual(
    references,
  );
  expect(key("ArrowDown", new KeyboardEvent("keydown", { key: "ArrowDown" }))).toBe(true);
  expect(
    useComposerDraftStore.getState().getComposerDraft(target)?.voiceFileReferences ?? [],
  ).toEqual([]);
  expect(promptRef.current).toBe("");
});
