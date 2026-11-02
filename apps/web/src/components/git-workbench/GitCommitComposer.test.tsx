import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { GitCommitOutcome } from "../gitActionsControlBus";
import { commitResult } from "./gitCommitTestFixtures";
import {
  EMPTY_GIT_COMMIT_DRAFT,
  gitCommitDraftKey,
  useGitCommitDraftStore,
} from "./gitCommitDraftStore";

const environmentId = EnvironmentId.make("composer-environment");
const otherEnvironmentId = EnvironmentId.make("other-environment");
beforeEach(() => useGitCommitDraftStore.getState().clear());
afterEach(() => useGitCommitDraftStore.getState().clear());

describe("Git commit drafts", () => {
  it("separates environments at the same cwd and repositories in the same environment", () => {
    const store = useGitCommitDraftStore.getState();
    const first = gitCommitDraftKey(environmentId, "/repo");
    const second = gitCommitDraftKey(otherEnvironmentId, "/repo");
    const third = gitCommitDraftKey(environmentId, "/other");
    store.update(first, { mode: "manual", message: "First" });
    store.update(second, { mode: "manual", message: "Second" });
    store.update(third, { message: "Third" });
    expect(useGitCommitDraftStore.getState().drafts.get(first)?.message).toBe("First");
    expect(useGitCommitDraftStore.getState().drafts.get(second)?.message).toBe("Second");
    expect(useGitCommitDraftStore.getState().drafts.get(third)?.message).toBe("Third");
  });

  it.each([
    { status: "failure", message: "hook failed" },
    { status: "cancelled" },
    { status: "queued" },
    { status: "blocked", reason: "changed" },
    { status: "success", result: commitResult({ commit: { status: "skipped_no_changes" } }) },
  ] satisfies ReadonlyArray<GitCommitOutcome>)(
    "retains the submitted manual draft after $status",
    (outcome) => {
      const key = gitCommitDraftKey(environmentId, "/repo");
      const store = useGitCommitDraftStore.getState();
      store.update(key, { mode: "manual", message: "Keep this message" });
      const ticket = store.begin(key)!;
      expect(store.begin(key)).toBeNull();
      store.settle(key, ticket, outcome);
      expect(useGitCommitDraftStore.getState().drafts.get(key)).toMatchObject({
        message: "Keep this message",
        mode: "manual",
        pending: null,
        outcome,
      });
    },
  );

  it("clears only a successfully created manual submission at the same version", () => {
    const key = gitCommitDraftKey(environmentId, "/repo");
    const store = useGitCommitDraftStore.getState();
    store.update(key, { mode: "manual", message: "Submitted" });
    const ticket = store.begin(key)!;
    store.settle(key, ticket, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.message).toBe("");

    store.update(key, { message: "Submitted again" });
    const older = store.begin(key)!;
    store.update(key, { message: "A newer edit" });
    store.update(key, { message: "Submitted again" });
    store.settle(key, older, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.message).toBe("Submitted again");
  });

  it("preserves saved manual text when an automatic submission succeeds", () => {
    const key = gitCommitDraftKey(environmentId, "/repo");
    const store = useGitCommitDraftStore.getState();
    store.update(key, { message: "Saved for later", mode: "automatic" });
    const ticket = store.begin(key)!;
    store.settle(key, ticket, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.message).toBe("Saved for later");
  });

  it("ignores duplicate and cleared submission completions", () => {
    const key = gitCommitDraftKey(environmentId, "/repo");
    const store = useGitCommitDraftStore.getState();
    store.update(key, { message: "First", mode: "manual" });
    const first = store.begin(key)!;
    store.settle(key, first, { status: "cancelled" });
    const second = store.begin(key)!;
    store.settle(key, first, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.get(key)?.pending).toBe(second);
    store.clear();
    store.settle(key, second, { status: "success", result: commitResult() });
    expect(useGitCommitDraftStore.getState().drafts.size).toBe(0);
    expect(EMPTY_GIT_COMMIT_DRAFT.message).toBe("");
  });
});
