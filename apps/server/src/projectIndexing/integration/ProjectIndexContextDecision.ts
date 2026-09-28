import {
  DecisionUsage,
  type DecisionGenerationInput,
  type DecisionGenerationResult,
  type DecisionUsage as DecisionUsageType,
  type ModelSelection,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { DecisionGeneration } from "../../decisionGeneration/DecisionGeneration.ts";
import {
  PROJECT_INDEX_AUTOMATIC_CONTEXT_MAX_TOKENS,
  PROJECT_INDEX_TASK_MAX_CHARACTERS,
  type ProjectIndexTurnContextCandidate,
  type ProjectIndexTurnContextFingerprint,
} from "./ProjectIndexTurnContext.ts";

export const PROJECT_INDEX_CONTEXT_DECISION_ACTIVITY_KIND =
  "project-index.context-decision" as const;
export const PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID = "project-index-context" as const;
const PROJECT_INDEX_CONTEXT_DECISION_CANDIDATE_MAX_CHARACTERS =
  PROJECT_INDEX_AUTOMATIC_CONTEXT_MAX_TOKENS * 4;

export const PROJECT_INDEX_CONTEXT_DECISION_CRITERIA = {
  include:
    "The candidate contains concrete project-specific facts that can help edit or answer the current task.",
  skip: "The candidate is irrelevant, redundant, or contains no facts usable for the task.",
} as const;

export type ProjectIndexContextDecisionChoice =
  keyof typeof PROJECT_INDEX_CONTEXT_DECISION_CRITERIA;

const ProjectIndexTurnContextFingerprintSchema = Schema.Struct({
  indexRevision: Schema.Int.check(Schema.isGreaterThan(0)),
  candidateHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});

export const ProjectIndexContextDecisionActivityPayload = Schema.Struct({
  model: Schema.String.check(Schema.isNonEmpty()),
  choice: Schema.Literals(["include", "skip"]),
  fallback: Schema.Boolean,
  confidence: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isBetween({ minimum: 0, maximum: 1 })),
  ),
  durationMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  usage: Schema.optional(DecisionUsage),
  fingerprint: ProjectIndexTurnContextFingerprintSchema,
});
export type ProjectIndexContextDecisionActivityPayload =
  typeof ProjectIndexContextDecisionActivityPayload.Type;
const decodeProjectIndexContextDecisionActivityPayload = Schema.decodeUnknownOption(
  ProjectIndexContextDecisionActivityPayload,
);

export interface ProjectIndexContextDecisionResolution {
  readonly context: string | undefined;
  readonly activity: ProjectIndexContextDecisionActivityPayload;
  readonly reused: boolean;
}

interface ProjectIndexDecisionDiagnostics {
  readonly model: string;
  readonly durationMs: number;
  readonly usage?: DecisionUsageType | undefined;
}

export interface ResolveProjectIndexContextDecisionInput {
  readonly cwd: string;
  readonly modelSelection: ModelSelection;
  readonly task: string;
  readonly candidate: ProjectIndexTurnContextCandidate;
  readonly previousDecision?: unknown;
}

interface ProjectIndexActivityLike {
  readonly kind: string;
  readonly turnId?: string | null | undefined;
  readonly payload?: unknown;
}

function boundedDecisionState(task: string, candidate: ProjectIndexTurnContextCandidate): string {
  return JSON.stringify({
    currentUserPrompt: task.slice(0, PROJECT_INDEX_TASK_MAX_CHARACTERS),
    projectIndexCandidate: candidate.context.slice(
      0,
      PROJECT_INDEX_CONTEXT_DECISION_CANDIDATE_MAX_CHARACTERS,
    ),
    indexRevision: candidate.fingerprint.indexRevision,
    hitCount: candidate.hitCount,
  });
}

function sameFingerprint(
  left: ProjectIndexTurnContextFingerprint,
  right: ProjectIndexTurnContextFingerprint,
): boolean {
  return left.indexRevision === right.indexRevision && left.candidateHash === right.candidateHash;
}

function normalizeDurationMs(durationMs: number): number {
  return Number.isFinite(durationMs) ? Math.max(0, Math.trunc(durationMs)) : 0;
}

function resolution(
  candidate: ProjectIndexTurnContextCandidate,
  activity: ProjectIndexContextDecisionActivityPayload,
  reused: boolean,
): ProjectIndexContextDecisionResolution {
  return {
    context: activity.choice === "include" ? candidate.context : undefined,
    activity,
    reused,
  };
}

export function buildProjectIndexContextDecisionInput(
  modelSelection: ModelSelection,
  task: string,
  candidate: ProjectIndexTurnContextCandidate,
): DecisionGenerationInput {
  return {
    modelSelection,
    state: boundedDecisionState(task, candidate),
    questions: {
      [PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID]: {
        instructions:
          "Decide whether the retrieved Project Index candidate should be included in the coding-agent turn.",
        criteria: PROJECT_INDEX_CONTEXT_DECISION_CRITERIA,
      },
    },
  };
}

export function failOpenProjectIndexContextDecision(
  candidate: ProjectIndexTurnContextCandidate,
  diagnostics: ProjectIndexDecisionDiagnostics,
): ProjectIndexContextDecisionResolution {
  return resolution(
    candidate,
    {
      model: diagnostics.model,
      choice: "include",
      fallback: true,
      durationMs: normalizeDurationMs(diagnostics.durationMs),
      ...(diagnostics.usage === undefined ? {} : { usage: diagnostics.usage }),
      fingerprint: candidate.fingerprint,
    },
    false,
  );
}

export function applyProjectIndexContextDecisionResult(
  candidate: ProjectIndexTurnContextCandidate,
  result: DecisionGenerationResult,
  durationMs: number,
): ProjectIndexContextDecisionResolution {
  const answer = result.answers[PROJECT_INDEX_CONTEXT_DECISION_QUESTION_ID];
  if (answer?.choice !== "include" && answer?.choice !== "skip") {
    return failOpenProjectIndexContextDecision(candidate, {
      model: result.model,
      durationMs,
      usage: result.usage,
    });
  }
  return resolution(
    candidate,
    {
      model: result.model,
      choice: answer.choice,
      fallback: false,
      ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
      durationMs: normalizeDurationMs(durationMs),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      fingerprint: candidate.fingerprint,
    },
    false,
  );
}

export function reuseProjectIndexContextDecision(
  candidate: ProjectIndexTurnContextCandidate,
  persistedPayload: unknown,
): ProjectIndexContextDecisionResolution | undefined {
  const decoded = decodeProjectIndexContextDecisionActivityPayload(persistedPayload);
  if (Option.isNone(decoded) || !sameFingerprint(candidate.fingerprint, decoded.value.fingerprint))
    return undefined;
  if (decoded.value.fallback && decoded.value.choice !== "include") return undefined;
  return resolution(candidate, decoded.value, true);
}

export function findReusableProjectIndexContextDecision(
  candidate: ProjectIndexTurnContextCandidate,
  activities: ReadonlyArray<ProjectIndexActivityLike>,
  expectedTurnId?: string,
): ProjectIndexContextDecisionResolution | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (
      activity?.kind !== PROJECT_INDEX_CONTEXT_DECISION_ACTIVITY_KIND ||
      (expectedTurnId !== undefined && activity.turnId !== expectedTurnId)
    )
      continue;
    const reusable = reuseProjectIndexContextDecision(candidate, activity.payload);
    if (reusable !== undefined) return reusable;
  }
  return undefined;
}

export function projectIndexContextDecisionActivitySummary(
  activity: ProjectIndexContextDecisionActivityPayload,
): string {
  if (activity.fallback) return "Project Index context used (decision fallback)";
  return activity.choice === "include"
    ? "Project Index context used"
    : "Project Index context skipped";
}

export const resolveProjectIndexContextDecision = Effect.fn("ProjectIndexContextDecision.resolve")(
  function* (
    decisionGeneration: DecisionGeneration["Service"],
    input: ResolveProjectIndexContextDecisionInput,
  ) {
    if (input.previousDecision !== undefined) {
      const reused = reuseProjectIndexContextDecision(input.candidate, input.previousDecision);
      if (reused !== undefined) return reused;
    }

    const startedAt = yield* Clock.currentTimeMillis;
    const result = yield* decisionGeneration
      .decide({
        cwd: input.cwd,
        ...buildProjectIndexContextDecisionInput(input.modelSelection, input.task, input.candidate),
      })
      .pipe(Effect.option);
    const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
    if (Option.isNone(result)) {
      return failOpenProjectIndexContextDecision(input.candidate, {
        model: input.modelSelection.model,
        durationMs,
      });
    }
    return applyProjectIndexContextDecisionResult(input.candidate, result.value, durationMs);
  },
);
