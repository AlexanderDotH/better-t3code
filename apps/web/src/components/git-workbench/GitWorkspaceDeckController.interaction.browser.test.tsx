import {
  EnvironmentId,
  ThreadId,
  type GitWorkbenchSnapshot as ContractSnapshot,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

import type { GitWorkbenchPanelProps } from "./GitWorkbench.types";
import type { GitWorkspaceDeckControllerProps } from "./GitWorkspaceDeckController.model";

interface QueryRequest {
  readonly kind: string;
  readonly input?: unknown;
}

const runtime = vi.hoisted(() => ({
  actions: {
    applyChangeSelection: vi.fn(),
    cancelQueue: vi.fn(),
    createUndo: vi.fn(),
    queueWorkflow: vi.fn(),
    refreshVcsStatus: vi.fn(),
    refreshWorkbench: vi.fn(),
    resubmitQueuedWorkflow: vi.fn(),
    restoreUndo: vi.fn(),
    runOperation: vi.fn(),
    runWorkbenchOperation: vi.fn(),
    saveCurrentFile: vi.fn(),
    setFilesStaged: vi.fn(),
    upsertQueue: vi.fn(),
    writeFile: vi.fn(),
  },
  branchPicker: vi.fn(),
  confirm: vi.fn<() => Promise<boolean>>(),
  errors: new Map<string, string>(),
  data: new Map<string, unknown>(),
  desktop: true,
  deckEnabled: true,
  gitEnabled: true,
  queries: [] as QueryRequest[],
  realPanel: false,
  refresh: vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ status: "idle" }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useBlocker: vi.fn(),
}));
vi.mock("~/state/session", async (importOriginal) => {
  const { sessionGrantsScope } = await import("@t3tools/contracts");
  return {
    ...(await importOriginal<typeof import("~/state/session")>()),
    useEnvironmentScope: (
      _environmentId: EnvironmentId,
      scope: import("@t3tools/contracts").AuthEnvironmentScope,
    ) =>
      sessionGrantsScope(
        {
          authenticated: true,
          scopes:
            (
              runtime.data.get("sessionAccess") as
                | {
                    scopes: import("@t3tools/contracts").AuthEnvironmentScope[];
                  }
                | undefined
            )?.scopes ?? [],
        },
        scope,
      ),
  };
});
vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => runtime.desktop,
}));
vi.mock("../../hooks/useBetterT3Feature", () => ({
  useBetterT3DeviceFeature: (key: string) =>
    key === "chat.workspaceCardDeck"
      ? runtime.deckEnabled
      : key === "workspace.gitWorkbench"
        ? runtime.gitEnabled
        : false,
}));
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key, date: () => "12:00" }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { wordWrap: boolean }) => unknown) =>
    select({ wordWrap: false }),
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("~/components/files/WorkspaceFileEditorSurface", () => ({
  WorkspaceFileEditorSurface: (props: {
    ariaLabel: string;
    contentEditable: boolean;
    file: { contents: string };
    onEditChange: (event: { file: { contents: string } }) => void;
  }) => (
    <textarea
      aria-label={props.ariaLabel}
      onChange={(event) => props.onEditChange({ file: { contents: event.currentTarget.value } })}
      readOnly={!props.contentEditable}
      value={props.file.contents}
    />
  ),
}));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: runtime.confirm } }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: QueryRequest | null) => {
    if (query) runtime.queries.push(query);
    return {
      data: query ? (runtime.data.get(query.kind) ?? null) : null,
      error: query ? (runtime.errors.get(query.kind) ?? null) : null,
      isPending: false,
      refresh: runtime.refresh,
    };
  },
}));
vi.mock("../../state/gitWorkbench", () => ({
  gitWorkbenchEnvironment: Object.fromEntries(
    [
      "workbench",
      "insights",
      "changesDiff",
      "history",
      "commitDetail",
      "commitFileDiff",
      "interactiveRebasePlan",
      "sessionAccess",
      "operationProgress",
    ].map((kind) => [kind, (scope: object) => ({ kind, ...scope })]),
  ),
}));
vi.mock("../../state/vcs", () => ({
  vcsEnvironment: { listRefs: (scope: object) => ({ kind: "listRefs", ...scope }) },
}));
vi.mock("../../state/projects", () => ({
  projectEnvironment: { readFile: (scope: object) => ({ kind: "readFile", ...scope }) },
}));
vi.mock("./GitWorkspaceDeckController.actions", () => ({
  useGitWorkspaceDeckActions: () => ({
    ...runtime.actions,
    stagingPending: false,
    stagingError: null,
  }),
}));
vi.mock("../mcp-workspace/McpWorkspaceController", () => ({
  McpWorkspaceRuntimeProvider: ({ children }: { children: ReactNode }) => children,
  McpWorkspaceCardController: () => <div>MCP</div>,
  McpWorkspacePeekController: () => <div>MCP peek</div>,
}));
vi.mock("./GitWorkbenchPanel", async (importOriginal) => {
  const { GitWorkbenchPanel: ActualPanel } =
    await importOriginal<typeof import("./GitWorkbenchPanel")>();
  return {
    GitWorkbenchPanel: (props: GitWorkbenchPanelProps) =>
      runtime.realPanel ? (
        <ActualPanel {...props} />
      ) : (
        <div data-active-git-tab={props.activeTab}>
          <button type="button" onClick={() => props.onChangeTab("overview")}>
            Overview
          </button>
          <button type="button" onClick={() => props.onChangeTab("history")}>
            History
          </button>
          <button
            type="button"
            data-review-select
            onClick={() => props.onSelectChange(props.changes[0]?.id ?? null)}
          >
            Review first change
          </button>
          <button
            type="button"
            data-review-edit
            onClick={() => props.onOpenCurrentFile(props.changes[0]?.path ?? "src/unchanged.ts")}
          >
            Edit current file
          </button>
          <button
            type="button"
            data-history-current
            onClick={() => props.onOpenCurrentFile("src/unchanged.ts")}
          >
            Open current working tree version
          </button>
          <button type="button" data-back-diff onClick={props.onCloseCurrentFile}>
            Back to Diff
          </button>
          <button type="button" data-go-changes onClick={() => props.onChangeTab("changes")}>
            Changes
          </button>
          <button
            type="button"
            data-type-file
            onClick={() =>
              props.currentFile &&
              props.onCurrentFileDraftChange?.({
                path: props.currentFile.path,
                content: "typed edits",
                revision: props.currentFile.revision,
              })
            }
          >
            Type file draft
          </button>
          <output data-editor-path>{props.editorPath}</output>
          <output data-file-error>{props.currentFile?.readOnlyReason}</output>
          <output data-file-draft>{props.currentFileDraft?.content}</output>
          <output data-selected-change>{props.selectedChangeId}</output>
          {props.activeTab === "changes" ? props.commitComposer : null}
        </div>
      ),
  };
});

import { useGitWorkspaceDeckController } from "./GitWorkspaceDeckController.orchestration";
import { GitWorkspaceDeckPresentation } from "./GitWorkspaceDeckController.presentation";
import { useGitWorkspaceDeckSession } from "./GitWorkspaceDeckController.session";
import { bufferedFileEdits, deckSelectionByThread } from "./GitWorkspaceDeckSessionState";
import { useGitFileDraftStore } from "./gitFileDraftStore";
import { useGitCommitDraftStore } from "./gitCommitDraftStore";
import { requestGitWorkbenchEntry } from "./gitWorkbenchEntryBus";

const environmentId = EnvironmentId.make("environment-1");
const legacyStatus: VcsStatusResult = {
  aheadCount: 0,
  behindCount: 0,
  hasPrimaryRemote: true,
  hasUpstream: true,
  hasWorkingTreeChanges: false,
  isDefaultRef: false,
  isRepo: true,
  pr: null,
  refName: "feature",
  workingTree: { files: [], insertions: 0, deletions: 0 },
};
const contractSnapshot: ContractSnapshot = {
  aheadCount: 0,
  behindCount: 0,
  detached: false,
  files: [],
  generatedAt: "2026-10-17T10:00:00.000Z",
  gitCommonDir: "/repo/.git",
  headOid: "a".repeat(40),
  isRepository: true,
  operation: { kind: "none" },
  refName: "feature",
  registeredCwd: "/repo",
  repositoryRoot: "/repo",
  stateToken: "state-1",
  totals: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, insertions: 0, deletions: 0 },
  truncated: false,
  unborn: false,
  upstreamRef: "origin/feature",
  worktreeRoot: "/repo",
};

function BranchPickerFixture() {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);
  return (
    <div>
      <button
        type="button"
        aria-label="Choose branch"
        onClick={() => {
          runtime.branchPicker();
          setOpen(true);
        }}
      >
        feature
      </button>
      {open ? <input aria-label="Branch name" defaultValue="" ref={fieldRef} /> : null}
    </div>
  );
}

function controllerProps(
  overrides: Partial<GitWorkspaceDeckControllerProps> = {},
): GitWorkspaceDeckControllerProps {
  return {
    activeTurn: false,
    actionRequired: false,
    composerRef: { current: null },
    cwd: "/repo",
    environmentId,
    isRecording: false,
    legacyStatus,
    legacyStatusPending: false,
    mcpAuthorizationAvailable: false,
    mcpConfiguredServers: [],
    mcpProviderDisplayName: "Codex",
    mcpProviderDriver: null,
    mcpProviderInstanceId: null,
    mcpProviders: [],
    mcpRuntimeSessionId: null,
    mcpWorkspaceSupported: false,
    onExpandedChange: vi.fn(),
    onNonChatActiveChange: vi.fn(),
    onOpenFile: vi.fn(),
    renderChat: () => <textarea aria-label="Chat composer" defaultValue="Draft" />,
    renderGitPeek: () => <BranchPickerFixture />,
    threadId: ThreadId.make("thread-1"),
    turnId: null,
    workbenchSupported: true,
    ...overrides,
  };
}

function ControllerHarness(props: GitWorkspaceDeckControllerProps) {
  const presentation = useGitWorkspaceDeckController(props);
  return <GitWorkspaceDeckPresentation {...presentation} />;
}

async function createControllerFixture() {
  runtime.desktop = true;
  runtime.deckEnabled = true;
  runtime.gitEnabled = true;
  runtime.realPanel = false;
  runtime.queries.length = 0;
  runtime.data.clear();
  runtime.errors.clear();
  runtime.confirm.mockReset().mockResolvedValue(true);
  useGitFileDraftStore.getState().clear();
  useGitCommitDraftStore.getState().clear();
  runtime.data.set("workbench", {
    snapshot: contractSnapshot,
    queuedWorkflow: null,
    undoSnapshots: [],
  });
  runtime.data.set("sessionAccess", { scopes: ["orchestration:operate"] });
  for (const action of Object.values(runtime.actions)) action.mockReset();
  runtime.branchPicker.mockReset();
  bufferedFileEdits.clear();
  deckSelectionByThread.clear();
  const screen = await render(null);
  const { container } = screen;

  async function renderController(overrides: Partial<GitWorkspaceDeckControllerProps> = {}) {
    await screen.rerender(<ControllerHarness {...controllerProps(overrides)} />);
  }

  async function click(selector: string) {
    const target = container.querySelector<HTMLButtonElement>(selector);
    if (!target) throw new Error(`Missing interaction target: ${selector}`);
    await act(() => target.click());
    return target;
  }

  function expectOpenChanges() {
    expect(
      container.querySelector("[data-chat-workspace-deck]")?.getAttribute("data-active-card"),
    ).toBe("git");
    expect(
      container.querySelector("[data-workspace-card-deck]")?.getAttribute("data-expanded-card"),
    ).toBe("git");
    expect(
      container.querySelector("[data-active-git-tab]")?.getAttribute("data-active-git-tab"),
    ).toBe("changes");
  }

  async function openReview() {
    await renderController();
    await click('[data-workspace-card-peek="git"] [data-workspace-card-peek-trigger]');
  }

  async function openPreparedCommit(activeTurn = false) {
    setReviewSnapshot({ ...reviewFile, staged: true, indexStatus: "modified" });
    await renderController({ activeTurn });
    await act(() => {
      expect(requestGitWorkbenchEntry({ environmentId, cwd: "/repo", focusCommit: true })).toBe(
        true,
      );
    });
  }

  async function writeCommitMessage(message: string) {
    await click('[data-git-commit-mode="manual"]');
    const field = container.querySelector<HTMLTextAreaElement>("[data-git-commit-message]");
    if (!field) throw new Error("Missing commit message");
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        field,
        message,
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return field;
  }

  function button(label: string) {
    const target = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!target) throw new Error(`Missing ${label} button`);
    return target;
  }

  return Object.assign(screen, {
    renderController,
    click,
    expectOpenChanges,
    openReview,
    openPreparedCommit,
    writeCommitMessage,
    button,
  });
}

describe("Git workbench direct entry", () => {
  it("opens Changes directly from the peek and preserves the mounted chat draft", async () => {
    await using fixture = await createControllerFixture();
    await fixture.renderController();
    const composer = fixture.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Chat composer"]',
    );
    expect(runtime.queries.some((query) => query.kind === "workbench")).toBe(false);

    await fixture.click('[data-workspace-card-peek="git"] [data-workspace-card-peek-trigger]');
    fixture.expectOpenChanges();
    expect(fixture.container.querySelector('[aria-label="Chat composer"]')).toBe(composer);
    expect(composer?.value).toBe("Draft");
    expect(runtime.actions.runOperation).not.toHaveBeenCalled();
    expect(runtime.actions.runWorkbenchOperation).not.toHaveBeenCalled();
  });

  it("keeps branch selection isolated from Git peek activation and retains its focus", async () => {
    await using fixture = await createControllerFixture();
    await fixture.renderController();
    const branch = fixture.container.querySelector<HTMLButtonElement>(
      '[aria-label="Choose branch"]',
    );
    if (!branch) throw new Error("Missing branch picker");
    branch.focus();
    await act(() => branch.click());

    expect(runtime.branchPicker).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(
      fixture.container.querySelector('[aria-label="Branch name"]'),
    );
    expect(
      fixture.container
        .querySelector("[data-chat-workspace-deck]")
        ?.getAttribute("data-active-card"),
    ).toBe("chat");
    expect(runtime.queries.some((query) => query.kind === "workbench")).toBe(false);
  });

  it("accepts only the active environment and repository and reopens Changes after another tab", async () => {
    await using fixture = await createControllerFixture();
    await fixture.renderController();
    expect(requestGitWorkbenchEntry({ cwd: "/other", environmentId })).toBe(false);
    expect(
      requestGitWorkbenchEntry({
        cwd: "/repo",
        environmentId: EnvironmentId.make("environment-2"),
      }),
    ).toBe(false);
    await act(() => {
      expect(requestGitWorkbenchEntry({ cwd: "/repo", environmentId, focusCommit: true })).toBe(
        true,
      );
    });
    fixture.expectOpenChanges();
    await fixture.click("[data-active-git-tab] button");
    expect(fixture.container.querySelector('[data-active-git-tab="overview"]')).not.toBeNull();

    await act(() => {
      expect(requestGitWorkbenchEntry({ cwd: "/repo", environmentId, focusCommit: true })).toBe(
        true,
      );
    });
    fixture.expectOpenChanges();
    expect(runtime.actions.runOperation).not.toHaveBeenCalled();
  });

  it.each([{ actionRequired: true }, { isRecording: true }])(
    "consumes blocked entry without opening a fallback or leaving chat: %j",
    async (overrides) => {
      await using fixture = await createControllerFixture();
      await fixture.renderController(overrides);
      await act(() => {
        expect(requestGitWorkbenchEntry({ cwd: "/repo", environmentId })).toBe(true);
      });
      await fixture.click('[data-workspace-card-peek="git"] [data-workspace-card-peek-trigger]');
      expect(
        fixture.container
          .querySelector("[data-chat-workspace-deck]")
          ?.getAttribute("data-active-card"),
      ).toBe("chat");
    },
  );

  it.each([
    { desktop: false },
    { deckEnabled: false },
    { gitEnabled: false },
    { workbenchSupported: false },
  ])("declines entry for unavailable workbenches: %j", async (availability) => {
    await using fixture = await createControllerFixture();
    if ("desktop" in availability) runtime.desktop = availability.desktop;
    if ("deckEnabled" in availability) runtime.deckEnabled = availability.deckEnabled;
    if ("gitEnabled" in availability) runtime.gitEnabled = availability.gitEnabled;
    await fixture.renderController("workbenchSupported" in availability ? availability : {});
    expect(requestGitWorkbenchEntry({ cwd: "/repo", environmentId, focusCommit: true })).toBe(
      false,
    );
  });

  it.each(["hidden-chat", "body", "removed-peek"])(
    "returns to the compact expand trigger when the entry origin is %s",
    async (origin) => {
      await using fixture = await createControllerFixture();
      await fixture.renderController();
      if (origin === "hidden-chat") {
        fixture.container
          .querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')
          ?.focus();
      }
      if (origin === "removed-peek") {
        const peek = fixture.container.querySelector<HTMLButtonElement>(
          '[data-workspace-card-peek="git"] [data-workspace-card-peek-trigger]',
        );
        peek?.focus();
        await fixture.click('[data-workspace-card-peek="git"] [data-workspace-card-peek-trigger]');
      } else {
        await act(() => {
          requestGitWorkbenchEntry({ cwd: "/repo", environmentId, focusCommit: true });
        });
      }

      await fixture.click(".git-workbench-drawer__collapse");

      await vi.waitFor(() =>
        expect(document.activeElement).toBe(
          fixture.container.querySelector('[aria-label="git.workbench.expand"]'),
        ),
      );
    },
  );

  it("falls back to Chat when the deck is disabled and restores its selected card when enabled", async () => {
    await using fixture = await createControllerFixture();
    runtime.deckEnabled = false;
    await fixture.renderController();
    expect(fixture.container.querySelector("[data-chat-workspace-deck]")).toBeNull();
    expect(fixture.container.querySelector('[aria-label="Chat composer"]')).not.toBeNull();
    expect(requestGitWorkbenchEntry({ environmentId, cwd: "/repo" })).toBe(false);

    runtime.deckEnabled = true;
    await fixture.renderController();
    await act(() => {
      expect(requestGitWorkbenchEntry({ environmentId, cwd: "/repo" })).toBe(true);
    });
    fixture.expectOpenChanges();

    runtime.deckEnabled = false;
    runtime.queries.length = 0;
    await fixture.renderController();
    expect(fixture.container.querySelector("[data-chat-workspace-deck]")).toBeNull();
    expect(fixture.container.querySelector('[aria-label="Chat composer"]')).not.toBeNull();
    expect(runtime.queries.some((query) => query.kind === "workbench")).toBe(false);
    expect(requestGitWorkbenchEntry({ environmentId, cwd: "/repo" })).toBe(false);

    runtime.deckEnabled = true;
    await fixture.renderController();
    expect(
      fixture.container
        .querySelector("[data-chat-workspace-deck]")
        ?.getAttribute("data-active-card"),
    ).toBe("git");
    expect(fixture.container.querySelector('[data-git-workbench-drawer="true"]')).toBeNull();
  });

  it("restores focus to a persistent entry trigger after collapsing", async () => {
    await using fixture = await createControllerFixture();
    await using origin = await render(<button type="button">Entry trigger</button>);
    const trigger = origin.container.querySelector("button")!;
    await fixture.renderController();
    trigger.focus();
    await act(() => {
      requestGitWorkbenchEntry({ cwd: "/repo", environmentId, focusCommit: true });
    });

    await fixture.click(".git-workbench-drawer__collapse");

    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

function SessionHarness({ scopeKey }: { scopeKey: string }) {
  const session = useGitWorkspaceDeckSession({
    activeTurn: false,
    cwd: "/repo",
    environmentId,
    scopeKey,
  });
  return (
    <>
      <output>
        {session.activeTab}:{session.commitFocusRequest}
      </output>
      <button type="button" onClick={() => session.openChanges({ focusCommit: true })}>
        Prepare commit
      </button>
      <button type="button" onClick={() => session.setActiveTab("overview")}>
        Overview
      </button>
    </>
  );
}

it("defaults and resets sessions to Changes and increments repeated commit focus requests", async () => {
  await using fixture = await createControllerFixture();
  await fixture.rerender(<SessionHarness scopeKey="first" />);
  expect(fixture.container.querySelector("output")?.textContent).toBe("changes:0");
  await fixture.click("button");
  await fixture.click("button");
  expect(fixture.container.querySelector("output")?.textContent).toBe("changes:2");
  await fixture.click("button:last-child");
  expect(fixture.container.querySelector("output")?.textContent).toBe("overview:2");

  await fixture.rerender(<SessionHarness scopeKey="second" />);
  expect(fixture.container.querySelector("output")?.textContent).toBe("changes:0");
});

const reviewFile: ContractSnapshot["files"][number] = {
  path: "src/app.ts",
  kind: "modified",
  indexStatus: "unmodified",
  worktreeStatus: "modified",
  staged: false,
  unstaged: true,
  untracked: false,
  conflicted: false,
  binary: false,
  submodule: false,
  modeChanged: false,
  stagedStats: { insertions: 0, deletions: 0, binary: false },
  unstagedStats: { insertions: 1, deletions: 1, binary: false },
};

function setReviewSnapshot(file: ContractSnapshot["files"][number], stateToken = "state-1") {
  runtime.data.set("workbench", {
    snapshot: {
      ...contractSnapshot,
      files: [file],
      stateToken,
      totals: {
        ...contractSnapshot.totals,
        staged: file.staged ? 1 : 0,
        unstaged: file.unstaged ? 1 : 0,
      },
    },
    queuedWorkflow: null,
    undoSnapshots: [],
  });
}

function setReadFile(path: string) {
  runtime.data.set("readFile", {
    relativePath: path,
    contents: "original",
    revision: "revision-1",
    byteLength: 8,
    truncated: false,
  });
}

describe("Git workbench review integration", () => {
  it("requests only a Diff on selection and reads a current file only after explicit Edit", async () => {
    await using fixture = await createControllerFixture();
    setReviewSnapshot(reviewFile);
    setReadFile(reviewFile.path);
    runtime.data.set("changesDiff", {
      path: reviewFile.path,
      source: "unstaged",
      stateToken: "state-1",
      patchId: "patch-1",
      hunks: [],
      truncated: false,
    });
    await fixture.openReview();
    await fixture.click("[data-review-select]");
    expect(runtime.queries.some((query) => query.kind === "changesDiff")).toBe(true);
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    expect(fixture.container.querySelector("[data-editor-path]")?.textContent).toBe("");

    await fixture.click("[data-review-edit]");
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(true);
    expect(fixture.container.querySelector("[data-editor-path]")?.textContent).toBe(
      reviewFile.path,
    );
    await fixture.click("[data-back-diff]");
    expect(fixture.container.querySelector("[data-editor-path]")?.textContent).toBe("");
    expect(fixture.container.querySelector("[data-selected-change]")?.textContent).toBe(
      "src/app.ts::worktree",
    );
  });

  it("preserves the path when staging removes the selected Diff source", async () => {
    await using fixture = await createControllerFixture();
    setReviewSnapshot({ ...reviewFile, staged: true, indexStatus: "modified" });
    await fixture.openReview();
    await fixture.click("[data-review-select]");
    expect(fixture.container.querySelector("[data-selected-change]")?.textContent).toBe(
      "src/app.ts::index",
    );
    setReviewSnapshot(reviewFile, "state-2");
    await fixture.renderController();
    expect(fixture.container.querySelector("[data-selected-change]")?.textContent).toBe(
      "src/app.ts::worktree",
    );
    expect(
      runtime.queries.some(
        (query) =>
          query.kind === "changesDiff" && (query.input as { source: string }).source === "unstaged",
      ),
    ).toBe(true);
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
  });

  it.each(["src/unchanged.ts", "missing-current-file"])(
    "opens the current version from History without an entry in Changes: %s",
    async (scenario) => {
      await using fixture = await createControllerFixture();
      if (scenario === "src/unchanged.ts") setReadFile("src/unchanged.ts");
      else runtime.errors.set("readFile", "Current file does not exist");
      await fixture.openReview();
      await fixture.click("[data-active-git-tab] button:nth-of-type(2)");
      await fixture.click("[data-history-current]");
      fixture.expectOpenChanges();
      expect(fixture.container.querySelector("[data-editor-path]")?.textContent).toBe(
        "src/unchanged.ts",
      );
      expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(true);
      expect(fixture.container.querySelector("[data-selected-change]")?.textContent).toBe("");
      expect(runtime.actions.saveCurrentFile).not.toHaveBeenCalled();
      if (scenario === "missing-current-file") {
        expect(fixture.container.querySelector("[data-file-error]")?.textContent).toBe(
          "Current file does not exist",
        );
      }
    },
  );

  it("guards dirty editor navigation and restores the captured draft after returning", async () => {
    await using fixture = await createControllerFixture();
    setReviewSnapshot(reviewFile);
    setReadFile(reviewFile.path);
    await fixture.openReview();
    await fixture.click("[data-review-edit]");
    await fixture.click("[data-type-file]");
    expect([...useGitFileDraftStore.getState().drafts.values()]).toMatchObject([
      { content: "typed edits" },
    ]);
    runtime.confirm.mockResolvedValueOnce(false);
    await act(async () => {
      fixture.container
        .querySelector<HTMLButtonElement>("[data-active-git-tab] button:nth-of-type(2)")!
        .click();
    });
    fixture.expectOpenChanges();
    expect(fixture.container.querySelector("[data-editor-path]")?.textContent).toBe(
      reviewFile.path,
    );

    runtime.queries.length = 0;
    await act(async () => {
      fixture.container
        .querySelector<HTMLButtonElement>("[data-active-git-tab] button:nth-of-type(2)")!
        .click();
    });
    expect(fixture.container.querySelector('[data-active-git-tab="history"]')).not.toBeNull();
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    expect([...useGitFileDraftStore.getState().drafts.values()]).toMatchObject([
      { content: "typed edits" },
    ]);
    await fixture.click("[data-go-changes]");
    expect([...useGitFileDraftStore.getState().drafts.values()]).toMatchObject([
      { content: "typed edits" },
    ]);
    expect(fixture.container.querySelector("[data-editor-path]")?.textContent).toBe(
      reviewFile.path,
    );
    expect(fixture.container.querySelector("[data-file-draft]")?.textContent).toBe("typed edits");
    expect(runtime.confirm).toHaveBeenCalledTimes(2);
  });

  it("keeps dirty edits when an action requires Chat and isolates a different environment", async () => {
    await using fixture = await createControllerFixture();
    setReviewSnapshot(reviewFile);
    setReadFile(reviewFile.path);
    await fixture.openReview();
    await fixture.click("[data-review-edit]");
    await fixture.click("[data-type-file]");
    await fixture.renderController({ actionRequired: true });
    expect(useGitFileDraftStore.getState().drafts.size).toBe(1);
    runtime.queries.length = 0;
    await fixture.renderController({ environmentId: EnvironmentId.make("environment-2") });
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    await act(() => {
      requestGitWorkbenchEntry({
        environmentId: EnvironmentId.make("environment-2"),
        cwd: "/repo",
      });
    });
    await fixture.click("[data-review-edit]");
    expect(fixture.container.querySelector("[data-file-draft]")?.textContent).toBe("");
    expect(useGitFileDraftStore.getState().drafts.size).toBe(1);
  });
});

describe("integrated Commit preparation", () => {
  it("retains nested branch field focus and text across repeated status renders", async () => {
    await using fixture = await createControllerFixture();
    await fixture.renderController();
    await fixture.click('[aria-label="Choose branch"]');
    const field = fixture.container.querySelector<HTMLInputElement>('[aria-label="Branch name"]');
    if (!field) throw new Error("Missing branch field");
    expect(document.activeElement).toBe(field);
    await act(() => {
      field.value = "feature/typed-branch";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (const aheadCount of [1, 2, 3]) {
      await fixture.renderController({ legacyStatus: { ...legacyStatus, aheadCount } });

      expect(document.activeElement).toBe(field);
      expect(field.value).toBe("feature/typed-branch");
    }
    expect(fixture.container.querySelector('[data-git-workbench-drawer="true"]')).toBeNull();
    expect(runtime.branchPicker).toHaveBeenCalledTimes(1);
  });

  it("focuses preparation through the deck and preserves typed input across status renders", async () => {
    await using fixture = await createControllerFixture();
    await fixture.openPreparedCommit();

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        fixture.container.querySelector('[data-git-commit-mode="automatic"]'),
      ),
    );
    const field = await fixture.writeCommitMessage("Keep the exact message");
    field.focus();
    const before = document.activeElement;
    setReviewSnapshot({ ...reviewFile, staged: true, indexStatus: "modified" }, "next-state");
    await fixture.renderController();

    expect(document.activeElement).toBe(before);
    expect(field.value).toBe("Keep the exact message");
    await act(() => {
      requestGitWorkbenchEntry({ environmentId, cwd: "/repo", focusCommit: true });
    });
    expect(document.activeElement).toBe(field);
    expect(runtime.actions.runWorkbenchOperation).not.toHaveBeenCalled();
  });

  it("queues the real staged index and verbatim manual message once after an agent turn", async () => {
    await using fixture = await createControllerFixture();
    await fixture.openPreparedCommit(true);
    const snapshot = (runtime.data.get("workbench") as { snapshot: ContractSnapshot }).snapshot;
    runtime.actions.refreshWorkbench.mockResolvedValue({ _tag: "Success", value: snapshot });
    runtime.actions.upsertQueue.mockResolvedValue({ _tag: "Success", value: {} });
    const message = await fixture.writeCommitMessage("  Preserve this message\nwith details  ");
    await act(async () => {
      const button = fixture.container.querySelector<HTMLButtonElement>(
        '[data-git-commit-action="queue"]',
      );
      button?.click();
      button?.click();
    });
    expect(runtime.actions.upsertQueue).toHaveBeenCalledTimes(1);
    expect(runtime.actions.upsertQueue).toHaveBeenCalledWith({
      environmentId,
      input: {
        cwd: "/repo",
        expectedStateToken: "state-1",
        threadId: ThreadId.make("thread-1"),
        plan: {
          kind: "delivery",
          stage: { mode: "staged" },
          commitMessage: "  Preserve this message\nwith details  ",
          push: false,
          createPullRequest: false,
        },
      },
    });
    expect(message.value).toBe("  Preserve this message\nwith details  ");
    expect(fixture.container.textContent).toContain("git.commit.queued");
  });

  it("stops queue preparation after a changed snapshot without submitting a workflow", async () => {
    await using fixture = await createControllerFixture();
    await fixture.openPreparedCommit(true);
    runtime.actions.refreshWorkbench.mockResolvedValue({
      _tag: "Success",
      value: { ...contractSnapshot, stateToken: "external-change" },
    });
    await fixture.click('[data-git-commit-action="queue"]');
    expect(runtime.actions.upsertQueue).not.toHaveBeenCalled();
    expect(fixture.container.querySelector('[role="alert"]')?.textContent).toBe(
      "git.changes.stagingStateChanged",
    );
  });

  it("retains a failed queued message for retry", async () => {
    await using fixture = await createControllerFixture();
    await fixture.openPreparedCommit(true);
    const snapshot = (runtime.data.get("workbench") as { snapshot: ContractSnapshot }).snapshot;
    runtime.actions.refreshWorkbench.mockResolvedValue({ _tag: "Success", value: snapshot });
    runtime.actions.upsertQueue
      .mockRejectedValueOnce(new Error("Queue rejected"))
      .mockResolvedValueOnce({ _tag: "Success", value: {} });
    const field = await fixture.writeCommitMessage("Retry this commit");
    await fixture.click('[data-git-commit-action="queue"]');
    expect(fixture.container.querySelector('[role="alert"]')?.textContent).toBe("Queue rejected");
    expect(field.value).toBe("Retry this commit");
    await fixture.click('[data-git-commit-action="queue"]');
    expect(runtime.actions.upsertQueue).toHaveBeenCalledTimes(2);
    expect(fixture.container.textContent).toContain("git.commit.queued");
    expect(field.value).toBe("Retry this commit");
  });

  it("cancels refreshed queue preparation after an environment switch", async () => {
    await using fixture = await createControllerFixture();
    await fixture.openPreparedCommit(true);
    const snapshot = (runtime.data.get("workbench") as { snapshot: ContractSnapshot }).snapshot;
    let resolveRefresh:
      | ((result: { _tag: "Success"; value: ContractSnapshot }) => void)
      | undefined;
    runtime.actions.refreshWorkbench.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    await fixture.writeCommitMessage("Environment A");
    await fixture.click('[data-git-commit-action="queue"]');
    await fixture.renderController({
      activeTurn: true,
      environmentId: EnvironmentId.make("environment-2"),
    });
    await act(async () => resolveRefresh?.({ _tag: "Success", value: snapshot }));
    expect(runtime.actions.upsertQueue).not.toHaveBeenCalled();
    await fixture.renderController({ activeTurn: true });
    await act(() => requestGitWorkbenchEntry({ environmentId, cwd: "/repo", focusCommit: true }));
    expect(
      fixture.container.querySelector<HTMLTextAreaElement>("[data-git-commit-message]")?.value,
    ).toBe("Environment A");
  });

  it.each([
    { status: "completed", disabled: false },
    { status: "cancelled", disabled: false },
    { status: "failed", disabled: true },
    { status: "waiting_for_turn", disabled: true },
    { status: "needs_review", disabled: true },
  ] as const)("honors the mapped workflow lifecycle: $status", async ({ status, disabled }) => {
    await using fixture = await createControllerFixture();
    await fixture.openPreparedCommit();
    const projection = runtime.data.get("workbench") as { snapshot: ContractSnapshot };
    runtime.data.set("workbench", {
      ...projection,
      undoSnapshots: [],
      queuedWorkflow: {
        id: "workflow-1",
        cwd: "/repo",
        revision: 1,
        threadId: ThreadId.make("thread-1"),
        status,
        expectedStateToken: "state-1",
        plan: {
          kind: "delivery",
          stage: { mode: "staged" },
          push: false,
          createPullRequest: false,
        },
        needsReviewReasons: [],
        createdAt: "2026-10-17T10:00:00.000Z",
        updatedAt: "2026-10-17T10:00:00.000Z",
      },
    });
    await fixture.renderController();
    expect(
      fixture.container.querySelector<HTMLButtonElement>('[data-git-commit-action="commit"]')
        ?.disabled,
    ).toBe(disabled);
  });

  it("keeps Commit disabled when the index is empty or write access is absent", async () => {
    await using fixture = await createControllerFixture();
    await fixture.renderController();
    await act(() => requestGitWorkbenchEntry({ environmentId, cwd: "/repo", focusCommit: true }));
    expect(
      fixture.container.querySelector<HTMLButtonElement>('[data-git-commit-action="commit"]')
        ?.disabled,
    ).toBe(true);
    setReviewSnapshot({ ...reviewFile, staged: true, indexStatus: "modified" });
    await fixture.renderController();
    expect(
      fixture.container.querySelector<HTMLButtonElement>('[data-git-commit-action="commit"]')
        ?.disabled,
    ).toBe(false);
    runtime.data.set("sessionAccess", { scopes: [] });
    await fixture.renderController();
    expect(
      fixture.container.querySelector<HTMLButtonElement>('[data-git-commit-action="commit"]')
        ?.disabled,
    ).toBe(true);
    expect(runtime.actions.upsertQueue).not.toHaveBeenCalled();
  });
});

describe("Workbench query activation", () => {
  it("loads statistics only in Repository and current text only while its editor is visible", async () => {
    await using fixture = await createControllerFixture();
    setReviewSnapshot(reviewFile);
    setReadFile(reviewFile.path);
    await fixture.openReview();
    expect(runtime.queries.some((query) => query.kind === "insights")).toBe(false);
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    await fixture.click('[role="tab"][id$="-tab-overview"]');
    expect(runtime.queries.some((query) => query.kind === "insights")).toBe(true);
    runtime.queries.length = 0;
    await fixture.click('[role="tab"][id$="-tab-changes"]');
    expect(runtime.queries.some((query) => query.kind === "insights")).toBe(false);
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    await fixture.click("[data-review-edit]");
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(true);
    await fixture.click('[role="tab"][id$="-tab-history"]');
    runtime.queries.length = 0;
    await fixture.renderController();
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    expect(runtime.queries.some((query) => query.kind === "insights")).toBe(false);
  });

  it("keeps Advanced reachable and loads its target refs without loading statistics or the editor", async () => {
    await using fixture = await createControllerFixture();
    await fixture.openReview();
    runtime.queries.length = 0;
    await fixture.click('[role="tab"][id$="-tab-operations"]');
    expect(
      fixture.container.querySelector("[data-active-git-tab]")?.getAttribute("data-active-git-tab"),
    ).toBe("operations");
    expect(runtime.queries.some((query) => query.kind === "listRefs")).toBe(true);
    expect(runtime.queries.some((query) => query.kind === "insights")).toBe(false);
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    expect(runtime.queries.some((query) => query.kind === "interactiveRebasePlan")).toBe(false);
  });
});

describe("integrated conflict resolution", () => {
  it("keeps Continue blocked through editing and staging until refreshed conflict resolution", async () => {
    await using fixture = await createControllerFixture();
    runtime.realPanel = true;
    const conflicted: ContractSnapshot = {
      ...contractSnapshot,
      operation: { kind: "rebase", conflictingPaths: [] },
      files: [
        {
          ...reviewFile,
          kind: "conflicted",
          indexStatus: "conflicted",
          worktreeStatus: "conflicted",
          conflicted: true,
        },
      ],
      totals: { ...contractSnapshot.totals, conflicted: 1, unstaged: 1 },
    };
    runtime.data.set("workbench", {
      snapshot: conflicted,
      queuedWorkflow: null,
      undoSnapshots: [],
    });
    runtime.data.set("changesDiff", {
      path: reviewFile.path,
      source: "unstaged",
      stateToken: "state-1",
      patchId: "conflict-patch",
      hunks: [],
      truncated: false,
    });
    setReadFile(reviewFile.path);
    await fixture.openReview();
    expect(fixture.button("git.common.continue").disabled).toBe(true);
    const conflictChoice = fixture.container.querySelector<HTMLSelectElement>(
      "[data-git-operation-banner] select",
    );
    if (!conflictChoice) throw new Error("Missing conflict navigation");
    await act(() => {
      conflictChoice.value = reviewFile.path;
      conflictChoice.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(runtime.queries.some((query) => query.kind === "changesDiff")).toBe(true);
    expect(runtime.queries.some((query) => query.kind === "readFile")).toBe(false);
    await act(() => fixture.button("git.common.edit").click());
    const field = fixture.container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="git.file.editAria"]',
    );
    if (!field) throw new Error("Missing explicit current file editor");
    expect(field.readOnly).toBe(false);
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        field,
        "resolved contents",
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => fixture.button("git.file.save").click());
    expect(runtime.actions.saveCurrentFile).toHaveBeenCalledWith({
      path: reviewFile.path,
      content: "resolved contents",
      expectedRevision: "revision-1",
    });
    runtime.data.set("readFile", {
      relativePath: reviewFile.path,
      contents: "resolved contents",
      revision: "revision-2",
      byteLength: 17,
      truncated: false,
    });
    await fixture.renderController();
    expect(fixture.button("git.common.continue").disabled).toBe(true);
    await act(() => fixture.button("git.changes.backToDiff").click());
    await act(() => fixture.button("git.changes.markResolved").click());
    expect(runtime.actions.applyChangeSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "stage",
        path: reviewFile.path,
        expectedPatchId: "conflict-patch",
        expectedStateToken: "state-1",
        source: "worktree",
      }),
    );
    expect(fixture.button("git.common.continue").disabled).toBe(true);
    const resolved: ContractSnapshot = {
      ...conflicted,
      stateToken: "resolved-state",
      files: [
        {
          ...reviewFile,
          staged: true,
          unstaged: false,
          indexStatus: "modified",
          worktreeStatus: "unmodified",
        },
      ],
      totals: { ...contractSnapshot.totals, staged: 1 },
    };
    runtime.data.set("workbench", { snapshot: resolved, queuedWorkflow: null, undoSnapshots: [] });
    runtime.data.set("changesDiff", {
      path: reviewFile.path,
      source: "staged",
      stateToken: "resolved-state",
      patchId: "resolved-patch",
      hunks: [],
      truncated: false,
    });
    await fixture.renderController();
    expect(fixture.button("git.common.continue").disabled).toBe(false);
    await act(() => fixture.button("git.common.continue").click());
    expect(runtime.actions.runWorkbenchOperation).toHaveBeenCalledWith({ kind: "continue" });
  });
});
