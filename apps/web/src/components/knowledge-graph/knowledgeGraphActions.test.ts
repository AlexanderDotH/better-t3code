import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  confirmAndClearKnowledgeGraph,
  isKnowledgeGraphDragGesture,
  resolveKnowledgeGraphDraggedPosition,
} from "./knowledgeGraphActions";

const environmentId = EnvironmentId.make("environment-1");
const scope = { projectId: ProjectId.make("project-1") };

describe("confirmAndClearKnowledgeGraph", () => {
  it("preserves derived graph data when the destructive confirmation is declined", async () => {
    const clear = vi.fn();

    await expect(
      confirmAndClearKnowledgeGraph({
        environmentId,
        scope,
        confirm: async () => false,
        clear,
      }),
    ).resolves.toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears only the selected scope after confirmation", async () => {
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(
      confirmAndClearKnowledgeGraph({
        environmentId,
        scope,
        confirm: async () => true,
        clear,
      }),
    ).resolves.toBe(true);
    expect(clear).toHaveBeenCalledWith({
      environmentId,
      input: { target: "scope", scope },
    });
  });
});

describe("isKnowledgeGraphDragGesture", () => {
  it("keeps small pointer jitter clickable and suppresses clicks after a real drag", () => {
    expect(isKnowledgeGraphDragGesture({ x: 10, y: 10 }, { x: 12, y: 13 })).toBe(false);
    expect(isKnowledgeGraphDragGesture({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(true);
  });

  it("uses canvas bounds rather than toolbar-relative panel coordinates", () => {
    expect(
      resolveKnowledgeGraphDraggedPosition(
        { x: 260, y: 190 },
        { left: 100, top: 70, width: 400, height: 300 },
        2,
      ),
    ).toEqual({ x: 80, y: 60 });
  });
});
