import { describe, expect, it } from "vite-plus/test";

import gitWorkspaceDeckControllerSource from "./GitWorkspaceDeckController.tsx?raw";
import {
  resolveGitDeckCardIds,
  resolveScopedWorkspaceDeckActiveCard,
  shouldLoadGitRepositoryInsights,
  shouldLoadGitWorkbenchData,
} from "./GitWorkspaceDeckController";

describe("workspace deck controller policy", () => {
  it("aligns the inactive Chat peek with checkout context and gives it an icon", () => {
    expect(gitWorkspaceDeckControllerSource).toContain(
      'className="flex h-full items-center gap-1.5 !px-7 text-xs font-medium text-muted-foreground"',
    );
    expect(gitWorkspaceDeckControllerSource).toContain(
      '<MessageSquareIcon aria-hidden className="size-3.5 shrink-0" />',
    );
  });

  it("does not render the previous chat's workspace card while the next chat loads", () => {
    expect(
      resolveScopedWorkspaceDeckActiveCard({
        availableCardIds: ["chat", "git", "mcp"],
        currentSelection: { card: "mcp", scopeKey: "environment:/repo:thread-a" },
        rememberedCard: null,
        scopeKey: "environment:/repo:thread-b",
      }),
    ).toBe("chat");
  });

  it("registers Git between Chat and MCP only after repository capability is confirmed", () => {
    expect(
      resolveGitDeckCardIds({
        cwd: "/repo",
        isRepository: true,
        workbenchSupported: true,
      }),
    ).toEqual(["chat", "git", "mcp"]);

    expect(
      resolveGitDeckCardIds({
        cwd: "/repo",
        isRepository: null,
        workbenchSupported: true,
      }),
    ).toEqual(["chat", "mcp"]);
    expect(
      resolveGitDeckCardIds({
        cwd: "/repo",
        isRepository: false,
        workbenchSupported: true,
      }),
    ).toEqual(["chat", "mcp"]);
    expect(
      resolveGitDeckCardIds({
        cwd: "/repo",
        isRepository: true,
        workbenchSupported: false,
      }),
    ).toEqual(["chat", "mcp"]);
    expect(
      resolveGitDeckCardIds({
        cwd: null,
        isRepository: true,
        workbenchSupported: true,
      }),
    ).toEqual(["chat", "mcp"]);
  });

  it("loads detailed Git data only while the available Git card is active or expanded", () => {
    expect(
      shouldLoadGitWorkbenchData({
        activeCard: "git",
        expandedCard: null,
        gitAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldLoadGitWorkbenchData({
        activeCard: "chat",
        expandedCard: "git",
        gitAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldLoadGitWorkbenchData({
        activeCard: "mcp",
        expandedCard: "mcp",
        gitAvailable: true,
      }),
    ).toBe(false);
    expect(
      shouldLoadGitWorkbenchData({
        activeCard: "git",
        expandedCard: "git",
        gitAvailable: false,
      }),
    ).toBe(false);
  });

  it("loads repository insights only for the expanded Overview tab", () => {
    expect(
      shouldLoadGitRepositoryInsights({
        activeTab: "overview",
        expandedCard: null,
        gitAvailable: true,
      }),
    ).toBe(false);
    expect(
      shouldLoadGitRepositoryInsights({
        activeTab: "overview",
        expandedCard: "git",
        gitAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldLoadGitRepositoryInsights({
        activeTab: "changes",
        expandedCard: "git",
        gitAvailable: true,
      }),
    ).toBe(false);
    expect(
      shouldLoadGitRepositoryInsights({
        activeTab: "overview",
        expandedCard: "mcp",
        gitAvailable: true,
      }),
    ).toBe(false);
    expect(
      shouldLoadGitRepositoryInsights({
        activeTab: "overview",
        expandedCard: "git",
        gitAvailable: false,
      }),
    ).toBe(false);
  });
});
