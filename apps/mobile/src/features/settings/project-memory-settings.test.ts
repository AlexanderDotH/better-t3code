import { describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_PROJECT_MEMORY_VIEW_MODEL,
  projectMemoryClearActions,
  updateProjectMemoryPreferences,
} from "./project-memory-settings";

describe("mobile project memory settings", () => {
  it("defaults a project without loaded memory to project mode", () => {
    expect(DEFAULT_PROJECT_MEMORY_VIEW_MODEL.mode).toBe("project");
  });

  it("preserves agent-write permission while changing memory source", () => {
    expect(
      updateProjectMemoryPreferences(
        { ...DEFAULT_PROJECT_MEMORY_VIEW_MODEL, allowAgentWrites: true },
        { memoryMode: "provider" },
      ),
    ).toEqual({ memoryMode: "provider", allowAgentWrites: true });
  });

  it("clears memory only through the destructive confirmation action", () => {
    const clear = vi.fn();
    const actions = projectMemoryClearActions(clear, { cancel: "Cancel", clear: "Clear memory" });

    actions[0]?.onPress?.();
    expect(clear).not.toHaveBeenCalled();

    actions[1]?.onPress?.();
    expect(clear).toHaveBeenCalledOnce();
    expect(actions[1]?.style).toBe("destructive");
  });
});
