import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  partitionProjectGroupsByActivity,
  PROJECT_INACTIVITY_MS,
  resolveOlderProjectMemberKeys,
  type ProjectActivityGroup,
  type ProjectActivityThread,
} from "./projectActivity.ts";

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const environmentId = EnvironmentId.make("environment-local");
const ago = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW_MS - ms));
const OLD = ago(PROJECT_INACTIVITY_MS + 1);

function group(key: string, timestamps: { createdAt?: string; updatedAt?: string } = {}) {
  return {
    key,
    projectRefs: [{ environmentId, projectId: ProjectId.make(key) }],
    projects: [{ createdAt: timestamps.createdAt ?? OLD, updatedAt: timestamps.updatedAt ?? OLD }],
  } satisfies ProjectActivityGroup;
}

function thread(projectId: string, overrides: Partial<ProjectActivityThread> = {}) {
  return {
    environmentId,
    projectId: ProjectId.make(projectId),
    archivedAt: null,
    runtime: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    settledOverride: null,
    unsettledAt: null,
    settledAt: null,
    latestUserMessageAt: null,
    updatedAt: OLD,
    createdAt: OLD,
    ...overrides,
  } satisfies ProjectActivityThread;
}

function keys(input: {
  readonly groups: ReadonlyArray<ProjectActivityGroup>;
  readonly threads: ReadonlyArray<ProjectActivityThread>;
}) {
  return [...new Set(resolveOlderProjectMemberKeys({ ...input, nowMs: NOW_MS }).values())];
}

describe("partitionProjectGroupsByActivity", () => {
  it("keeps exactly seven days recent and moves one millisecond older", () => {
    const exact = group("exact", {
      createdAt: ago(PROJECT_INACTIVITY_MS),
      updatedAt: ago(PROJECT_INACTIVITY_MS),
    });
    const older = group("older");
    const result = partitionProjectGroupsByActivity({
      groups: [exact, older],
      threadsByGroupKey: new Map(),
      nowMs: NOW_MS,
    });
    expect(result.recentGroups).toEqual([exact]);
    expect(result.olderGroups).toEqual([older]);
    expect(result.nextTransitionAtMs).toBe(NOW_MS + 1);
  });

  it("keeps projects with malformed timestamps recent", () => {
    const malformed = group("bad", { createdAt: "bad", updatedAt: "worse" });
    expect(
      partitionProjectGroupsByActivity({
        groups: [malformed],
        threadsByGroupKey: new Map(),
        nowMs: NOW_MS,
      }).recentGroups,
    ).toEqual([malformed]);
  });
});

describe("resolveOlderProjectMemberKeys", () => {
  it("folds idle and fully settled projects, keyed by member", () => {
    const idle = group("idle");
    const settled = group("settled");
    const recent = group("recent");
    const result = resolveOlderProjectMemberKeys({
      groups: [idle, settled, recent],
      threads: [
        thread("idle", { latestUserMessageAt: OLD, updatedAt: ago(1_000) }),
        thread("settled", { settledOverride: "settled", settledAt: ago(1_000) }),
        thread("recent", { latestUserMessageAt: ago(60_000) }),
      ],
      nowMs: NOW_MS,
    });
    expect([...result]).toEqual([
      [`${environmentId}:idle`, "idle"],
      [`${environmentId}:settled`, "settled"],
    ]);
  });

  it("keeps every attention state recent regardless of age", () => {
    const groups = ["approval", "input", "plan", "running"].map((key) => group(key));
    expect(
      keys({
        groups,
        threads: [
          thread("approval", { hasPendingApprovals: true }),
          thread("input", { hasPendingUserInput: true }),
          thread("plan", { hasActionableProposedPlan: true }),
          thread("running", {
            runtime: {
              status: "running",
              activeRunId: null,
              providerInstanceId: ProviderInstanceId.make("codex"),
              providerName: "Codex",
              lastError: null,
              updatedAt: OLD,
            },
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("lets settlement outrank a stale attention flag and renewed activity outrank age", () => {
    const project = group("project");
    const stalePlan = thread("project", {
      hasActionableProposedPlan: true,
      settledOverride: "settled",
      settledAt: OLD,
    });
    expect(keys({ groups: [project], threads: [stalePlan] })).toEqual(["project"]);
    expect(
      keys({
        groups: [project],
        threads: [stalePlan, thread("project", { latestUserMessageAt: ago(0) })],
      }),
    ).toEqual([]);
  });

  it("ignores archived activity so cleanup does not revive a project", () => {
    expect(
      keys({
        groups: [group("project")],
        threads: [thread("project", { updatedAt: ago(1_000), archivedAt: ago(500) })],
      }),
    ).toEqual(["project"]);
  });
});
