export interface GitWorkbenchProjection<Snapshot, QueuedWorkflow, UndoSnapshot> {
  readonly snapshot: Snapshot | null;
  readonly queuedWorkflow: QueuedWorkflow | null;
  readonly undoSnapshots: ReadonlyArray<UndoSnapshot>;
}

export type GitWorkbenchProjectionEvent<
  Snapshot extends { readonly operation: Operation },
  Operation,
  QueuedWorkflow,
  UndoSnapshot,
> =
  | {
      readonly _tag: "snapshot";
      readonly snapshot: Snapshot;
      readonly queuedWorkflow: QueuedWorkflow | null;
      readonly undoSnapshots: ReadonlyArray<UndoSnapshot>;
    }
  | { readonly _tag: "repositoryUpdated"; readonly snapshot: Snapshot }
  | { readonly _tag: "operationUpdated"; readonly operation: Operation }
  | {
      readonly _tag: "queueUpdated";
      readonly queuedWorkflow: QueuedWorkflow | null;
    }
  | { readonly _tag: "undoUpdated"; readonly undoSnapshots: ReadonlyArray<UndoSnapshot> };

export function emptyGitWorkbenchProjection<
  Snapshot,
  QueuedWorkflow,
  UndoSnapshot,
>(): GitWorkbenchProjection<Snapshot, QueuedWorkflow, UndoSnapshot> {
  return {
    snapshot: null,
    queuedWorkflow: null,
    undoSnapshots: [],
  };
}

export function applyGitWorkbenchStreamEvent<
  Operation,
  Snapshot extends { readonly operation: Operation },
  QueuedWorkflow,
  UndoSnapshot,
>(
  current: GitWorkbenchProjection<Snapshot, QueuedWorkflow, UndoSnapshot>,
  event: GitWorkbenchProjectionEvent<Snapshot, Operation, QueuedWorkflow, UndoSnapshot>,
): GitWorkbenchProjection<Snapshot, QueuedWorkflow, UndoSnapshot> {
  switch (event._tag) {
    case "snapshot":
      return {
        snapshot: event.snapshot,
        queuedWorkflow: event.queuedWorkflow,
        undoSnapshots: event.undoSnapshots,
      };
    case "repositoryUpdated":
      return { ...current, snapshot: event.snapshot };
    case "operationUpdated":
      return current.snapshot === null
        ? current
        : { ...current, snapshot: { ...current.snapshot, operation: event.operation } };
    case "queueUpdated":
      return { ...current, queuedWorkflow: event.queuedWorkflow };
    case "undoUpdated":
      return { ...current, undoSnapshots: event.undoSnapshots };
  }
}
