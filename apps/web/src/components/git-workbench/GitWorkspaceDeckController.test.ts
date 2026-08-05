import { describe, expect, it } from "vite-plus/test";

import {
  resolveGitDeckCardIds,
  shouldLoadGitRepositoryInsights,
  shouldLoadGitWorkbenchData,
} from "./GitWorkspaceDeckController";

describe("workspace deck controller policy", () => {
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
