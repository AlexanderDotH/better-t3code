import { describe, expect, it } from "vite-plus/test";

import branchToolbarSource from "../BranchToolbar.tsx?raw";
import branchSelectorSource from "../BranchToolbarBranchSelector.tsx?raw";
import environmentSelectorSource from "../BranchToolbarEnvironmentSelector.tsx?raw";
import envModeSelectorSource from "../BranchToolbarEnvModeSelector.tsx?raw";
import chatViewSource from "../ChatView.tsx?raw";
import compactCardSource from "./GitCompactCard.tsx?raw";
import deckControllerSource from "./GitWorkspaceDeckController.tsx?raw";
import drawerShellSource from "./GitWorkbenchDrawerShell.tsx?raw";
import changesIndicatorSource from "./GitWorkspaceChangesIndicator.tsx?raw";

describe("Git workspace deck surface integration", () => {
  it("renders the repository context strip as a mirrored previous or next card peek", () => {
    expect(branchToolbarSource).toContain('orientation?: "previous" | "next"');
    expect(branchToolbarSource).toContain("data-workspace-card-peek-position={orientation}");
    expect(branchToolbarSource).toContain("chat-composer-context-strip--previous");
    expect(branchToolbarSource).toContain("chat-composer-context-strip--next");
  });

  it("splits the composer body from the Git peek without changing selector hit targets", () => {
    const renderChatIndex = chatViewSource.indexOf("renderChat=");
    const renderGitPeekIndex = chatViewSource.indexOf("renderGitPeek=", renderChatIndex);
    const branchToolbarIndex = chatViewSource.indexOf(
      "renderComposerContextStrip(",
      renderGitPeekIndex,
    );

    expect(renderChatIndex).toBeGreaterThan(-1);
    expect(renderGitPeekIndex).toBeGreaterThan(renderChatIndex);
    expect(branchToolbarIndex).toBeGreaterThan(renderGitPeekIndex);
    expect(chatViewSource).toContain('cardPeek ? "pointer-events-none" : "pointer-events-auto"');
    expect(chatViewSource).toMatch(/renderComposerContextStrip\([\s\S]*?position,[\s\S]*?true,/);
    expect(environmentSelectorSource).toContain('data-git-workspace-context-control="true"');
    expect(envModeSelectorSource).toContain('data-git-workspace-context-control="true"');
    expect(branchSelectorSource.match(/data-git-workspace-context-control="true"/g)).toHaveLength(
      2,
    );
  });

  it("waits for confirmed Git status before rendering repository context", () => {
    expect(chatViewSource).toContain("const isGitRepo = gitStatusQuery.data?.isRepo === true;");
    expect(chatViewSource).not.toContain("gitStatusQuery.data?.isRepo ?? true");
  });

  it("tracks every non-Chat card so type-anywhere never steals focus from the deck", () => {
    expect(chatViewSource).toContain("nonChatWorkspaceCardActive");
    expect(chatViewSource).not.toContain("gitWorkbenchFrontmost");
    expect(chatViewSource).toContain("onNonChatActiveChange={setNonChatWorkspaceCardActive}");
  });

  it("batches composer overlay measurements into animation frames", () => {
    expect(chatViewSource).toContain("composerOverlayResizeFrameRef");
    expect(chatViewSource).toMatch(/new ResizeObserver\(scheduleComposerOverlayMeasurement\)/);
    expect(chatViewSource).toContain(
      "window.cancelAnimationFrame(composerOverlayResizeFrameRef.current)",
    );
  });

  it("keeps the composer glass outside the fading foreground layer", () => {
    const glassHostIndex = chatViewSource.indexOf('"chat-composer-glass-host relative z-10');
    const contentIndex = chatViewSource.indexOf(
      'className="workspace-card-deck__card-content relative z-10"',
      glassHostIndex,
    );

    expect(glassHostIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(glassHostIndex);
    expect(chatViewSource).toContain('deckEnabled && "h-full"');
  });

  it("keeps the context-strip chrome outside its fading controls", () => {
    expect(branchToolbarSource).toContain("chat-composer-context-strip");
    expect(branchToolbarSource).toContain("mx-auto");
    expect(branchToolbarSource).not.toContain("workspace-card-deck__card-content");
    expect(branchToolbarSource).not.toContain("git-workspace-deck__card-content");
  });

  it("lets the card trigger own static lookout content without stealing real selectors", () => {
    expect(branchToolbarSource).toContain('className="flex min-w-0 flex-1 items-center gap-1"');
    expect(branchToolbarSource).not.toContain('className="relative z-10 flex min-w-0 flex-1');
    expect(branchToolbarSource).toContain(
      'className="min-w-0 flex-1 justify-end md:ml-auto md:flex-none"',
    );
    expect(branchToolbarSource).not.toContain(
      'className="relative z-10 min-w-0 flex-1 justify-end md:ml-auto md:flex-none"',
    );
    expect(environmentSelectorSource).toContain('data-git-workspace-context-control="true"');
    expect(envModeSelectorSource).toContain('data-git-workspace-context-control="true"');
    expect(branchSelectorSource.match(/data-git-workspace-context-control="true"/g)).toHaveLength(
      2,
    );
    expect(branchSelectorSource).toContain("max-w-[180px]");
    expect(branchSelectorSource).not.toContain("max-w-[240px]");
    expect(changesIndicatorSource).not.toContain("<button");
    expect(changesIndicatorSource).not.toContain("onOpen");
  });

  it("embeds the expanded workbench inside the centered Git card instead of a portal", () => {
    const centeredCardIndex = chatViewSource.indexOf('"relative mx-auto w-full max-w-3xl"');
    const controllerIndex = chatViewSource.indexOf(
      "<ChatWorkspaceDeckController",
      centeredCardIndex,
    );

    expect(deckControllerSource).not.toContain('from "react-dom"');
    expect(deckControllerSource).not.toContain("createPortal(");
    expect(deckControllerSource).not.toContain("drawerHost");
    expect(deckControllerSource).toContain("workbench={");
    expect(deckControllerSource).toContain(
      'className="workspace-card-deck__card-content git-workbench-drawer--embedded"',
    );
    expect(chatViewSource).not.toContain("data-git-workbench-drawer-host");
    expect(centeredCardIndex).toBeGreaterThan(-1);
    expect(controllerIndex).toBeGreaterThan(centeredCardIndex);
  });

  it("content-sizes Git without retaining manual drawer height state", () => {
    expect(drawerShellSource).toContain('sizingMode="content"');
    expect(drawerShellSource).not.toContain("DRAWER_HEIGHT_STORAGE_KEY");
    expect(drawerShellSource).not.toContain("DRAWER_DEFAULT_MAX_HEIGHT");
    expect(drawerShellSource).not.toContain('resizeLabel="Resize Git workbench vertically"');
    expect(drawerShellSource).toContain('"data-workspace-card-expanded-surface": "true"');
    expect(deckControllerSource).not.toContain("onDrawerHeightChange");
  });

  it("reserves the measured expanded card height without blocking the full chat width", () => {
    expect(chatViewSource).not.toContain('workspaceCardExpanded && "invisible"');
    expect(chatViewSource).toContain("isDraftHeroState && !workspaceCardExpanded");
    expect(chatViewSource).toContain('workspaceCardExpanded ? "pointer-events-none"');
    expect(chatViewSource).toContain('workspaceCardExpanded && "pointer-events-auto"');
    expect(chatViewSource).toContain("contentInsetEndAdjustment={composerOverlayHeight}");
    expect(chatViewSource).toContain("bottom: composerOverlayHeight + 4");
    expect(chatViewSource).toMatch(
      /bottomInset=\{\s*isDraftHeroState && !workspaceCardExpanded \? 0 : composerOverlayHeight\s*\}/,
    );
  });

  it("keeps terminal restoration and the desktop-only boundary intact", () => {
    expect(chatViewSource).toContain("terminalUiState.terminalOpen &&");
    expect(chatViewSource).toContain("!workspaceCardExpanded");
    expect(deckControllerSource).toContain(
      'const DESKTOP_WORKBENCH_MEDIA_QUERY = "(min-width: 48rem)"',
    );
    expect(deckControllerSource).toContain("if (!isDesktop)");
    expect(deckControllerSource).not.toContain("if (!isDesktop || !props.cwd)");
    expect(deckControllerSource).toMatch(/setExpandedCard\(null\)[\s\S]*?\}, \[scopeKey\]\);/);
  });

  it("restores focus to the compact expand arrow after collapse", () => {
    const returnLabelIndex = compactCardSource.indexOf('aria-label="Return to chat"');
    const expandButtonRefIndex = compactCardSource.indexOf("ref={props.expandButtonRef}");
    const expandLabelIndex = compactCardSource.indexOf('aria-label="Expand Git workbench"');

    expect(returnLabelIndex).toBe(-1);
    expect(expandButtonRefIndex).toBeGreaterThan(-1);
    expect(expandLabelIndex).toBeGreaterThan(expandButtonRefIndex);
    expect(deckControllerSource).toContain("returnFocusRef={expandButtonRef}");
  });
});
