import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { RunId } from "@t3tools/contracts";
import type { ComposerTaskStep, ComposerTasksProgress } from "./ComposerTasksBadge";

export function deriveComposerTasks(input: {
  readonly turnItems: ThreadStructure["turnItems"];
  readonly runId: RunId | null;
  readonly working: boolean;
}): {
  readonly id: string;
  readonly progress: ComposerTasksProgress;
  readonly steps: readonly ComposerTaskStep[];
} | null {
  if (!input.working || input.runId === null) return null;
  const item = input.turnItems.findLast(
    (candidate) => candidate.type === "todo_list" && candidate.runId === input.runId,
  );
  if (item?.type !== "todo_list") return null;
  const current =
    item.steps.find((step) => step.status === "running") ??
    item.steps.find((step) => step.status === "pending");
  if (!current) return null;
  return {
    id: `${input.runId}:${item.planId}`,
    progress: {
      step: current.text,
      completedSteps: item.steps.filter((step) => step.status === "completed").length,
      totalSteps: item.steps.length,
    },
    steps: item.steps.map((step) => ({
      step: step.text,
      status: step.status === "running" ? "inProgress" : step.status,
      ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
    })),
  };
}
