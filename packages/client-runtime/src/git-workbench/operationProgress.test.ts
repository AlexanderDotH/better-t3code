import type { GitWorkbenchOperationEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyGitWorkbenchOperationProgress,
  beginGitWorkbenchOperationProgress,
  idleGitWorkbenchOperationProgress,
} from "./operationProgress.ts";

const event = (value: GitWorkbenchOperationEvent): GitWorkbenchOperationEvent => value;

describe("Git workbench operation progress", () => {
  it("tracks started, progress, and completed events for one operation", () => {
    const started = applyGitWorkbenchOperationProgress(
      beginGitWorkbenchOperationProgress(),
      event({ _tag: "started", operationId: "operation-1", actionKind: "guided_rebase" }),
    );
    const progress = applyGitWorkbenchOperationProgress(
      started,
      event({
        _tag: "progress",
        operationId: "operation-1",
        phase: "rebase",
        label: "Rebasing commits",
      }),
    );
    const completed = applyGitWorkbenchOperationProgress(
      progress,
      event({
        _tag: "completed",
        operationId: "operation-1",
        result: {
          status: "succeeded",
          headOid: "a".repeat(40),
          operation: { kind: "none" },
        },
      }),
    );

    expect(started.status).toBe("running");
    expect(started.actionKind).toBe("guided_rebase");
    expect(progress.latest?._tag).toBe("progress");
    expect(completed.status).toBe("completed");
  });

  it("ignores late progress from a superseded operation", () => {
    const current = applyGitWorkbenchOperationProgress(
      beginGitWorkbenchOperationProgress(),
      event({ _tag: "started", operationId: "operation-2", actionKind: "reset" }),
    );

    expect(
      applyGitWorkbenchOperationProgress(
        current,
        event({
          _tag: "progress",
          operationId: "operation-1",
          phase: "reset",
          label: "Old operation",
        }),
      ),
    ).toBe(current);
  });

  it("marks an operation failed without discarding its terminal explanation", () => {
    const failed = applyGitWorkbenchOperationProgress(
      beginGitWorkbenchOperationProgress(),
      event({
        _tag: "failed",
        operationId: "operation-1",
        message: "The repository changed.",
      }),
    );

    expect(failed.status).toBe("failed");
    expect(failed.latest).toMatchObject({
      _tag: "failed",
      message: "The repository changed.",
    });
    expect(idleGitWorkbenchOperationProgress()).toEqual({
      status: "idle",
      latest: null,
      actionKind: null,
    });
  });
});
