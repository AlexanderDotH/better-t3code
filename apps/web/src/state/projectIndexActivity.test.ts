import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ProjectIndexActivityV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { useProjectIndexActivityStore } from "./projectIndexActivity";

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const projectId = ProjectId.make("project-a");
const decodeActivity = Schema.decodeSync(ProjectIndexActivityV1);

function activity(environment: string, state: ProjectIndexActivityV1["state"], updatedAt: string) {
  return decodeActivity({
    scope: {
      scopeId: `scope-${environment}`,
      projectId,
      workspaceFingerprint: `fingerprint-${environment}`,
    },
    state,
    settings: { enabled: true },
    coverage: { indexedFiles: 4, eligibleFiles: 8 },
    job: null,
    updatedAt,
  });
}

afterEach(() => {
  useProjectIndexActivityStore.getState().clearEnvironment(environmentA);
  useProjectIndexActivityStore.getState().clearEnvironment(environmentB);
});

describe("project index activity store", () => {
  it("updates the active icon from stream events and clears only the disconnected environment", () => {
    const runningA = activity("a", "extracting", "2026-09-23T00:00:00.000Z");
    const runningB = activity("b", "discovering", "2026-09-23T00:00:00.000Z");
    const store = useProjectIndexActivityStore.getState();
    store.applyEvent(environmentA, { type: "snapshot", activities: [runningA] });
    store.applyEvent(environmentB, { type: "snapshot", activities: [runningB] });

    store.applyEvent(environmentA, {
      type: "status",
      activity: activity("a", "ready", "2026-09-23T00:01:00.000Z"),
    });
    expect(
      useProjectIndexActivityStore
        .getState()
        .activeByProject.has(scopedProjectKey(scopeProjectRef(environmentA, projectId))),
    ).toBe(false);
    expect(
      useProjectIndexActivityStore
        .getState()
        .activeByProject.has(scopedProjectKey(scopeProjectRef(environmentB, projectId))),
    ).toBe(true);

    store.clearEnvironment(environmentB);
    expect(useProjectIndexActivityStore.getState().activeByProject.size).toBe(0);
  });
});
