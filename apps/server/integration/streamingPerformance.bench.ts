// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off - Native timers measure scheduling pauses independently of Effect.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeTimers from "node:timers";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  KnowledgeGraphScopeV1,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  RuntimeItemId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { makeKnowledgeGraphInventory } from "../src/knowledge-graph/extraction/KnowledgeGraphInventory.ts";
import { extractKnowledgeGraphInventoryInProcess } from "../src/knowledge-graph/extraction/KnowledgeGraphInventoryScan.ts";
import { knowledgeGraphKvLayerAt } from "../src/knowledge-graph/persistence/KnowledgeGraphKvRepository.ts";
import { KnowledgeGraphRepository } from "../src/knowledge-graph/persistence/KnowledgeGraphRepository.ts";
import * as KnowledgeGraphIndexer from "../src/knowledge-graph/runtime/KnowledgeGraphIndexer.ts";
import {
  readProviderPipelineMetrics,
  resetProviderPipelineMetrics,
  getProviderIngressTime,
} from "../src/observability/ProviderPipelineMetrics.ts";
import { makeOrchestrationIntegrationHarness } from "./OrchestrationEngineHarness.integration.ts";

class StreamingPerformanceError extends Schema.TaggedError<StreamingPerformanceError>()(
  "StreamingPerformanceError",
  { message: Schema.String },
) {}

const decodeKnowledgeGraphScope = Schema.decodeUnknownEffect(KnowledgeGraphScopeV1);
const encodeBenchmarkResult = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const FILE_COUNT = 6_000;
const STREAM_COUNT = 4;
const MIN_DELTAS_PER_STREAM = 500;
const ARRIVAL_INTERVAL_MS = 5;
const HEARTBEAT_INTERVAL_MS = 10;

// Native timers measure event-loop pauses independently of the Effect scheduler.
function startHeartbeat(onTick: () => void) {
  return NodeTimers.setInterval(onTick, HEARTBEAT_INTERVAL_MS);
}

const makeFullGraphIndex = Effect.fn("makeFullGraphIndex")(function* (
  scope: KnowledgeGraphScopeV1,
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-full-graph-benchmark-")),
    ),
    (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
  );
  const context = yield* Layer.build(
    KnowledgeGraphIndexer.layer.pipe(Layer.provideMerge(knowledgeGraphKvLayerAt(directory))),
  );
  const indexer = Context.get(context, KnowledgeGraphIndexer.KnowledgeGraphIndexer);
  const repository = Context.get(context, KnowledgeGraphRepository);
  return {
    run: Effect.gen(function* () {
      const commit = yield* indexer.indexScope(scope);
      if (Option.isNone(commit))
        return yield* new StreamingPerformanceError({
          message: "The full graph was not committed.",
        });
      const status = yield* repository.getStatus(scope.scopeId);
      if (Option.isNone(status))
        return yield* new StreamingPerformanceError({
          message: "The committed graph has no status.",
        });
      return {
        files: status.value.indexedFileCount,
        nodes: status.value.nodeCount,
        revision: status.value.revision,
      };
    }),
  };
});

export const runStreamingPerformanceBenchmark = Effect.fn("runStreamingPerformanceBenchmark")(
  function* (mode: "worker" | "cooperative" | "full", runs = 3) {
    const temporaryRoot = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-stream-benchmark-"))),
      (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
    );
    const workspaceRoot = yield* Effect.promise(() => NodeFSP.realpath(temporaryRoot));
    for (let offset = 0; offset < FILE_COUNT; offset += 64) {
      yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: Math.min(64, FILE_COUNT - offset) }, (_, index) => {
            const file = offset + index;
            const declarations = Array.from(
              { length: 18 },
              (_, symbol) => "export const value" + symbol + " = " + symbol + ";\n",
            ).join("");
            return NodeFSP.writeFile(
              NodePath.join(workspaceRoot, "file" + file + ".ts"),
              "import './file" + ((file + 1) % FILE_COUNT) + "';\n" + declarations,
            );
          }),
        ),
      );
    }
    const scope = yield* decodeKnowledgeGraphScope({
      version: 1,
      scopeId: "kg:streaming-performance",
      environmentId: "benchmark",
      projectId: "benchmark",
      effectiveWorkspaceRoot: workspaceRoot,
      isWorktree: false,
    });
    const inventory = yield* makeKnowledgeGraphInventory;
    const results = [];
    for (let run = 1; run <= runs; run += 1) {
      const measurement = yield* Effect.acquireUseRelease(
        makeOrchestrationIntegrationHarness({ serverSettings: { responseStreamingMode: "token" } }),
        (harness) =>
          Effect.gen(function* () {
            const fullIndex = mode === "full" ? yield* makeFullGraphIndex(scope) : undefined;
            const projectId = ProjectId.make("streaming-project");
            const provider = ProviderDriverKind.make("codex");
            const modelSelection = {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5-codex",
            };
            const now = DateTime.formatIso(yield* DateTime.now);
            yield* harness.engine.dispatch({
              type: "project.create",
              commandId: CommandId.make("project-create"),
              projectId,
              title: "Streaming benchmark",
              workspaceRoot: harness.workspaceDir,
              defaultModelSelection: modelSelection,
              createdAt: now,
            });
            yield* harness.engine.dispatch({
              type: "project.meta.update",
              commandId: CommandId.make("project-config"),
              projectId,
              checkpointsEnabled: false,
            });
            const threads = Array.from({ length: STREAM_COUNT }, (_, index) => ({
              threadId: ThreadId.make("stream-" + index),
              turnId: TurnId.make("turn-" + index),
              text: [] as string[],
            }));
            for (const thread of threads) {
              yield* harness.engine.dispatch({
                type: "thread.create",
                commandId: CommandId.make("create-" + thread.threadId),
                threadId: thread.threadId,
                projectId,
                title: thread.threadId,
                modelSelection,
                interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                runtimeMode: "approval-required",
                branch: null,
                worktreePath: null,
                createdAt: now,
              });
              yield* harness.providerService.startSession(thread.threadId, {
                threadId: thread.threadId,
                provider,
                providerInstanceId: modelSelection.instanceId,
                modelSelection,
                cwd: harness.workspaceDir,
                runtimeMode: "approval-required",
              });
            }
            const committedEventLatencies: number[] = [];
            let recording = false;
            const completed = yield* Deferred.make<void>();
            const completedThreads = new Set<string>();
            const events = yield* harness.engine.subscribeDomainEvents;
            yield* events.pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  const ingressAt = getProviderIngressTime(event);
                  if (recording && ingressAt !== undefined)
                    committedEventLatencies.push(performance.now() - ingressAt);
                  if (
                    event.type !== "thread.message-sent" ||
                    event.payload.role !== "assistant" ||
                    event.payload.streaming
                  )
                    return;
                  completedThreads.add(event.payload.threadId);
                  if (completedThreads.size === STREAM_COUNT)
                    yield* Deferred.succeed(completed, undefined);
                }),
              ),
              Effect.forkScoped({ startImmediately: true }),
            );
            let indexing = true;
            let maxEventLoopGapMs = 0;
            let previous = performance.now();
            const heartbeat = yield* Effect.acquireRelease(
              Effect.sync(() =>
                startHeartbeat(() => {
                  const current = performance.now();
                  maxEventLoopGapMs = Math.max(maxEventLoopGapMs, current - previous);
                  previous = current;
                }),
              ),
              (timer) => Effect.sync(() => NodeTimers.clearInterval(timer)),
            );
            const startedAt = performance.now();
            resetProviderPipelineMetrics();
            recording = true;
            const input = {
              scope,
              workspaceRoot,
              coChangeGroups: [] as readonly (readonly string[])[],
              seenGeneration: run,
            };
            const graphFiber = yield* Effect.gen(function* () {
              if (fullIndex !== undefined) return yield* fullIndex.run;
              const graph = yield* mode === "worker"
                ? inventory.extract(input)
                : extractKnowledgeGraphInventoryInProcess(input);
              return {
                files: graph.fileFingerprints.length,
                nodes: graph.nodes.length,
                revision: undefined,
              };
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  indexing = false;
                }),
              ),
              Effect.forkScoped,
            );
            const streamFibers = yield* Effect.forEach(threads, (thread) =>
              Effect.gen(function* () {
                const base = {
                  provider,
                  threadId: thread.threadId,
                  turnId: thread.turnId,
                  createdAt: now,
                };
                const publish = harness.adapterHarness!.publishEvent;
                yield* publish({
                  ...base,
                  type: "turn.started",
                  eventId: EventId.make(thread.threadId + ":started"),
                  payload: {},
                });
                let count = 0;
                yield* Stream.fromAsyncIterable(
                  NodeTimersPromises.setInterval(ARRIVAL_INTERVAL_MS),
                  (cause) => new StreamingPerformanceError({ message: String(cause) }),
                ).pipe(
                  Stream.mapEffect(() =>
                    Effect.gen(function* () {
                      const delta = "text" + count + " ";
                      thread.text.push(delta);
                      yield* publish({
                        ...base,
                        type: "content.delta",
                        eventId: EventId.make(thread.threadId + ":" + count),
                        itemId: RuntimeItemId.make("message-" + thread.threadId),
                        payload: { streamKind: "assistant_text", delta },
                      });
                      count += 1;
                    }),
                  ),
                  Stream.takeUntil(() => !indexing && count >= MIN_DELTAS_PER_STREAM),
                  Stream.runDrain,
                );
                yield* publish({
                  ...base,
                  type: "turn.completed",
                  eventId: EventId.make(thread.threadId + ":completed"),
                  payload: { state: "completed" },
                });
              }).pipe(Effect.forkScoped),
            );
            yield* Effect.forEach(streamFibers, Fiber.join);
            const graph = yield* Fiber.join(graphFiber);
            yield* Deferred.await(completed);
            yield* harness.drainProviderRuntime;
            recording = false;
            NodeTimers.clearInterval(heartbeat);
            maxEventLoopGapMs = Math.max(maxEventLoopGapMs, performance.now() - previous);
            for (const thread of threads) {
              const snapshot = yield* harness.snapshotQuery.getThreadDetailById(thread.threadId);
              const value = snapshot._tag === "Some" ? snapshot.value : undefined;
              const actual = value?.messages
                .filter((message) => message.role === "assistant")
                .map((message) => message.text)
                .join("");
              if (actual !== thread.text.join(""))
                return yield* new StreamingPerformanceError({
                  message: "Streaming text diverged for " + thread.threadId,
                });
            }
            const durations = readProviderPipelineMetrics().durations;
            const histogram = durations.find((value) => value.key === "ingress_to_commit:unknown");
            if (!histogram || histogram.count === 0)
              return yield* new StreamingPerformanceError({
                message: "No ingress-to-commit measurements.",
              });
            const p95UpperBoundMs =
              histogram.buckets.find(([, count]) => count >= histogram.count * 0.95)?.[0] ?? null;
            committedEventLatencies.sort((left, right) => left - right);
            const p95EventMs =
              committedEventLatencies[Math.ceil(committedEventLatencies.length * 0.95) - 1];
            if (p95EventMs === undefined)
              return yield* new StreamingPerformanceError({
                message: "No observed committed events.",
              });
            const result = {
              ingressToCommittedEventP95Ms: Math.round(p95EventMs * 100) / 100,
              committedEventCount: committedEventLatencies.length,
              mode,
              run,
              files: graph.files,
              nodes: graph.nodes,
              ...(graph.revision !== undefined
                ? { graphRevision: graph.revision, graphPersistence: "rocksdb" }
                : {}),
              streams: STREAM_COUNT,
              deltas: threads.reduce((sum, thread) => sum + thread.text.length, 0),
              elapsedMs: Math.round(performance.now() - startedAt),
              maxEventLoopGapMs: Math.round(maxEventLoopGapMs),
              ingressToCommitCount: histogram.count,
              ingressToCommitP95UpperBoundMs: p95UpperBoundMs,
            };
            const encoded = yield* encodeBenchmarkResult(result);
            process.stdout.write(encoded + "\n");
            return result;
          }),
        (harness) => harness.dispose,
      ).pipe(Effect.scoped);
      results.push(measurement);
    }
    return results;
  },
);

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  const mode = process.argv.includes("--full")
    ? "full"
    : process.argv.includes("--cooperative")
      ? "cooperative"
      : "worker";
  await Effect.runPromise(
    runStreamingPerformanceBenchmark(mode).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}
