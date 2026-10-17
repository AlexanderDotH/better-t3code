import {
  ModelSelection,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  type RuntimeSessionId,
  type ThreadId,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import type { DecisionGenerationRequest } from "../decisionGeneration/DecisionGenerationProvider.ts";
import { normalizedModelSelectionKey } from "../decisionGeneration/DecisionGeneration.ts";
import type { DecisionGenerationResult } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { makeKeyedDrainableWorker } from "@t3tools/shared/KeyedDrainableWorker";
import type { resolveContextCompactionModel } from "@t3tools/shared/model";
import {
  CONTEXT_APPLIED_ACTIVITY,
  CONTEXT_CHECKPOINT_ACTIVITY,
  CONTEXT_PREPARATION_RATIO,
  CONTEXT_REPLACEMENT_RATIO,
  contextPrefixFingerprint,
  contextPrefixLength,
  contextTranscriptSegments,
  contextUsageRatio,
} from "./contextCompactionPolicy.ts";
import {
  CONTEXT_SUMMARY_MAX_CHARS,
  type ContextSummaryInput,
  type ContextSummaryResult,
} from "../textGeneration/ContextSummaryGeneration.ts";

export const ContextCompactionCheckpoint = Schema.Struct({
  version: Schema.Literal(1),
  prefixMessageCount: Schema.Int.check(Schema.isGreaterThan(0)),
  prefixFingerprint: Schema.String,
  summary: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CONTEXT_SUMMARY_MAX_CHARS),
  ),
  modelSelection: ModelSelection,
  summaryModelSelection: Schema.optional(ModelSelection),
  agentModelSelection: ModelSelection,
  mode: Schema.Literals(["summary", "selection"]),
  cwd: Schema.String,
  sourceRuntimeSessionId: Schema.NullOr(Schema.String),
});
export type ContextCompactionCheckpoint = typeof ContextCompactionCheckpoint.Type;

export interface ContextCompactionSource {
  readonly threadId: ThreadId;
  readonly provider: string | null;
  readonly runtimeSessionId: RuntimeSessionId | null;
  readonly busy: boolean;
  readonly agentModelSelection: ModelSelection;
  readonly cwd: string;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export interface ContextCompactionConfiguration {
  readonly enabled: boolean;
  readonly model: ReturnType<typeof resolveContextCompactionModel>;
}

export class ContextCompactionError extends Schema.TaggedError<ContextCompactionError>()(
  "ContextCompactionError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

function selectionState(previousCheckpoint: string, excerpts: ReadonlyArray<string>) {
  return JSON.stringify({ previousCheckpoint, excerpts });
}

interface ContextCompactionDependencies {
  readonly load: (
    threadId: ThreadId,
  ) => Effect.Effect<ContextCompactionSource | undefined, ContextCompactionError>;
  readonly configuration: Effect.Effect<ContextCompactionConfiguration, ContextCompactionError>;
  readonly summarize: (
    input: ContextSummaryInput,
  ) => Effect.Effect<ContextSummaryResult, ContextCompactionError>;
  readonly decide: (
    input: DecisionGenerationRequest,
  ) => Effect.Effect<DecisionGenerationResult, ContextCompactionError>;
  readonly publish: (
    threadId: ThreadId,
    kind: string,
    checkpoint: ContextCompactionCheckpoint,
  ) => Effect.Effect<void, ContextCompactionError>;
}

const sameSelection = (left: ModelSelection, right: ModelSelection) =>
  normalizedModelSelectionKey(left) === normalizedModelSelectionKey(right);

type CheckpointModels = Pick<
  ContextCompactionCheckpoint,
  "modelSelection" | "summaryModelSelection" | "mode"
>;
function checkpointModels(model: NonNullable<ContextCompactionConfiguration["model"]>) {
  return {
    modelSelection: model.selection,
    summaryModelSelection: model.summarySelection ?? model.selection,
    mode: model.mode,
  };
}
function sameCheckpointModels(left: CheckpointModels, right: CheckpointModels) {
  return (
    left.mode === right.mode &&
    sameSelection(left.modelSelection, right.modelSelection) &&
    sameSelection(
      left.summaryModelSelection ?? left.modelSelection,
      right.summaryModelSelection ?? right.modelSelection,
    )
  );
}
const checkpointValid = (
  checkpoint: ContextCompactionCheckpoint,
  source: ContextCompactionSource,
) =>
  checkpoint.cwd === source.cwd &&
  sameSelection(checkpoint.agentModelSelection, source.agentModelSelection) &&
  checkpoint.prefixMessageCount <= source.messages.length &&
  contextPrefixFingerprint(source.messages, checkpoint.prefixMessageCount) ===
    checkpoint.prefixFingerprint;

const decodeCheckpoint = Schema.decodeUnknownOption(ContextCompactionCheckpoint);
const validateCheckpoint = Schema.decodeEffect(ContextCompactionCheckpoint);
const decodeUsage = Schema.decodeUnknownOption(ThreadTokenUsageSnapshot);

function savedCheckpoint(source: ContextCompactionSource, preparedOnly = false) {
  const candidates = source.activities.flatMap((activity) => {
    if (activity.kind !== CONTEXT_CHECKPOINT_ACTIVITY && activity.kind !== CONTEXT_APPLIED_ACTIVITY)
      return [];
    const checkpoint = decodeCheckpoint(activity.payload);
    return Option.isSome(checkpoint) && checkpointValid(checkpoint.value, source)
      ? [{ checkpoint: checkpoint.value, applied: activity.kind === CONTEXT_APPLIED_ACTIVITY }]
      : [];
  });
  return candidates
    .filter(
      (candidate) =>
        !preparedOnly ||
        (!candidate.applied &&
          !candidates.some(
            (other) =>
              other.applied &&
              other.checkpoint.prefixFingerprint === candidate.checkpoint.prefixFingerprint &&
              sameCheckpointModels(other.checkpoint, candidate.checkpoint),
          )),
    )
    .toSorted(
      (left, right) => right.checkpoint.prefixMessageCount - left.checkpoint.prefixMessageCount,
    )
    .at(0)?.checkpoint;
}

function sourceUsage(source: ContextCompactionSource) {
  for (let index = source.activities.length - 1; index >= 0; index--) {
    const activity = source.activities[index];
    if (
      activity?.kind !== "context-window.updated" ||
      activity.replyTopicId !== undefined ||
      activity.id.startsWith("subagent:")
    )
      continue;
    const usage = decodeUsage(activity.payload);
    if (Option.isSome(usage)) return usage.value;
  }
  return undefined;
}

const CONTEXT_PREPARATION_QUEUE_CAPACITY = 64;
interface ContextPreparationRequest {
  readonly threadId: ThreadId;
  readonly revision: number;
}

export const makeContextCompactionEngine = Effect.fn("ContextCompaction.make")(function* (
  dependencies: ContextCompactionDependencies,
) {
  const prepared = new Map<ThreadId, ContextCompactionCheckpoint>();
  const pending = new Set<ThreadId>();
  const cancellations = new Map<ThreadId, Effect.Effect<void>>();
  const latestUsage = new Map<ThreadId, ThreadTokenUsageSnapshot>();
  const revisions = new Map<ThreadId, number>();
  const attemptedPrefixes = new Map<ThreadId, string>();

  const selectTranscript = Effect.fn("ContextCompaction.selectTranscript")(function* (
    input: ContextSummaryInput,
  ) {
    const excerpts = input.transcript.split("\n").filter(Boolean);
    const questions = Object.fromEntries(
      excerpts.map((_, index) => [
        String(index),
        {
          instructions: `Classify excerpts[${index}]. Retain user requirements, corrections, decisions, completed work, exact references, blockers, and next steps needed to continue the task. Keep excerpts you cannot assess, including missing or truncated excerpts. Omit an excerpt only when its useful facts are superseded, duplicated in the previous checkpoint, or incidental.`,
          criteria: {
            keep: "Needed for accurate continuation, or uncertain.",
            omit: "Superseded, repetitive, or incidental.",
          },
        },
      ]),
    );
    const result = yield* dependencies.decide({
      cwd: input.cwd,
      modelSelection: input.modelSelection,
      state: selectionState(input.previousSummary, excerpts),
      questions,
    });
    if (
      Object.keys(questions).some(
        (key) => result.answers[key]?.choice !== "keep" && result.answers[key]?.choice !== "omit",
      )
    ) {
      return yield* new ContextCompactionError({
        detail: "The context selection returned missing or invalid decisions.",
      });
    }
    return excerpts
      .filter((_, index) => result.answers[String(index)]?.choice === "keep")
      .join("\n");
  });

  const prepare = Effect.fn("ContextCompaction.prepare")(function* (
    threadId: ThreadId,
    revision: number,
  ) {
    if ((revisions.get(threadId) ?? 0) !== revision) return;
    const config = yield* dependencies.configuration;
    if (!config.enabled || !config.model) return;
    const model = config.model;
    const source = yield* dependencies.load(threadId);
    if (
      !source ||
      source.provider !== "codex" ||
      contextUsageRatio(sourceUsage(source)) < CONTEXT_PREPARATION_RATIO
    )
      return;
    const count = contextPrefixLength(source.messages);
    if (count < 2 || source.messages.slice(0, count).some((message) => message.streaming)) return;
    const previousReady = prepared.get(threadId) ?? savedCheckpoint(source, true);
    const previous = previousReady ?? savedCheckpoint(source);
    if (
      previousReady &&
      checkpointValid(previousReady, source) &&
      sameCheckpointModels(previousReady, checkpointModels(model))
    ) {
      prepared.set(threadId, previousReady);
      return;
    }
    const reusable =
      previous &&
      checkpointValid(previous, source) &&
      previous.prefixMessageCount < count &&
      sameCheckpointModels(previous, checkpointModels(model))
        ? previous
        : undefined;
    const prefixFingerprint = contextPrefixFingerprint(source.messages, count);
    const attemptKey = [
      prefixFingerprint,
      model.mode,
      normalizedModelSelectionKey(model.selection),
      normalizedModelSelectionKey(model.summarySelection ?? model.selection),
      source.runtimeSessionId,
    ].join(":");
    if (attemptedPrefixes.get(threadId) === attemptKey) return;
    attemptedPrefixes.set(threadId, attemptKey);
    let summary = reusable?.summary ?? "";
    const start = reusable?.prefixMessageCount ?? 0;
    for (const transcript of contextTranscriptSegments(source.messages, start, count)) {
      const selected = yield* selectTranscript({
        cwd: source.cwd,
        modelSelection: model.selection,
        previousSummary: summary,
        transcript,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Context selection failed; summarizing the complete segment.", {
            cause,
          }).pipe(Effect.as(transcript)),
        ),
      );
      if (!selected) continue;
      const result = yield* dependencies.summarize({
        cwd: source.cwd,
        modelSelection: model.summarySelection ?? model.selection,
        previousSummary: summary,
        transcript: selected,
      });
      summary = result.summary;
    }
    const checkpoint = yield* validateCheckpoint({
      version: 1,
      prefixMessageCount: count,
      prefixFingerprint,
      summary,
      ...checkpointModels(model),
      agentModelSelection: source.agentModelSelection,
      cwd: source.cwd,
      sourceRuntimeSessionId: source.runtimeSessionId,
    });
    const currentConfig = yield* dependencies.configuration;
    const current = yield* dependencies.load(threadId);
    if (
      !currentConfig.enabled ||
      !currentConfig.model ||
      !sameCheckpointModels(checkpoint, checkpointModels(currentConfig.model)) ||
      !current ||
      current.runtimeSessionId !== source.runtimeSessionId ||
      (revisions.get(threadId) ?? 0) !== revision ||
      !checkpointValid(checkpoint, current)
    )
      return;
    yield* dependencies.publish(threadId, CONTEXT_CHECKPOINT_ACTIVITY, checkpoint);
    prepared.set(threadId, checkpoint);
  });

  const worker = yield* makeKeyedDrainableWorker(
    ({ threadId, revision }: ContextPreparationRequest) =>
      Effect.gen(function* () {
        const preparation = yield* prepare(threadId, revision).pipe(Effect.forkScoped);
        cancellations.set(threadId, Fiber.interrupt(preparation).pipe(Effect.asVoid));
        yield* Fiber.join(preparation);
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning(
                "Background context preparation failed; keeping the provider context.",
                { threadId, cause: Cause.pretty(cause) },
              ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            pending.delete(threadId);
            cancellations.delete(threadId);
          }),
        ),
      ),
    {
      keyOf: (request) => request.threadId,
      weightOf: () => 64,
      concurrency: 2,
      maxItemsPerKey: 1,
      maxItems: CONTEXT_PREPARATION_QUEUE_CAPACITY,
    },
  );

  const observe = Effect.fn("ContextCompaction.observe")(function* (
    threadId: ThreadId,
    payload: unknown,
  ) {
    const usage = decodeUsage(payload);
    if (Option.isNone(usage)) return;
    latestUsage.set(threadId, usage.value);
    if (
      contextUsageRatio(usage.value) < CONTEXT_PREPARATION_RATIO ||
      pending.has(threadId) ||
      prepared.has(threadId) ||
      pending.size >= CONTEXT_PREPARATION_QUEUE_CAPACITY
    )
      return;
    pending.add(threadId);
    const accepted = yield* worker.enqueue({ threadId, revision: revisions.get(threadId) ?? 0 });
    if (!accepted) pending.delete(threadId);
  });

  const replacement = Effect.fn("ContextCompaction.replacement")(function* (
    threadId: ThreadId,
    boundaryMessageId: OrchestrationMessage["id"],
  ) {
    const usage = latestUsage.get(threadId);
    if (!prepared.has(threadId) || !usage || contextUsageRatio(usage) < CONTEXT_REPLACEMENT_RATIO)
      return undefined;
    const config = yield* dependencies.configuration;
    if (!config.enabled || !config.model) return undefined;
    const source = yield* dependencies.load(threadId);
    if (
      !source ||
      source.provider !== "codex" ||
      source.busy ||
      contextUsageRatio(sourceUsage(source)) < CONTEXT_REPLACEMENT_RATIO
    )
      return undefined;
    const checkpoint = prepared.get(threadId) ?? savedCheckpoint(source, true);
    const boundary = source.messages.findIndex((message) => message.id === boundaryMessageId);
    if (
      !checkpoint ||
      boundary < checkpoint.prefixMessageCount ||
      !checkpointValid(checkpoint, source) ||
      !sameCheckpointModels(checkpoint, checkpointModels(config.model))
    ) {
      prepared.delete(threadId);
      return undefined;
    }
    return {
      checkpoint,
      messages: source.messages.slice(checkpoint.prefixMessageCount, boundary + 1),
    };
  });

  const applied = Effect.fn("ContextCompaction.applied")(function* (
    threadId: ThreadId,
    checkpoint: ContextCompactionCheckpoint,
  ) {
    prepared.delete(threadId);
    latestUsage.set(threadId, { usedTokens: 0 });
    yield* dependencies.publish(threadId, CONTEXT_APPLIED_ACTIVITY, checkpoint);
  });

  return {
    observe,
    replacement,
    applied,
    forget: (threadId: ThreadId) =>
      Effect.gen(function* () {
        prepared.delete(threadId);
        latestUsage.delete(threadId);
        attemptedPrefixes.delete(threadId);
        revisions.set(threadId, (revisions.get(threadId) ?? 0) + 1);
        const cancel = cancellations.get(threadId);
        if (cancel) yield* cancel;
      }),
    drain: worker.drain,
  };
});
