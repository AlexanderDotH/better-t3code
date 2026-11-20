import {
  CommandId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanMutation,
  type DeepPlanPlanDraft,
  type DeepPlanRun,
  type DeepPlanReviewTarget,
  type ThreadDeepPlanAdvanceCommand,
  type ThreadDeepPlanUpdateCommand,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { derive } from "@t3tools/provider-core/server/IdAllocator";

import { advanceDeepPlanRun, startDeepPlanRun, updateDeepPlanRun } from "./deepPlanDecision.ts";

const createdAt = "2026-10-16T08:00:00.000Z";
const owner = ThreadId.make("plan-owner");
const implementation = { instanceId: ProviderInstanceId.make("test-provider"), model: "builder" };
const reviewer = { ...implementation, model: "reviewer" };
const document = {
  goal: "Preserve work across reconnects",
  scope: ["Thread state"],
  nonGoals: [],
  decisions: [],
  affectedAreas: ["Persistence", "Thread display"],
  steps: [
    {
      id: "persistence",
      title: "Save the work",
      description: "Persist the approved work.",
      dependencies: [],
      acceptanceCriteria: [
        { id: "save", description: "Work survives restart", checkMethod: "Restore it" },
      ],
    },
    {
      id: "display",
      title: "Display saved work",
      description: "Show saved work after reconnecting.",
      dependencies: ["persistence"],
      acceptanceCriteria: [
        { id: "show", description: "Work is visible", checkMethod: "Reconnect" },
      ],
    },
  ],
  finalValidation: { description: "Reconnect with saved work", checkMethod: "Run reconnect tests" },
} satisfies DeepPlanPlanDraft;
const step = { kind: "step", stepId: "persistence" } satisfies DeepPlanReviewTarget;
const started = startDeepPlanRun({
  type: "thread.deep-plan.start",
  commandId: CommandId.make("plan-start"),
  threadId: owner,
  chats: [],
  includeProjectChats: false,
  createdAt,
});

function updateCommand(
  run: DeepPlanRun,
  mutation: DeepPlanMutation,
  byThreadId?: ThreadId,
  byTurnCommandId?: CommandId,
): ThreadDeepPlanUpdateCommand {
  return {
    type: "thread.deep-plan.update",
    threadId: owner,
    runId: run.id,
    commandId: CommandId.make(`update:${run.revision}`),
    operationId: `${mutation.type}:${run.revision}`,
    mutation,
    expectedRevision: run.revision,
    ...(byThreadId === undefined ? {} : { byThreadId }),
    ...(byTurnCommandId === undefined ? {} : { byTurnCommandId }),
    createdAt,
  };
}

const published = started.pipe(
  Effect.flatMap((run) =>
    updateDeepPlanRun(run, updateCommand(run, { type: "publish-plan", plan: document }, owner)),
  ),
);

function approval(run: DeepPlanRun) {
  return {
    type: "approve",
    planVersion: run.plan!.version,
    approvalKey: run.approvalKey!,
    implementation,
    reviewer,
    implementationThread: "current",
    parallelism: 1,
  } as const;
}

const approved = published.pipe(
  Effect.flatMap((run) => updateDeepPlanRun(run, updateCommand(run, approval(run)))),
);

function advance(run: DeepPlanRun, transition: ThreadDeepPlanAdvanceCommand["transition"]) {
  return advanceDeepPlanRun(run, {
    type: "thread.deep-plan.advance",
    threadId: owner,
    runId: run.id,
    commandId: CommandId.make(`advance:${run.revision}`),
    expectedRevision: run.revision,
    transition,
    createdAt,
  });
}

function startImplementation(run: DeepPlanRun, stepId: string) {
  return advance(run, {
    type: "start-turn",
    turn: {
      kind: "implement",
      threadId: owner,
      stepId,
      laneId: run.approval!.lanes[0]!.laneId,
      round: 1,
      attempt: 0,
    },
    latestRunId: null,
    prompt: "Implement this step.",
    baseTurnCount: 0,
  });
}

it.effect("starts planning immediately without captured chat copies", () =>
  Effect.gen(function* () {
    const run = yield* started;
    expect(run.phase).toBe("planning");
    expect(run.chats).toEqual([]);
    expect(run.includeProjectChats).toBe(false);
  }),
);

it.effect("replays an existing operation before checking its now-stale revision", () =>
  Effect.gen(function* () {
    const run = yield* approved;
    const command = updateCommand(run, { type: "pause", reason: "Wait for input" });
    const paused = yield* updateDeepPlanRun(run, command);
    const replay = yield* updateDeepPlanRun(paused, {
      ...command,
      commandId: CommandId.make("later-receipt"),
    });
    expect(replay).toBe(paused);
    const conflict = yield* updateDeepPlanRun(paused, {
      ...command,
      mutation: { type: "cancel" },
    }).pipe(Effect.flip);
    expect(conflict.context.deepPlanCode).toBe("operation-conflict");
    const stale = yield* updateDeepPlanRun(paused, {
      ...command,
      operationId: "other",
    }).pipe(Effect.flip);
    expect(stale.context.deepPlanCode).toBe("stale-revision");
  }),
);

it.effect("accepts a user pause only while the plan is being implemented", () =>
  Effect.gen(function* () {
    const running = yield* approved;
    for (const run of [yield* started, yield* published]) {
      const rejected = yield* updateDeepPlanRun(run, updateCommand(run, { type: "pause" })).pipe(
        Effect.flip,
      );
      expect(rejected.context.deepPlanCode).toBe("invalid-transition");
      const cancelled = yield* updateDeepPlanRun(run, updateCommand(run, { type: "cancel" }));
      expect(cancelled.phase).toBe("cancelled");
    }
    for (const run of [running, { ...running, phase: "finalReview" as const }]) {
      const paused = yield* updateDeepPlanRun(run, updateCommand(run, { type: "pause" }));
      expect(paused.phase).toBe("paused");
      const again = yield* updateDeepPlanRun(paused, updateCommand(paused, { type: "pause" }));
      expect(again.phase).toBe("paused");
    }
  }),
);

it.effect(
  "retains the stored reviewer when the same approval is retried after settings change",
  () =>
    Effect.gen(function* () {
      const run = yield* published;
      const { reviewer: _explicit, ...selection } = approval(run);
      const command = { ...updateCommand(run, selection), defaultReviewer: reviewer };
      const initial = yield* updateDeepPlanRun(run, command);
      expect(initial.approval?.reviewer).toEqual(reviewer);
      const replay = yield* updateDeepPlanRun(initial, {
        ...command,
        commandId: CommandId.make("approval-replay-after-settings-change"),
        defaultReviewer: { ...reviewer, model: "different-default" },
      });
      expect(replay).toBe(initial);
    }),
);

it.effect(
  "publishes a fresh version and clears step state and approval when replanning from pause",
  () =>
    Effect.gen(function* () {
      const run = yield* approved;
      const implementing = yield* startImplementation(run, step.stepId);
      const paused = yield* updateDeepPlanRun(
        implementing,
        updateCommand(implementing, { type: "pause" }),
      );
      const republished = yield* updateDeepPlanRun(
        paused,
        updateCommand(
          paused,
          { type: "publish-plan", plan: { ...document, goal: "New goal" } },
          owner,
        ),
      );
      expect(republished.plan?.version).toBe(2);
      expect(republished.phase).toBe("awaitingApproval");
      expect(republished.activeTurns).toEqual([]);
      expect(republished.steps.every((state) => state.status === "pending")).toBe(true);
      expect(republished.approval).toBeNull();
      const stale = yield* updateDeepPlanRun(
        republished,
        updateCommand(republished, approval(run)),
      ).pipe(Effect.flip);
      expect(stale.context.deepPlanCode).toBe("stale-plan");
    }),
);

it.effect("requires submission and an independent review before starting dependent steps", () =>
  Effect.gen(function* () {
    const run = yield* approved;
    const dependent = yield* startImplementation(run, "display").pipe(Effect.flip);
    expect(dependent.context.deepPlanCode).toBe("invalid-transition");

    const implementing = yield* startImplementation(run, step.stepId);
    const submission = {
      type: "submit",
      target: step,
      summary: "Added persistence",
      changedFiles: ["state.ts"],
    } as const;
    const outsider = yield* updateDeepPlanRun(
      implementing,
      updateCommand(
        implementing,
        submission,
        ThreadId.make("outsider"),
        implementing.activeTurns[0]!.commandId,
      ),
    ).pipe(Effect.flip);
    expect(outsider.context.deepPlanCode).toBe("actor-mismatch");
    const submitted = yield* updateDeepPlanRun(
      implementing,
      updateCommand(implementing, submission, owner, implementing.activeTurns[0]!.commandId),
    );
    expect(submitted.steps[0]?.status).toBe("implementing");
    const ready = yield* advance(submitted, {
      type: "settle-turn",
      turnCommandId: implementing.activeTurns[0]!.commandId,
    });
    const reviewThread = derive.deepPlanReviewThread({
      runId: ready.id,
      planVersion: 1,
      target: step,
      round: 1,
    });
    const reviewing = yield* advance(ready, {
      type: "start-turn",
      turn: {
        kind: "review",
        threadId: reviewThread,
        stepId: step.stepId,
        laneId: run.approval!.lanes[0]!.laneId,
        round: 1,
        attempt: 0,
      },
      latestRunId: null,
      prompt: "Review the saved work.",
      diff: null,
    });
    const verdict = {
      type: "review-verdict",
      target: step,
      round: 1,
      verdict: "approved",
      summary: "Verified reconnect",
      findings: [],
    } as const;
    for (const [byThreadId, round] of [
      [owner, 1],
      [reviewThread, 2],
    ] as const) {
      const rejected = yield* updateDeepPlanRun(
        reviewing,
        updateCommand(
          reviewing,
          { ...verdict, round },
          byThreadId,
          reviewing.activeTurns[0]!.commandId,
        ),
      ).pipe(Effect.flip);
      expect(rejected.context.deepPlanCode).toBe("actor-mismatch");
    }
    const verified = yield* updateDeepPlanRun(reviewing, {
      ...updateCommand(reviewing, verdict, reviewThread, reviewing.activeTurns[0]!.commandId),
      expectedRevision: ready.revision,
    });
    expect(verified.steps[0]?.status).toBe("verified");
    const unfinishedReview = yield* startImplementation(verified, "display").pipe(Effect.flip);
    expect(unfinishedReview.context.deepPlanCode).toBe("invalid-transition");
    const settled = yield* advance(verified, {
      type: "settle-turn",
      turnCommandId: reviewing.activeTurns[0]!.commandId,
    });
    expect((yield* startImplementation(settled, "display")).steps[1]?.status).toBe("implementing");
  }),
);

it.effect("keeps a retry bound to the new turn when it reuses the implementation thread", () =>
  Effect.gen(function* () {
    const run = yield* approved;
    const implementing = yield* startImplementation(run, step.stepId);
    const first = implementing.activeTurns[0]!;
    const retried = yield* advance(implementing, {
      type: "start-turn",
      turn: {
        kind: first.kind,
        threadId: first.threadId,
        stepId: first.stepId,
        laneId: first.laneId,
        round: first.round,
        attempt: 1,
      },
      replaces: first.commandId,
      retryReason: "missingResult",
      latestRunId: null,
      prompt: "Submit the implementation result.",
    });
    const submit = {
      type: "submit",
      target: step,
      summary: "Persisted the work",
      changedFiles: ["state.ts"],
    } as const;
    const staleRevision = { expectedRevision: implementing.revision };
    const late = yield* updateDeepPlanRun(retried, {
      ...updateCommand(retried, submit, owner, first.commandId),
      ...staleRevision,
    }).pipe(Effect.flip);
    expect(late.context.deepPlanCode).toBe("actor-mismatch");
    const current = retried.activeTurns[0]!;
    const submission = {
      ...updateCommand(retried, submit, owner, current.commandId),
      ...staleRevision,
    };
    const submitted = yield* updateDeepPlanRun(retried, submission);
    const replayed = yield* updateDeepPlanRun(submitted, {
      ...submission,
      expectedRevision: submitted.revision,
    });
    expect(replayed).toBe(submitted);
    expect(submitted.steps[0]?.unsubmittedTurns).toBe(1);
    expect(submitted.steps[0]?.submission?.turnCommandId).toBe(current.commandId);
    const discarding = yield* advance(submitted, {
      type: "start-turn",
      turn: { ...retried.activeTurns[0]!, attempt: 2 },
      replaces: current.commandId,
      retryReason: "failed",
      latestRunId: null,
      prompt: "Retry the implementation.",
    }).pipe(Effect.flip);
    expect(discarding.detail).toBe("The Deep Plan turn already recorded its result.");
  }),
);
