import { describe, expect, it } from "vite-plus/test";

import {
  applyGitWorkbenchStreamEvent,
  emptyGitWorkbenchProjection,
  type GitWorkbenchProjection,
  type GitWorkbenchProjectionEvent,
} from "./projection.ts";

interface Operation {
  readonly kind: "idle" | "rebase";
}

interface Snapshot {
  readonly stateToken: string;
  readonly operation: Operation;
}

interface Queue {
  readonly id: string;
}

interface Undo {
  readonly id: string;
}

type Projection = GitWorkbenchProjection<Snapshot, Queue, Undo>;
type Event = GitWorkbenchProjectionEvent<Snapshot, Operation, Queue, Undo>;

const snapshot = (stateToken: string, kind: Operation["kind"] = "idle"): Snapshot => ({
  stateToken,
  operation: { kind },
});

describe("Git workbench live projection", () => {
  it("replaces all reconnect-sensitive state with a fresh snapshot event", () => {
    const stale: Projection = {
      snapshot: snapshot("old", "rebase"),
      queuedWorkflow: { id: "old-queue" },
      undoSnapshots: [{ id: "old-undo" }],
    };
    const event: Event = {
      _tag: "snapshot",
      snapshot: snapshot("current"),
      queuedWorkflow: null,
      undoSnapshots: [{ id: "current-undo" }],
    };

    expect(applyGitWorkbenchStreamEvent(stale, event)).toEqual({
      snapshot: snapshot("current"),
      queuedWorkflow: null,
      undoSnapshots: [{ id: "current-undo" }],
    });
  });

  it("merges repository, operation, queue, and undo updates independently", () => {
    const initial = applyGitWorkbenchStreamEvent(
      emptyGitWorkbenchProjection<Snapshot, Queue, Undo>(),
      {
        _tag: "snapshot",
        snapshot: snapshot("one"),
        queuedWorkflow: null,
        undoSnapshots: [],
      },
    );
    const repository = applyGitWorkbenchStreamEvent(initial, {
      _tag: "repositoryUpdated",
      snapshot: snapshot("two"),
    });
    const operation = applyGitWorkbenchStreamEvent(repository, {
      _tag: "operationUpdated",
      operation: { kind: "rebase" },
    });
    const queue = applyGitWorkbenchStreamEvent(operation, {
      _tag: "queueUpdated",
      queuedWorkflow: { id: "queue-1" },
    });
    const undo = applyGitWorkbenchStreamEvent(queue, {
      _tag: "undoUpdated",
      undoSnapshots: [{ id: "undo-1" }],
    });

    expect(undo).toEqual({
      snapshot: snapshot("two", "rebase"),
      queuedWorkflow: { id: "queue-1" },
      undoSnapshots: [{ id: "undo-1" }],
    });
  });

  it("does not manufacture repository state from a partial operation update", () => {
    const empty = emptyGitWorkbenchProjection<Snapshot, Queue, Undo>();

    expect(
      applyGitWorkbenchStreamEvent(empty, {
        _tag: "operationUpdated",
        operation: { kind: "rebase" },
      }),
    ).toBe(empty);
  });
});
