import type {
  HarnessChatSummary,
  HarnessChatSyncRunResult,
  HarnessChatSyncSource,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { createDefaultHarnessChatSelection } from "./HarnessChatSyncSettings.logic";
import {
  HarnessChatSyncEnvironmentView,
  HARNESS_CHAT_PAGE_SIZE,
  HarnessChatSyncSourceTabs,
  HarnessChatSyncSourceView,
  MissingProjectResolverContent,
  supportsHarnessChatSync,
} from "./HarnessChatSyncSettings";

const supportedSource = {
  id: "codex-home",
  continuationKey: "codex:/home/alex/.codex",
  label: "Work Codex",
  driver: "codex",
  instanceIds: ["codex_work"],
  preferredInstanceId: "codex_work",
  status: { kind: "supported", supportsActivityStatus: true },
  chatCount: 18,
  changedCount: 2,
  latestUpdatedAt: "2026-08-22T19:00:00.000Z",
} as unknown as HarnessChatSyncSource;

const activeLinkedChat = {
  sessionId: "session-1",
  title: "Ship release",
  preview: "Prepare the release notes",
  cwd: "/workspace/t3-code",
  model: "gpt-5.6",
  updatedAt: "2026-08-22T19:00:00.000Z",
  archived: false,
  messageCount: 8,
  hasChanges: true,
  activity: "active",
  targetProject: { kind: "existing", projectId: "project-1" },
  link: {
    sourceId: "codex-home",
    nativeSessionId: "session-1",
    threadId: "thread-1",
    projectId: "project-1",
    providerInstanceId: "codex_work",
    providerLabel: "Work Codex",
    activity: "active",
    sourceUpdatedAt: "2026-08-22T19:00:00.000Z",
    lastSyncedAt: "2026-08-22T19:01:00.000Z",
  },
} as unknown as HarnessChatSummary;

const partialResult = {
  selectedCount: 2,
  syncedCount: 1,
  failedCount: 1,
  threadsCreated: 1,
  threadsUpdated: 0,
  messagesImported: 8,
  attachmentsImported: 0,
  attachmentsSkipped: 0,
  items: [],
  failures: [
    {
      sessionId: "session-2",
      code: "target-unresolved",
      message: "Choose a project before syncing this chat.",
      retryable: true,
    },
  ],
} as unknown as HarnessChatSyncRunResult;

const handlers = {
  onArchiveChange: vi.fn(),
  onClearAll: vi.fn(),
  onLoadMore: vi.fn(),
  onRefresh: vi.fn(),
  onSearchChange: vi.fn(),
  onSelectAll: vi.fn(),
  onSelectionChange: vi.fn(),
  onSync: vi.fn(),
};

describe("HarnessChatSyncSourceView", () => {
  it("loads provider chats in groups of ten", () => {
    expect(HARNESS_CHAT_PAGE_SIZE).toBe(10);
  });

  it("hides the feature for older environments and accepts version 1 or newer", () => {
    expect(supportsHarnessChatSync(undefined)).toBe(false);
    expect(supportsHarnessChatSync({ environment: { capabilities: {} } } as never)).toBe(false);
    expect(
      supportsHarnessChatSync({
        environment: { capabilities: { harnessChatSyncVersion: 1 } },
      } as never),
    ).toBe(true);
  });

  it("renders provider search, persistent selection controls, linked activity, pagination, and partial results", () => {
    const markup = renderToStaticMarkup(
      <HarnessChatSyncSourceView
        {...handlers}
        source={supportedSource}
        chats={[activeLinkedChat]}
        selection={createDefaultHarnessChatSelection()}
        searchQuery="release"
        includeArchived={false}
        totalMatching={18}
        changedMatching={2}
        countsAreComplete={false}
        hasNextPage
        isLoading={false}
        isFetching={false}
        isSyncing={false}
        result={partialResult}
        errorMessage={null}
      />,
    );

    expect(markup).toContain("Work Codex");
    expect(markup).toContain('placeholder="Search provider chats"');
    expect(markup).toContain("Include archived");
    expect(markup).toContain("Select all");
    expect(markup).toContain("Clear all");
    expect(markup).toContain("Active elsewhere");
    expect(markup).toContain("Linked");
    expect(markup).toContain("T3 thread thread-1");
    expect(markup).toContain("Updates available");
    expect(markup).toContain("All matching selected");
    expect(markup).toContain("1 shown · more available");
    expect(markup).toContain("View more");
    expect(markup).toContain("Sync selected");
    expect(markup).toContain("Synced 1 of 2 chats");
    expect(markup).toContain("Choose a project before syncing this chat.");
  });

  it("renders provider tabs as a responsive two-dimensional grid", () => {
    const openCode = {
      ...supportedSource,
      id: "opencode-home",
      continuationKey: "opencode:/home/alex/.local/share/opencode",
      label: "OpenCode",
      driver: "opencode",
    } as HarnessChatSyncSource;
    const markup = renderToStaticMarkup(
      <HarnessChatSyncSourceTabs
        sources={[supportedSource, openCode]}
        activeSourceId={openCode.id}
        onSourceChange={vi.fn()}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="false"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))]");
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).toContain("Work Codex");
    expect(markup).toContain("OpenCode");
  });

  it("explains unavailable and already-local sources without offering a sync action", () => {
    const unsupportedMarkup = renderToStaticMarkup(
      <HarnessChatSyncSourceView
        {...handlers}
        source={{
          ...supportedSource,
          label: "Cursor",
          status: { kind: "unsupported", reason: "This ACP agent cannot list sessions." },
        }}
        chats={[]}
        selection={createDefaultHarnessChatSelection()}
        searchQuery=""
        includeArchived={false}
        totalMatching={0}
        changedMatching={0}
        hasNextPage={false}
        isLoading={false}
        isFetching={false}
        isSyncing={false}
        result={null}
        errorMessage={null}
      />,
    );
    const localMarkup = renderToStaticMarkup(
      <HarnessChatSyncSourceView
        {...handlers}
        source={{
          ...supportedSource,
          label: "Gemini",
          status: { kind: "already-local", reason: "Gemini chats already live in T3 Code." },
        }}
        chats={[]}
        selection={createDefaultHarnessChatSelection()}
        searchQuery=""
        includeArchived={false}
        totalMatching={0}
        changedMatching={0}
        hasNextPage={false}
        isLoading={false}
        isFetching={false}
        isSyncing={false}
        result={null}
        errorMessage={null}
      />,
    );

    expect(unsupportedMarkup).toContain("Unavailable");
    expect(unsupportedMarkup).toContain("This ACP agent cannot list sessions.");
    expect(unsupportedMarkup).not.toContain("Sync selected");
    expect(localMarkup).toContain("Already in T3 Code");
    expect(localMarkup).toContain("Gemini chats already live in T3 Code.");
    expect(localMarkup).not.toContain("Sync selected");
  });

  it("groups provider sources below their connected environment", () => {
    const markup = renderToStaticMarkup(
      <HarnessChatSyncEnvironmentView
        label="Build server"
        detail="SSH"
        isRefreshing={false}
        onRefresh={vi.fn()}
      >
        <div>Work Codex</div>
        <div>OpenCode</div>
      </HarnessChatSyncEnvironmentView>,
    );

    expect(markup).toContain("Build server");
    expect(markup).toContain("SSH");
    expect(markup.indexOf("Build server")).toBeLessThan(markup.indexOf("Work Codex"));
    expect(markup.indexOf("Build server")).toBeLessThan(markup.indexOf("OpenCode"));
  });

  it("offers one environment project for all chats with a missing working directory", () => {
    const markup = renderToStaticMarkup(
      <MissingProjectResolverContent
        unresolvedCount={3}
        projects={[
          {
            id: "project-1" as never,
            title: "T3 Code",
            workspaceRoot: "/workspace/t3-code",
          },
        ]}
        selectedProjectId={null}
        onProjectChange={vi.fn()}
      />,
    );

    expect(markup).toContain("3 selected chats have no usable working directory");
    expect(markup).toContain("Use one T3 Code project for all unresolved chats");
    expect(markup).toContain("T3 Code — /workspace/t3-code");
  });
});
