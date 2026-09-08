import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createElement, type ComponentProps, type ReactNode, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const rendered = vi.hoisted(() => ({
  compactCard: null as Record<string, unknown> | null,
  deck: null as Record<string, unknown> | null,
  drawer: null as Record<string, unknown> | null,
  mcpProvider: null as Record<string, unknown> | null,
}));

vi.mock("./GitCompactCard", async () => {
  const { createElement } = await import("react");
  return {
    GitCompactCard: (props: Record<string, unknown>) => {
      rendered.compactCard = props;
      return createElement(
        "article",
        { "data-compact-git-card": "true" },
        props.workbench as ReactNode,
      );
    },
  };
});

vi.mock("./GitWorkbenchDrawerShell", async () => {
  const { createElement } = await import("react");
  return {
    GitWorkbenchDrawerShell: (props: Record<string, unknown>) => {
      rendered.drawer = props;
      return createElement(
        "section",
        {
          className: props.className,
          "data-workspace-card-expanded-surface": "true",
        },
        props.children as ReactNode,
      );
    },
  };
});

vi.mock("./ChatWorkspaceDeck", async () => {
  const { createElement } = await import("react");
  return {
    ChatWorkspaceDeck: (props: Record<string, unknown>) => {
      rendered.deck = props;
      return createElement("div", { "data-chat-workspace-deck": "true" });
    },
  };
});

vi.mock("../mcp-workspace/McpWorkspaceController", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    McpWorkspaceRuntimeProvider: (props: Record<string, unknown>) => {
      rendered.mcpProvider = props;
      return createElement(Fragment, null, props.children as ReactNode);
    },
  };
});

import type { GitWorkspaceDeckControllerProps } from "./GitWorkspaceDeckController.model";
import {
  GitWorkspaceDeckGitCard,
  GitWorkspaceDeckPresentation,
  type GitWorkspaceDeckPresentationProps,
} from "./GitWorkspaceDeckController.presentation";

const status = {
  kind: "changed" as const,
  label: "Changed",
  branch: "main",
  changeCount: 1,
  staged: 1,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
  additions: 2,
  deletions: 1,
  ahead: 0,
  behind: 0,
  updatedAtLabel: "Updated now",
};

function controllerFixture(input?: {
  readonly dismissTransientUi?: () => void;
  readonly focusAtEnd?: () => void;
  readonly renderChat?: GitWorkspaceDeckControllerProps["renderChat"];
}): GitWorkspaceDeckControllerProps {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    cwd: "/repo",
    threadId: ThreadId.make("thread-1"),
    turnId: null,
    workbenchSupported: true,
    legacyStatus: null,
    legacyStatusPending: false,
    actionRequired: false,
    activeTurn: false,
    isRecording: false,
    composerRef: {
      current: {
        dismissTransientUi: input?.dismissTransientUi ?? vi.fn(),
        focusAtEnd: input?.focusAtEnd ?? vi.fn(),
      },
    } as unknown as GitWorkspaceDeckControllerProps["composerRef"],
    mcpAuthorizationAvailable: true,
    mcpConfiguredServers: [],
    mcpProviderDisplayName: "Codex",
    mcpProviderDriver: null,
    mcpProviderInstanceId: null,
    mcpProviders: [],
    mcpRuntimeSessionId: null,
    mcpWorkspaceSupported: true,
    renderChat:
      input?.renderChat ??
      ((controls) =>
        createElement("span", null, `${controls.deckEnabled}:${controls.gitAvailable}`)),
    renderGitPeek: () => null,
    onOpenFile: vi.fn(),
    onNonChatActiveChange: vi.fn(),
    onExpandedChange: vi.fn(),
  };
}

function presentationFixture(
  controller: GitWorkspaceDeckControllerProps,
  overrides?: Partial<GitWorkspaceDeckPresentationProps>,
): GitWorkspaceDeckPresentationProps {
  return {
    actionRequired: controller.actionRequired,
    activeCard: "chat",
    cards: [],
    deckEnabled: true,
    expandedCard: null,
    fallback: controller.renderChat({ deckEnabled: false, gitAvailable: false }),
    isDesktop: true,
    isRecording: controller.isRecording,
    mcpExpanded: false,
    mcpRuntime: controller,
    onActiveCardChange: vi.fn(),
    onBeforeHideChat: () => controller.composerRef.current?.dismissTransientUi(),
    onCardSelectionBlocked: vi.fn(),
    onExpandedCardChange: vi.fn(),
    onRestoreChatFocus: () => controller.composerRef.current?.focusAtEnd(),
    resetKey: "scope",
    ...overrides,
  };
}

describe("Git workspace deck presentation integration", () => {
  beforeEach(() => {
    rendered.compactCard = null;
    rendered.deck = null;
    rendered.drawer = null;
    rendered.mcpProvider = null;
  });

  it.each([
    { deckEnabled: false, isDesktop: true },
    { deckEnabled: true, isDesktop: false },
  ])("falls back to plain Chat when the desktop deck is unavailable", (availability) => {
    const renderChat = vi.fn<GitWorkspaceDeckControllerProps["renderChat"]>((controls) =>
      createElement("span", null, `${controls.deckEnabled}:${controls.gitAvailable}`),
    );

    const controller = controllerFixture({ renderChat });
    const markup = renderToStaticMarkup(
      createElement(GitWorkspaceDeckPresentation, presentationFixture(controller, availability)),
    );

    expect(markup).toContain("false:false");
    expect(renderChat).toHaveBeenCalledWith({ deckEnabled: false, gitAvailable: false });
    expect(rendered.deck).toBeNull();
  });

  it("forwards deck and MCP runtime state and restores composer focus through the controller", () => {
    const dismissTransientUi = vi.fn();
    const focusAtEnd = vi.fn();
    const controller = controllerFixture({ dismissTransientUi, focusAtEnd });
    const onActiveCardChange = vi.fn();
    const onExpandedCardChange = vi.fn();

    renderToStaticMarkup(
      createElement(
        GitWorkspaceDeckPresentation,
        presentationFixture(controller, {
          activeCard: "mcp",
          expandedCard: "mcp",
          mcpExpanded: true,
          onActiveCardChange,
          onExpandedCardChange,
        }),
      ),
    );

    expect(rendered.mcpProvider).toMatchObject({
      active: true,
      environmentId: controller.environmentId,
      expanded: true,
      projectCwd: controller.cwd,
      threadId: controller.threadId,
    });
    expect(rendered.deck).toMatchObject({
      activeCard: "mcp",
      expandedCard: "mcp",
      onActiveCardChange,
      onExpandedCardChange,
      resetKey: "scope",
    });
    (rendered.deck?.onBeforeHideChat as (() => void) | undefined)?.();
    (rendered.deck?.onRestoreChatFocus as (() => void) | undefined)?.();
    expect(dismissTransientUi).toHaveBeenCalledOnce();
    expect(focusAtEnd).toHaveBeenCalledOnce();
  });

  it("keeps expanded Git content embedded and returns focus to the compact trigger", () => {
    const expandButtonRef = { current: null } as RefObject<HTMLButtonElement | null>;
    const onExpand = vi.fn();
    const onExpandedChange = vi.fn();
    const onActiveTabChange = vi.fn();

    const markup = renderToStaticMarkup(
      createElement(GitWorkspaceDeckGitCard, {
        activeTab: "overview",
        blocked: false,
        expanded: true,
        expandButtonRef,
        lastCommit: null,
        onActiveTabChange,
        onExpand,
        onExpandedChange,
        panel: createElement("div", null, "Panel content"),
        quickAction: null,
        repositoryLabel: "/repo",
        showOperationsTab: true,
        status,
      } satisfies ComponentProps<typeof GitWorkspaceDeckGitCard>),
    );

    expect(markup).toContain('data-workspace-card-expanded-surface="true"');
    expect(markup).toContain("Panel content");
    expect(rendered.compactCard).toMatchObject({
      expanded: true,
      expandButtonRef,
      onExpand,
      status,
    });
    expect(rendered.drawer).toMatchObject({
      activeTab: "overview",
      className: "workspace-card-deck__card-content git-workbench-drawer--embedded",
      onActiveTabChange,
      onOpenChange: onExpandedChange,
      open: true,
      repositoryLabel: "/repo",
      returnFocusRef: expandButtonRef,
      showOperationsTab: true,
    });
  });
});
