import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestListEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { groupPullRequestsByInvolvement, sortPullRequestGroups } from "./pullRequestList.ts";

function entry(number: number, overrides: Partial<PullRequestListEntry> = {}) {
  return {
    number,
    provider: SourceControlProviderKind.make("github"),
    host: "github.com",
    repository: "org/repo",
    projectId: ProjectId.make("project"),
    projectTitle: "Project",
    environmentId: EnvironmentId.make("one"),
    title: `Change ${number}`,
    url: `https://github.com/org/repo/pull/${number}`,
    author: { login: "other", name: null, avatarUrl: null },
    headBranch: `branch-${number}`,
    baseBranch: "main",
    state: "open" as const,
    isDraft: false,
    mergeability: "mergeable" as const,
    additions: 10,
    deletions: 0,
    createdAt: `2026-10-${String(number).padStart(2, "0")}T00:00:00Z`,
    updatedAt: `2026-10-${String(number).padStart(2, "0")}T00:00:00Z`,
    observedAt: 1,
    viewerReviewRequested: false,
    labels: [],
    ...overrides,
  };
}

describe("pull request list groups and sorts", () => {
  it("groups by each environment's viewer with authored taking precedence", () => {
    const authored = {
      ...entry(1, { viewerReviewRequested: true }),
      author: { login: "ME", name: null, avatarUrl: null },
    };
    const otherEnvironment = { ...authored, environmentId: EnvironmentId.make("two"), number: 2 };
    const groups = groupPullRequestsByInvolvement([entry(3), otherEnvironment, authored], {
      "one github.com": "me",
      "two github.com": "somebody-else",
    });
    expect(groups.map((group) => [group.key, group.entries.map((row) => row.number)])).toEqual([
      ["authored", [1]],
      ["reviewRequested", [2]],
      ["others", [3]],
    ]);
  });

  it("ranks merge readiness and puts measured sizes before unknown sizes", () => {
    const entries = [
      entry(1, { checksState: "failing" }),
      entry(2, { checksState: "passing" }),
      entry(3, { checksState: "passing", reviewDecision: "approved" }),
      entry(4, { mergeability: "conflicting" }),
      entry(5, { checksState: "passing", additions: 0 }),
    ];
    const groups = [{ key: "others" as const, label: "", entries }];
    expect(sortPullRequestGroups(groups, "ready", "")[0]?.entries.map((row) => row.number)).toEqual(
      [3, 2, 5, 1, 4],
    );
    expect(sortPullRequestGroups(groups, "ready", "search")).toBe(groups);
    expect(sortPullRequestGroups(groups, "smallest", "")[0]?.entries.at(-1)?.number).toBe(5);
    expect(sortPullRequestGroups(groups, "smallest", "", () => true)[0]?.entries[0]?.number).toBe(
      5,
    );
    expect(
      sortPullRequestGroups(
        [{ ...groups[0]!, entries: [entry(1), entry(2, { additions: 100 })] }],
        "largest",
        "",
      )[0]?.entries[0]?.number,
    ).toBe(2);
  });

  it("uses author blockers for authored rows and open-first for review requests", () => {
    const entries = [
      entry(1, { reviewDecision: "approved", checksState: "passing" }),
      entry(2, { checksState: "failing" }),
      entry(3, { mergeability: "conflicting" }),
      entry(4, { reviewDecision: "changes-requested" }),
    ];
    const groups = [{ key: "authored" as const, label: "", entries }];
    expect(
      sortPullRequestGroups(groups, "blocked", "")[0]?.entries.map((row) => row.number),
    ).toEqual([3, 4, 2, 1]);
    const reviewing = [
      { key: "others" as const, label: "", entries: [entry(2, { state: "closed" }), entry(1)] },
    ];
    expect(
      sortPullRequestGroups(reviewing, "blocked", "", undefined, "reviewing")[0]?.entries.map(
        (row) => row.number,
      ),
    ).toEqual([1, 2]);
  });
});
