import { assert, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitLabPullRequestCli from "./GitLabPullRequestCli.ts";
import { gitLabViewerPermissions, make } from "./GitLabPullRequestProvider.ts";
import type { GitLabMergeRequestDetail } from "./gitLabMergeRequestJson.ts";
import { GitLabCliRateLimitError } from "../sourceControl/GitLabCli.ts";

describe("gitLabViewerPermissions", () => {
  it("offers everything to a viewer GitLab says can merge", () => {
    expect(gitLabViewerPermissions({ viewerCanMerge: true })).toEqual({
      // Arming a merge for later and taking the arming back answer to the same `can_merge`.
      actions: [
        "merge",
        "ready",
        "draft",
        "close",
        "reopen",
        "update-branch",
        "enable-auto-merge",
        "disable-auto-merge",
      ],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve"],
      // GitLab says nothing about who may set a reviewer, and an unreported permission is granted.
      requestReviewers: true,
      // Rebase and nothing else: GitLab cannot merge a target branch into a source branch, so
      // offering the choice would be offering something no request could carry out.
      updateMethods: ["rebase"],
    });
  });

  it("keeps merge, now and later, from a viewer GitLab says cannot", () => {
    // `user.can_merge` already accounts for the role, the approval rules and a protected target
    // branch, so it is the one answer here that does not have to be inferred.
    expect(gitLabViewerPermissions({ viewerCanMerge: false })).toEqual({
      actions: ["ready", "draft", "close", "reopen"],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve"],
      requestReviewers: true,
    });
  });

  it("names no way of updating a branch it will not let this viewer update", () => {
    // The action and the strategy behind it go together: a button offered with nothing to press
    // it with, or a strategy left standing next to a withheld button, is a half-refusal.
    expect(gitLabViewerPermissions({ viewerCanMerge: false }).updateMethods).toBeUndefined();
  });

  it("treats an author with read access as any other reader, which is all GitLab says", () => {
    // Its REST API names no relationship between the viewer and the merge request beyond
    // `can_merge`, so the four an author keeps stay offered to everyone rather than being taken
    // from the one person entitled to them.
    expect(gitLabViewerPermissions({ viewerCanMerge: false }).actions).toEqual([
      "ready",
      "draft",
      "close",
      "reopen",
    ]);
  });
});

describe("getChangeRequest", () => {
  const detail = {
    number: 7,
    title: "Merge request 7",
    url: "https://gitlab.com/acme/web/-/merge_requests/7",
    author: null,
    headBranch: "feat/page",
    baseBranch: "main",
    state: "open" as const,
    isDraft: false,
    mergeability: "mergeable" as const,
    additions: 0,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    reviewRequestLogins: [],
    labels: [],
    body: "",
    changedFiles: 1,
    mergedAt: null,
    closedAt: null,
    reviewers: [],
    checks: [],
    viewerCanMerge: true,
    reviewerIds: [],
  };

  it.effect("reads job logs from the verified head pipeline's source project", () =>
    Effect.gen(function* () {
      const log = {
        check: { name: "test", status: "pending" as const, url: null, description: null, logId: 7 },
        text: "output",
        complete: false,
        truncated: false,
      };
      const getJobLog = vi.fn(() => Effect.succeed(log));
      const provider = yield* make.pipe(
        Effect.provide(
          Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
            getMergeRequestDetail: () =>
              Effect.succeed({ ...detail, headPipeline: { id: 42, projectId: 51 } }),
            getJobLog,
          }),
        ),
      );
      expect(
        yield* provider.getCheckLog!({
          cwd: "/w",
          repository: "acme/web",
          host: "gitlab.com",
          number: 7,
          checkId: 7,
        }),
      ).toEqual(log);
      expect(getJobLog).toHaveBeenCalledWith({
        cwd: "/w",
        repository: "51",
        pipelineId: 42,
        jobId: 7,
      });
    }),
  );
  it.effect("rejects log reads when the MR no longer has a pipeline", () =>
    Effect.gen(function* () {
      const getJobLog = vi.fn();
      const provider = yield* make.pipe(
        Effect.provide(
          Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
            getMergeRequestDetail: () => Effect.succeed(detail),
            getJobLog,
          }),
        ),
      );
      const error = yield* provider.getCheckLog!({
        cwd: "/w",
        repository: "acme/web",
        host: "gitlab.com",
        number: 7,
        checkId: 7,
      }).pipe(Effect.flip);
      expect(error.detail).toContain("no longer has a pipeline");
      expect(getJobLog).not.toHaveBeenCalled();
    }),
  );

  const readWith = (
    overrides: Partial<GitLabMergeRequestDetail>,
    listPipelineChecks: GitLabPullRequestCli.GitLabPullRequestCli["Service"]["listPipelineChecks"] = () =>
      Effect.succeed([]),
  ) =>
    Effect.gen(function* () {
      const provider = yield* make;
      return yield* provider.getChangeRequest({
        cwd: "/w",
        repository: "acme/web",
        host: "gitlab.com",
        number: 7,
      });
    }).pipe(
      Effect.provide(
        Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({
          getMergeRequestDetail: () => Effect.succeed({ ...detail, ...overrides }),
          listPipelineChecks,
          getProjectMergeCapabilities: () =>
            Effect.succeed({ merge: true, squash: true, rebase: true }),
        }),
      ),
    );

  it.effect("shows jobs from the head pipeline's project, including fork pipelines", () =>
    Effect.gen(function* () {
      const checks = [
        {
          name: "unit-coverage",
          stage: "test",
          status: "pending" as const,
          description: null,
          url: null,
        },
      ];
      const listPipelineChecks = vi.fn(() => Effect.succeed(checks));
      const result = yield* readWith(
        { headPipeline: { id: 10642, projectId: 51 } },
        listPipelineChecks,
      );
      expect(result.checks).toEqual(checks);
      expect(listPipelineChecks).toHaveBeenCalledWith({
        cwd: "/w",
        repository: "51",
        pipelineId: 10642,
      });
    }),
  );

  it.effect("preserves the pipeline status and link when individual jobs cannot be loaded", () =>
    Effect.gen(function* () {
      const pipeline = {
        name: "Pipeline",
        status: "pending" as const,
        description: null,
        url: "https://gitlab.com/acme/web/-/pipelines/10642",
      };
      const listPipelineChecks = () =>
        Effect.fail(
          new GitLabPullRequestCli.GitLabMergeRequestReadError({
            command: "glab",
            cwd: "/w",
            operation: "listPipelineChecks",
            cause: new Error("Unavailable"),
          }),
        );
      const result = yield* readWith(
        { headPipeline: { id: 10642, projectId: null }, checks: [pipeline] },
        listPipelineChecks,
      );
      expect(result.checks).toEqual([{ ...pipeline, name: "Pipeline — job details unavailable" }]);
    }),
  );

  it.effect("keeps rate limits visible to the server's provider backoff", () =>
    Effect.gen(function* () {
      const listPipelineChecks = () =>
        Effect.fail(
          new GitLabCliRateLimitError({
            command: "glab",
            cwd: "/w",
            operation: "execute",
            cause: new Error("Rate limited"),
          }),
        );
      const error = yield* readWith(
        { headPipeline: { id: 10642, projectId: 51 } },
        listPipelineChecks,
      ).pipe(Effect.flip);
      expect(error).toMatchObject({ reason: "rate-limited" });
    }),
  );

  it.effect("reads a counted divergence as a branch that has fallen behind", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({ divergedCommits: 3 });

      expect(changeRequest.baseComparison).toBe("behind");
      expect(changeRequest.behindBy).toBe(3);
    }),
  );

  it.effect("reads a divergence of none as a branch that is current", () =>
    Effect.gen(function* () {
      const changeRequest = yield* readWith({ divergedCommits: 0 });

      expect(changeRequest.baseComparison).toBe("up-to-date");
      expect(changeRequest.behindBy).toBe(0);
    }),
  );

  it.effect("says nothing at all where GitLab counted nothing", () =>
    Effect.gen(function* () {
      // An install too old to answer has to leave the page silent rather than let it claim the
      // branch is current, which is the one wrong thing this banner could say.
      const changeRequest = yield* readWith({});

      expect(changeRequest.baseComparison).toBe("unknown");
      expect(changeRequest.behindBy).toBeUndefined();
    }),
  );
});

describe("rewriting what has already been said", () => {
  const updateMergeRequest = vi.fn(() => Effect.void);
  const updateNote = vi.fn(() => Effect.void);

  const providerWith = make.pipe(
    Effect.provide(
      Layer.mock(GitLabPullRequestCli.GitLabPullRequestCli)({ updateMergeRequest, updateNote }),
    ),
  );

  it.effect("sends only the half of the merge request the reader rewrote", () =>
    Effect.gen(function* () {
      const provider = yield* providerWith;
      assert.isDefined(provider.updateChangeRequest);

      yield* provider.updateChangeRequest({
        cwd: "/w",
        repository: "acme/web",
        host: "gitlab.com",
        number: 7,
        body: "What this changes.",
      });

      // GitLab calls it the description, and the title stays out of the request entirely.
      expect(updateMergeRequest).toHaveBeenCalledWith({
        cwd: "/w",
        repository: "acme/web",
        number: 7,
        description: "What this changes.",
      });
    }),
  );

  it.effect("rewrites a positioned comment through the same note as any other", () =>
    Effect.gen(function* () {
      const provider = yield* providerWith;
      assert.isDefined(provider.updateComment);

      yield* provider.updateComment({
        cwd: "/w",
        repository: "acme/web",
        host: "gitlab.com",
        number: 7,
        commentId: "42",
        kind: "review-comment",
        body: "Reworded.",
      });

      expect(updateNote).toHaveBeenCalledWith({
        cwd: "/w",
        repository: "acme/web",
        number: 7,
        noteId: "42",
        body: "Reworded.",
      });
    }),
  );
});
