import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PROJECT_MEMORY_VIEW_MODEL,
  canEditProjectMemory,
  updateProjectMemoryPreferences,
} from "./ProjectMemorySettings.logic";

describe("project memory settings", () => {
  it("defaults a project without loaded memory to project mode", () => {
    expect(DEFAULT_PROJECT_MEMORY_VIEW_MODEL.mode).toBe("project");
    expect(canEditProjectMemory(DEFAULT_PROJECT_MEMORY_VIEW_MODEL)).toBe(false);
  });

  it("preserves the other preference when changing mode or agent writes", () => {
    const viewModel = {
      mode: "project" as const,
      allowAgentWrites: true,
      effectivePath: "/repo/AGENTS.md",
      content: "Remember this",
      status: "ready" as const,
    };

    expect(updateProjectMemoryPreferences(viewModel, { memoryMode: "provider" })).toEqual({
      memoryMode: "provider",
      allowAgentWrites: true,
    });
    expect(updateProjectMemoryPreferences(viewModel, { allowAgentWrites: false })).toEqual({
      memoryMode: "project",
      allowAgentWrites: false,
    });
  });

  it("keeps unavailable or disabled memory read-only", () => {
    expect(canEditProjectMemory({ ...DEFAULT_PROJECT_MEMORY_VIEW_MODEL, status: "ready" })).toBe(
      true,
    );
    expect(
      canEditProjectMemory({
        ...DEFAULT_PROJECT_MEMORY_VIEW_MODEL,
        mode: "off",
        status: "ready",
      }),
    ).toBe(false);
  });
});
