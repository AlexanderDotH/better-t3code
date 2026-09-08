import { describe, expect, it, vi } from "vite-plus/test";

import {
  resolveGitDeckCardIds,
  shouldLoadGitRepositoryInsights,
  shouldLoadGitWorkbenchData,
} from "./GitWorkspaceDeckController.availability";
import { CODE_MIX_COLORS, relativeAge } from "./GitWorkspaceDeckController.formatting";
import * as ModelFacade from "./GitWorkspaceDeckController.model";
import { repositoryState } from "./GitWorkspaceDeckController.mapping";

describe("Git workspace deck controller module boundaries", () => {
  it("keeps the stable model facade wired to focused behavior modules", () => {
    expect(ModelFacade.resolveGitDeckCardIds).toBe(resolveGitDeckCardIds);
    expect(ModelFacade.shouldLoadGitWorkbenchData).toBe(shouldLoadGitWorkbenchData);
    expect(ModelFacade.shouldLoadGitRepositoryInsights).toBe(shouldLoadGitRepositoryInsights);
    expect(ModelFacade.repositoryState).toBe(repositoryState);
    expect(ModelFacade.relativeAge).toBe(relativeAge);
    expect(ModelFacade.CODE_MIX_COLORS).toBe(CODE_MIX_COLORS);
  });

  it("keeps availability and formatting behavior independent from React state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
    try {
      expect(
        resolveGitDeckCardIds({ cwd: "/workspace", isRepository: true, workbenchSupported: true }),
      ).toEqual(["chat", "git", "mcp"]);
      expect(relativeAge("2026-08-30T11:55:00.000Z")).toBe("5m ago");
    } finally {
      vi.useRealTimers();
    }
  });
});
