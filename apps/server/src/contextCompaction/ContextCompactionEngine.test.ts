import { it } from "@effect/vitest";
import { expect, describe } from "vite-plus/test";
import {
  EventId,
  MessageId,
  ProviderInstanceId,
  RuntimeSessionId,
  type DecisionGenerationResult,
  ThreadId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import {
  makeContextCompactionEngine,
  ContextCompactionError,
  type ContextCompactionCheckpoint,
  type ContextCompactionConfiguration,
  type ContextCompactionSource,
} from "./ContextCompactionEngine.ts";
import {
  CONTEXT_APPLIED_ACTIVITY,
  CONTEXT_CHECKPOINT_ACTIVITY,
  buildContextReplacementHandoff,
  contextTranscriptSegments,
  CONTEXT_SEGMENT_MAX_CHARS,
} from "./contextCompactionPolicy.ts";
import type { ContextSummaryInput } from "../textGeneration/ContextSummaryGeneration.ts";
import type { DecisionGenerationRequest } from "../decisionGeneration/DecisionGenerationProvider.ts";

const threadId = ThreadId.make("context-thread");
const selection = { instanceId: ProviderInstanceId.make("codex"), model: "test-luna" };
const now = "2026-10-17T10:00:00.000Z";
const message = (index: number, text = `message ${index}`): OrchestrationMessage => ({
  id: MessageId.make(`message-${index}`),
  role: index % 2 === 0 ? "user" : "assistant",
  text,
  streaming: false,
  turnId: null,
  createdAt: now,
  updatedAt: now,
});
function initialSource(): ContextCompactionSource {
  return {
    threadId,
    provider: "codex",
    runtimeSessionId: RuntimeSessionId.make("runtime-1"),
    busy: false,
    cwd: "/workspace",
    agentModelSelection: { ...selection, model: "test-sol" },
    messages: Array.from({ length: 7 }, (_, index) => message(index)),
    activities: [
      {
        id: EventId.make("usage"),
        kind: "context-window.updated",
        tone: "info",
        summary: "Context usage",
        turnId: null,
        createdAt: now,
        payload: { usedTokens: 700, maxTokens: 1000 },
      },
    ],
  };
}
const config: ContextCompactionConfiguration = {
  enabled: true,
  model: { selection, mode: "summary" },
};

function harness(input?: {
  summarize?: (
    input: ContextSummaryInput,
  ) => Effect.Effect<{ summary: string }, ContextCompactionError>;
  mode?: "summary" | "selection";
  decide?: (
    input: DecisionGenerationRequest,
  ) => Effect.Effect<DecisionGenerationResult, ContextCompactionError>;
}) {
  let source = initialSource();
  let configuration: ContextCompactionConfiguration = {
    ...config,
    model:
      input?.mode === "selection"
        ? {
            selection: { instanceId: ProviderInstanceId.make("decisions"), model: "classifier" },
            mode: "selection",
            summarySelection: selection,
          }
        : { selection, mode: "summary" },
  };
  const requests: ContextSummaryInput[] = [];
  const decisions: DecisionGenerationRequest[] = [];
  const published: Array<{ kind: string; checkpoint: ContextCompactionCheckpoint }> = [];
  const dependencies = {
    configuration: Effect.sync(() => configuration),
    load: () => Effect.sync(() => source),
    summarize: (request: ContextSummaryInput) => {
      requests.push(request);
      return (
        input?.summarize?.(request) ??
        Effect.succeed({ summary: "Preserved requirements and completed work." })
      );
    },
    decide: (request: DecisionGenerationRequest) => {
      decisions.push(request);
      return (
        input?.decide?.(request) ??
        Effect.succeed({
          model: request.modelSelection.model,
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              { choice: key === "0" ? "omit" : "keep" },
            ]),
          ),
        })
      );
    },
    publish: (_threadId: ThreadId, kind: string, checkpoint: ContextCompactionCheckpoint) =>
      Effect.sync(() => {
        published.push({ kind, checkpoint });
        const activity: OrchestrationThreadActivity = {
          id: EventId.make(`${kind}:${published.length}`),
          kind,
          tone: "info",
          summary: kind,
          createdAt: now,
          turnId: null,
          payload: checkpoint,
        };
        source = { ...source, activities: [...source.activities, activity] };
      }),
  };
  return {
    dependencies,
    requests,
    decisions,
    published,
    source: () => source,
    setSource: (next: ContextCompactionSource) => {
      source = next;
    },
    disable: () => {
      configuration = { ...configuration, enabled: false };
    },
    setConfiguration: (next: ContextCompactionConfiguration) => {
      configuration = next;
    },
  };
}

describe("background context compaction", () => {
  it.effect("leaves context to Codex and resumes Better T3 checkpoints after switching back", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = harness();
        h.disable();
        const engine = yield* makeContextCompactionEngine(h.dependencies);
        yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
        yield* engine.drain;
        expect(h.requests).toEqual([]);
        expect(h.decisions).toEqual([]);
        expect(h.published).toEqual([]);

        h.setConfiguration(config);
        yield* engine.observe(threadId, { usedTokens: 710, maxTokens: 1000 });
        yield* engine.drain;
        const prepared = yield* engine.replacement(threadId, MessageId.make("message-6"));
        expect(prepared).toBeDefined();
        expect(h.requests).toHaveLength(1);

        h.disable();
        expect(yield* engine.replacement(threadId, MessageId.make("message-6"))).toBeUndefined();
        h.setConfiguration(config);
        expect(yield* engine.replacement(threadId, MessageId.make("message-6"))).toEqual(prepared);
        expect(h.requests).toHaveLength(1);
        expect(h.source().messages).toHaveLength(7);
      }),
    ),
  );

  it.effect("cancels a queued preparation before it can call a model", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = harness();
        const bothStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const calls: string[] = [];
        const engine = yield* makeContextCompactionEngine({
          ...h.dependencies,
          load: (id) => Effect.succeed({ ...h.source(), threadId: id, cwd: String(id) }),
          summarize: (input) =>
            Effect.gen(function* () {
              calls.push(input.cwd);
              if (calls.length === 2) yield* Deferred.succeed(bothStarted, undefined);
              yield* Deferred.await(release);
              return { summary: "Retain the goal." };
            }),
        });
        yield* engine.observe(ThreadId.make("active-a"), { usedTokens: 700, maxTokens: 1000 });
        yield* engine.observe(ThreadId.make("active-b"), { usedTokens: 700, maxTokens: 1000 });
        yield* Deferred.await(bothStarted);
        yield* engine.observe(ThreadId.make("queued"), { usedTokens: 700, maxTokens: 1000 });
        yield* engine.forget(ThreadId.make("queued"));
        yield* Deferred.succeed(release, undefined);
        yield* engine.drain;
        expect(calls.toSorted()).toEqual(["active-a", "active-b"]);
      }),
    ),
  );

  it.effect(
    "prepares without blocking the active turn and preserves messages added during preparation",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const h = harness({
            summarize: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as({ summary: "Old requirements remain in force." }),
              ),
          });
          const engine = yield* makeContextCompactionEngine(h.dependencies);
          h.setSource({ ...h.source(), busy: true });
          yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* Deferred.await(entered);
          expect(yield* engine.replacement(threadId, MessageId.make("message-6"))).toBeUndefined();
          h.setSource({
            ...h.source(),
            busy: false,
            messages: [
              ...h.source().messages,
              message(7, "Finished while summarizing"),
              message(8, "New request"),
            ],
          });
          yield* Deferred.succeed(release, undefined);
          yield* engine.drain;
          const ready = yield* engine.replacement(threadId, MessageId.make("message-8"));
          expect(ready?.checkpoint.prefixMessageCount).toBe(4);
          expect(ready?.messages.map((item) => item.text)).toContain("Finished while summarizing");
          expect(ready?.messages.at(-1)?.text).toBe("New request");
          expect(h.requests).toHaveLength(1);
          expect(h.requests[0]?.modelSelection).toEqual(selection);
          expect(h.source().messages).toHaveLength(9);
        }),
      ),
  );

  it.effect.each(["edit", "runtime", "disable", "stop"] as const)(
    "discards a preparation invalidated by %s",
    (scenario) =>
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const h = harness({
            summarize: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as({ summary: "outdated" }),
              ),
          });
          const engine = yield* makeContextCompactionEngine(h.dependencies);
          yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* Deferred.await(entered);
          if (scenario === "edit")
            h.setSource({
              ...h.source(),
              messages: [message(0, "Corrected objective"), ...h.source().messages.slice(1)],
            });
          if (scenario === "runtime")
            h.setSource({ ...h.source(), runtimeSessionId: RuntimeSessionId.make("runtime-2") });
          if (scenario === "disable") h.disable();
          if (scenario === "stop") yield* engine.forget(threadId);
          yield* Deferred.succeed(release, undefined);
          yield* engine.drain;
          expect(h.published).toEqual([]);
        }),
      ),
  );

  it.effect(
    "restores a prepared checkpoint after restart, retries a failed replacement, and never reapplies a consumed checkpoint",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = harness();
          const first = yield* makeContextCompactionEngine(h.dependencies);
          yield* first.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* first.drain;
          expect(h.published[0]?.kind).toBe(CONTEXT_CHECKPOINT_ACTIVITY);
          const restored = yield* makeContextCompactionEngine(h.dependencies);
          h.setSource({
            ...h.source(),
            runtimeSessionId: RuntimeSessionId.make("replacement-runtime"),
          });
          yield* restored.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* restored.drain;
          const replacement = yield* restored.replacement(threadId, MessageId.make("message-6"));
          expect(replacement?.checkpoint.summary).toContain("Preserved requirements");
          expect(replacement).toBeDefined();
          yield* restored.applied(threadId, replacement!.checkpoint);
          const restarted = yield* makeContextCompactionEngine(h.dependencies);
          expect(
            yield* restarted.replacement(threadId, MessageId.make("message-6")),
          ).toBeUndefined();
          expect(h.published.at(-1)?.kind).toBe(CONTEXT_APPLIED_ACTIVITY);
        }),
      ),
  );

  it.effect(
    "keeps the existing context when the summarizer fails, and deduplicates usage ticks",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = harness({
            summarize: () =>
              Effect.fail(new ContextCompactionError({ detail: "provider unavailable" })),
          });
          const engine = yield* makeContextCompactionEngine(h.dependencies);
          yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* engine.observe(threadId, { usedTokens: 710, maxTokens: 1000 });
          yield* engine.drain;
          expect(h.published).toEqual([]);
          expect(h.requests).toHaveLength(1);
          yield* engine.observe(threadId, { usedTokens: 720, maxTokens: 1000 });
          yield* engine.drain;
          expect(h.requests).toHaveLength(1);
          expect(yield* engine.replacement(threadId, MessageId.make("message-6"))).toBeUndefined();
          expect(h.source().messages).toHaveLength(7);
        }),
      ),
  );

  it.effect.each(["summary", "selection"] as const)(
    "selects relevant excerpts in %s mode and summarizes them with a regular model",
    (mode) =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = harness({ mode });
          const engine = yield* makeContextCompactionEngine(h.dependencies);
          yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* engine.drain;
          const result = yield* engine.replacement(threadId, MessageId.make("message-6"));
          expect(h.decisions).toHaveLength(1);
          expect(h.decisions[0]?.modelSelection.model).toBe(
            mode === "selection" ? "classifier" : selection.model,
          );
          expect(h.requests).toHaveLength(1);
          expect(h.requests[0]?.modelSelection).toEqual(selection);
          expect(h.requests[0]?.transcript).toContain("message 2");
          expect(h.requests[0]?.transcript).not.toContain("message 0");
          expect(result?.checkpoint.summary).toBe("Preserved requirements and completed work.");
          expect(result?.checkpoint.summaryModelSelection).toEqual(selection);
        }),
      ),
  );

  it.effect.each(["failure", "missing-answer"] as const)(
    "lets the regular summarizer decide from the full segment after a selector %s",
    (scenario) =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = harness({
            mode: "selection",
            decide: () =>
              scenario === "failure"
                ? Effect.fail(new ContextCompactionError({ detail: "Decision model unavailable" }))
                : Effect.succeed({ model: "classifier", answers: {} }),
          });
          const engine = yield* makeContextCompactionEngine(h.dependencies);
          yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* engine.drain;
          expect(h.requests[0]?.modelSelection).toEqual(selection);
          expect(h.requests[0]?.transcript).toContain("message 0");
          expect(h.requests[0]?.transcript).toContain("message 3");
          expect(yield* engine.replacement(threadId, MessageId.make("message-6"))).toBeDefined();
        }),
      ),
  );

  it.effect(
    "summarizes large retained excerpts instead of overflowing a Decision Model checkpoint",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = harness({
            mode: "selection",
            decide: (request) =>
              Effect.succeed({
                model: "classifier",
                answers: Object.fromEntries(
                  Object.keys(request.questions).map((key) => [key, { choice: "keep" }]),
                ),
              }),
          });
          h.setSource({
            ...h.source(),
            messages: [
              message(0, "x".repeat(CONTEXT_SEGMENT_MAX_CHARS * 3)),
              ...h.source().messages.slice(1),
            ],
          });
          const engine = yield* makeContextCompactionEngine(h.dependencies);
          yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
          yield* engine.drain;
          expect(h.requests.length).toBeGreaterThan(3);
          expect(
            h.requests.every((request) => request.modelSelection.model === selection.model),
          ).toBe(true);
          expect(h.requests.slice(1).every((request) => request.previousSummary.length > 0)).toBe(
            true,
          );
          const ready = yield* engine.replacement(threadId, MessageId.make("message-6"));
          expect(ready?.checkpoint.summary).toBe("Preserved requirements and completed work.");
        }),
      ),
  );

  it.effect("cancels selection before it can start a summary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<DecisionGenerationResult>();
        const h = harness({
          decide: () =>
            Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
        });
        const engine = yield* makeContextCompactionEngine(h.dependencies);
        yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
        yield* Deferred.await(entered);
        yield* engine.forget(threadId);
        yield* engine.drain;
        expect(h.requests).toEqual([]);
        expect(h.published).toEqual([]);
      }),
    ),
  );

  it.effect("invalidates a checkpoint when the regular summary model changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = harness({ mode: "selection" });
        const engine = yield* makeContextCompactionEngine(h.dependencies);
        yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
        yield* engine.drain;
        h.setConfiguration({
          enabled: true,
          model: {
            selection: { instanceId: ProviderInstanceId.make("decisions"), model: "classifier" },
            mode: "selection",
            summarySelection: { ...selection, model: "other-text-model" },
          },
        });
        expect(yield* engine.replacement(threadId, MessageId.make("message-6"))).toBeUndefined();
        yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
        yield* engine.drain;
        expect(h.requests.at(-1)?.modelSelection.model).toBe("other-text-model");
      }),
    ),
  );

  it.effect("incrementally summarizes new history using the last applied checkpoint", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = harness();
        const engine = yield* makeContextCompactionEngine(h.dependencies);
        yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
        yield* engine.drain;
        const ready = yield* engine.replacement(threadId, MessageId.make("message-6"));
        yield* engine.applied(threadId, ready!.checkpoint);
        h.setSource({
          ...h.source(),
          runtimeSessionId: RuntimeSessionId.make("runtime-2"),
          messages: [...h.source().messages, message(7), message(8), message(9), message(10)],
        });
        yield* engine.observe(threadId, { usedTokens: 700, maxTokens: 1000 });
        yield* engine.drain;
        expect(h.requests).toHaveLength(2);
        expect(h.requests[1]?.previousSummary).toContain("Preserved requirements");
        expect(h.requests[1]?.transcript).not.toContain("message-0");
        expect(h.decisions[1]?.state).toContain("message-4");
        expect(h.decisions[1]?.state).not.toContain('"messageId":"message-0"');
        expect(h.requests[1]?.transcript).toContain("message-5");
      }),
    ),
  );
});

describe("context input and handoff bounds", () => {
  it("processes huge individual messages in bounded segments without dropping text", () => {
    const messages = [
      message(0, "x".repeat(CONTEXT_SEGMENT_MAX_CHARS * 7)),
      ...Array.from({ length: 80 }, (_, index) => message(index + 1)),
    ];
    const segments = [...contextTranscriptSegments(messages, 0, messages.length)];
    expect(segments.every((segment) => segment.length <= CONTEXT_SEGMENT_MAX_CHARS)).toBe(true);
    expect(segments.every((segment) => segment.split("\n").length <= 16)).toBe(true);
    expect(segments.join("").match(/x/g)?.length).toBe(CONTEXT_SEGMENT_MAX_CHARS * 7 + 81);
  });

  it("preserves recent message roles, excludes the current request, and refuses an oversized replacement", () => {
    const source = initialSource();
    const input = {
      summary: "User requires offline operation.",
      messages: source.messages,
      boundaryMessageId: MessageId.make("message-6"),
      maxChars: 20_000,
    };
    const handoff = buildContextReplacementHandoff(input);
    expect(handoff?.handoff).toContain("offline operation");
    expect(handoff?.handoff).toContain('"role":"assistant"');
    expect(handoff?.handoff).not.toContain('"messageId":"message-6"');
    expect(buildContextReplacementHandoff({ ...input, maxChars: 20 })).toBeUndefined();
  });
});
