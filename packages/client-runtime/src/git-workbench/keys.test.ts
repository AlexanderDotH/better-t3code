import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  gitWorkbenchCommitKey,
  gitWorkbenchHistoryKey,
  gitWorkbenchRepositoryKey,
} from "./keys.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

describe("Git workbench query keys", () => {
  it("isolates the same checkout path in different environments", () => {
    const first = gitWorkbenchRepositoryKey({
      environmentId: ENVIRONMENT_ID,
      cwd: "/workspace/project",
    });
    const second = gitWorkbenchRepositoryKey({
      environmentId: EnvironmentId.make("environment-2"),
      cwd: "/workspace/project",
    });

    expect(first).not.toBe(second);
  });

  it("keeps history snapshots, cursors, refs, and paths in the cache identity", () => {
    const base = {
      environmentId: ENVIRONMENT_ID,
      cwd: "/workspace/project",
      snapshotOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ref: "refs/heads/main",
      cursor: null,
      limit: 50,
      path: "src/main.ts",
    } as const;

    const first = gitWorkbenchHistoryKey(base);

    expect(
      gitWorkbenchHistoryKey({
        ...base,
        snapshotOid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).not.toBe(first);
    expect(gitWorkbenchHistoryKey({ ...base, cursor: "next-page" })).not.toBe(first);
    expect(gitWorkbenchHistoryKey({ ...base, ref: "refs/heads/release" })).not.toBe(first);
    expect(gitWorkbenchHistoryKey({ ...base, path: "src/other.ts" })).not.toBe(first);
  });

  it("uses the complete commit and file identity for immutable detail queries", () => {
    const commit = {
      environmentId: ENVIRONMENT_ID,
      cwd: "/workspace/project",
      oid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    } as const;

    expect(gitWorkbenchCommitKey(commit)).not.toBe(
      gitWorkbenchCommitKey({
        ...commit,
        oid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    );
    expect(gitWorkbenchCommitKey({ ...commit, path: "src/main.ts" })).not.toBe(
      gitWorkbenchCommitKey({ ...commit, path: "src/other.ts" }),
    );
  });
});
