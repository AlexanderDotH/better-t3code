import {
  PlanId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { deriveComposerTasks } from "./composerTasks";

const runId = RunId.make("active-run");
const base = {
  id: TurnItemId.make("tasks"),
  threadId: ThreadId.make("thread"),
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "completed",
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: DateTime.makeUnsafe(0),
} as const;
const todo = {
  ...base,
  type: "todo_list",
  planId: PlanId.make("plan"),
  steps: [
    { id: "done", text: "Inspect", status: "completed", durationMs: 1200 },
    { id: "later", text: "Verify", status: "pending" },
    { id: "current", text: "Implement", status: "running" },
  ],
} satisfies OrchestrationV2TurnItem;

describe("active composer tasks", () => {
  it("shows the running task before pending tasks and keeps completed progress and duration", () => {
    expect(deriveComposerTasks({ turnItems: [todo], runId, working: true })).toMatchObject({
      progress: { step: "Implement", completedSteps: 1, totalSteps: 3 },
      steps: [
        { step: "Inspect", status: "completed", durationMs: 1200 },
        { step: "Verify", status: "pending" },
        { step: "Implement", status: "inProgress" },
      ],
    });
  });

  it("uses the latest list and falls back to the next pending step", () => {
    const latest = {
      ...todo,
      id: TurnItemId.make("replacement"),
      steps: [{ id: "pending", text: "Review", status: "pending" as const }],
    };
    expect(
      deriveComposerTasks({ turnItems: [todo, latest], runId, working: true })?.progress,
    ).toEqual({ step: "Review", completedSteps: 0, totalSteps: 1 });
  });

  it("hides settled, completed and unrelated-run tasks without reviving an older list", () => {
    expect(deriveComposerTasks({ turnItems: [todo], runId, working: false })).toBeNull();
    expect(
      deriveComposerTasks({ turnItems: [todo], runId: RunId.make("next-run"), working: true }),
    ).toBeNull();
    expect(deriveComposerTasks({ turnItems: [todo], runId: null, working: true })).toBeNull();
    expect(
      deriveComposerTasks({
        turnItems: [
          todo,
          { ...todo, steps: todo.steps.map((step) => ({ ...step, status: "completed" })) },
        ],
        runId,
        working: true,
      }),
    ).toBeNull();
  });
});
