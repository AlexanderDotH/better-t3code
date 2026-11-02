import { providerResponseMetrics } from "../ResponseMetrics.ts";
import { McpRuntimeRegistry } from "../../mcp/McpRuntimeRegistry.ts";
import {
  makeNativeProviderMcpRuntime,
  type NativeProviderMcpRuntimeSession,
} from "./NativeProviderMcpRuntime.ts";
import { makeProviderTextDeltaCoalescer } from "../../orchestration-v2/Adapters/ProviderTextDeltaCoalescer.ts";
import {
  makeBoundedProviderEventQueue,
  PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
  PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
  providerEventEncodedBytes,
} from "../boundedEventQueue.ts";
import { modelFacingNativeProviderToolResult } from "./NativeProviderToolResult.ts";
import { failedNativeHarnessToolResult } from "./NativeHarnessToolResults.ts";
import * as Option from "effect/Option";
import * as ResourceProtection from "../../resourceProtection/SubagentResourceGovernor.ts";
import { makeSharedNativeProviderTurnAdmission } from "./NativeProviderTurnAdmission.ts";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import {
  RuntimeSessionId,
  TurnId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2RuntimeRequest,
  type ProviderApprovalDecision,
  type ProviderSession,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2TurnItem,
  type RuntimeRequestId,
} from "@t3tools/contracts";
import * as Adapter from "@t3tools/provider-core/server/ProviderAdapter";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import { IdAllocatorV2 } from "@t3tools/provider-core/server/IdAllocator";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { turnScopedSelectionTransition } from "@t3tools/provider-core/server/selectionTransition";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ProviderAdapterRequestError } from "../Errors.ts";
import { makeNativeHarnessHistoryFiles } from "./NativeHarnessHistory.ts";
import { NATIVE_PROVIDER_CAPABILITIES } from "./NativeProviderCapabilities.ts";
import type {
  NativeProviderAdapterDefinition,
  NativeProviderExecutedToolCall,
  NativeProviderSessionView,
  NativeProviderToolCall,
  NativeProviderTurnRecord,
} from "./NativeProviderTypes.ts";

export type * from "./NativeProviderTypes.ts";

const NATIVE_PROVIDER_TEXT_FLUSH_INTERVAL_MS = 50;
const NATIVE_PROVIDER_MAX_TOOL_ROUNDS = 128;
const encodeHistoryForSize = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

function sandboxModeForPolicy(policy: Adapter.ProviderAdapterV2RuntimePolicy) {
  const sandbox =
    typeof policy.sandboxPolicy === "object" &&
    policy.sandboxPolicy !== null &&
    "type" in policy.sandboxPolicy
      ? policy.sandboxPolicy.type
      : undefined;
  if (
    policy.commandExecutionPolicy === "deny" ||
    policy.interactionMode === "plan" ||
    sandbox === "read-only" ||
    sandbox === "readOnly"
  )
    return "read-only" as const;
  if (sandbox === "workspaceWrite" || sandbox === "workspace-write")
    return "workspace-write" as const;
  return policy.runtimeMode === "full-access"
    ? ("danger-full-access" as const)
    : ("workspace-write" as const);
}

export const makeNativeProviderAdapter = Effect.fn("makeNativeProviderAdapter")(function* <
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
>(
  definition: NativeProviderAdapterDefinition<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >,
) {
  const host = yield* ProviderHost;
  const governor = Option.getOrUndefined(
    yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor),
  );
  const admission =
    definition.admission ??
    (governor
      ? makeSharedNativeProviderTurnAdmission({ provider: definition.provider, governor })
      : undefined);
  const ids = yield* IdAllocatorV2;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const driver = definition.provider;
  const mcpRegistry = Option.getOrUndefined(yield* Effect.serviceOption(McpRuntimeRegistry));
  const mcpRegistration = host.mcpRuntime ?? mcpRegistry;
  const adapterScope = yield* Effect.scope;
  let mcpAdapterRegistered = false;
  const mcpSessions = new Map<
    import("@t3tools/contracts").ThreadId,
    NativeProviderMcpRuntimeSession
  >();
  const mcpRuntime = definition.mcp
    ? makeNativeProviderMcpRuntime({
        driver,
        instanceId: definition.instanceId,
        host,
        configuration: definition.mcp,
        findSession: (threadId) => mcpSessions.get(threadId),
        releaseThread: definition.toolHarness.releaseThread,
      })
    : undefined;
  const capabilities = {
    ...NATIVE_PROVIDER_CAPABILITIES,
    deepPlan: definition.capabilities.deepPlan ?? {
      supported: false as const,
      reason: "This provider does not support Deep Plan.",
    },
    tools: {
      ...NATIVE_PROVIDER_CAPABILITIES.tools,
      supportsMcpTools:
        definition.capabilities.mcp !== undefined && definition.capabilities.mcp !== "unsupported",
    },
  };
  const sessions = new Set<() => Effect.Effect<void>>();
  const openingSessions = new Set<symbol>();
  const workingSets = new Map<
    symbol,
    {
      readonly isLoaded: () => boolean;
      readonly isActive: () => boolean;
      readonly evict: () => void;
    }
  >();
  const trimWorkingSets = (protectedSlot: symbol) => {
    const limit = definition.limits.maxIdleWorkingSets;
    if (limit === undefined) return;
    let excess = [...workingSets.values()].filter((entry) => entry.isLoaded()).length - limit;
    for (const [slot, entry] of workingSets) {
      if (excess <= 0) break;
      if (slot !== protectedSlot && entry.isLoaded() && !entry.isActive()) {
        entry.evict();
        excess--;
      }
    }
  };
  const protocolError = (detail: string, cause?: unknown) =>
    new Adapter.ProviderAdapterProtocolError({ driver, detail, cause });
  const historyFiles = yield* makeNativeHarnessHistoryFiles(
    path.join(
      host.paths.stateDir,
      "provider-sessions",
      definition.history.directoryName.replace(/[^a-z0-9._-]+/giu, "_"),
      definition.instanceId.replace(/[^a-z0-9._-]+/giu, "_"),
    ),
  );
  const adapter = Adapter.ProviderAdapterV2.of({
    instanceId: definition.instanceId,
    driver,
    getCapabilities: Effect.fn("NativeProviderAdapter.getCapabilities")(() =>
      Effect.succeed(capabilities),
    ),
    planSelectionTransition: Effect.fn("NativeProviderAdapter.planSelectionTransition")(() =>
      Effect.succeed(turnScopedSelectionTransition()),
    ),
    openSession: Effect.fn("NativeProviderAdapter.openSession")(function* (input) {
      if (
        definition.limits.maxSessions !== undefined &&
        sessions.size + openingSessions.size >= definition.limits.maxSessions
      )
        return yield* new Adapter.ProviderAdapterOpenSessionError({
          driver,
          providerSessionId: input.providerSessionId,
          cause: "Provider session limit reached",
        });
      const scope = yield* Effect.scope;
      if (mcpRegistration && mcpRuntime && !mcpAdapterRegistered) {
        yield* mcpRegistration
          .registerAdapter(definition.instanceId, {
            capabilities: { mcp: definition.capabilities.mcp ?? "unsupported" },
            mcpRuntime: mcpRuntime.adapter,
          })
          .pipe(Effect.provideService(Scope.Scope, adapterScope));
        mcpAdapterRegistered = true;
      }
      const slot = Symbol();
      openingSessions.add(slot);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          openingSessions.delete(slot);
        }),
      );
      let workingSetLoaded = true;
      const events = yield* makeBoundedProviderEventQueue<Adapter.ProviderAdapterV2Event>({
        capacity: PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
        byteCapacity: PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
        sizeOf: providerEventEncodedBytes,
      });
      const openNodes = new Map<string, OrchestrationV2ExecutionNode>();
      const openItems = new Map<string, OrchestrationV2TurnItem>();
      const openMessages = new Map<string, OrchestrationV2ConversationMessage>();
      // Streaming records already belong to the provider turn span.
      const emit = Effect.fnUntraced(function* (event: Adapter.ProviderAdapterV2Event) {
        if (event.type === "node.updated") {
          if (event.node.status === "running" || event.node.status === "waiting")
            openNodes.set(event.node.id, event.node);
          else openNodes.delete(event.node.id);
        } else if (event.type === "turn_item.updated") {
          if (event.turnItem.status === "running" || event.turnItem.status === "waiting")
            openItems.set(event.turnItem.id, event.turnItem);
          else openItems.delete(event.turnItem.id);
        } else if (event.type === "message.updated") {
          if (event.message.streaming) openMessages.set(event.message.id, event.message);
          else openMessages.delete(event.message.id);
        }
        yield* events.offer(event);
      });
      const createdAt = yield* DateTime.now;
      let cwd = input.runtimePolicy.cwd ?? host.paths.cwd;
      let fetchWorker = input.runtimePolicy.commandExecutionPolicy === "deny";
      let sandboxMode = sandboxModeForPolicy(input.runtimePolicy);
      const started = yield* definition
        .start({
          input: {
            threadId: input.threadId,
            providerInstanceId: definition.instanceId,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimePolicy.runtimeMode,
            cwd,
            sandboxMode,
          },
          fetchWorker,
        })
        .pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              openingSessions.delete(slot);
            }),
          ),
          Effect.mapError(
            (cause) =>
              new Adapter.ProviderAdapterOpenSessionError({
                driver,
                providerSessionId: input.providerSessionId,
                cause,
              }),
          ),
        );
      const providerSession = {
        id: input.providerSessionId,
        driver,
        providerInstanceId: definition.instanceId,
        status: "ready" as const,
        cwd,
        model: started.model,
        capabilities,
        createdAt,
        updatedAt: createdAt,
        lastError: null,
      };
      const protocolSession: ProviderSession = {
        provider: driver,
        threadId: input.threadId,
        providerInstanceId: definition.instanceId,
        runtimeSessionId: RuntimeSessionId.make(input.providerSessionId),
        status: "ready",
        runtimeMode: input.runtimePolicy.runtimeMode,
        model: started.model,
        cwd,
        createdAt: DateTime.formatIso(createdAt),
        updatedAt: DateTime.formatIso(createdAt),
      };
      let thread: OrchestrationV2ProviderThread | undefined;
      let history: Array<HistoryItem> = [];
      let records: Array<NativeProviderTurnRecord> = [];
      let totalProcessedTokens = 0;
      const turns = new Map<string, OrchestrationV2ProviderTurn>();
      const messages = new Map<string, OrchestrationV2ConversationMessage>();
      const approvedTools = new Set<string>();
      const approvals = new Map<
        string,
        {
          request: OrchestrationV2RuntimeRequest;
          decision: Deferred.Deferred<ProviderApprovalDecision>;
          node: OrchestrationV2ExecutionNode;
        }
      >();
      let active: { fiber: Fiber.Fiber<void, never>; done: Deferred.Deferred<void> } | undefined;
      const view = (): NativeProviderSessionView<HistoryItem, SessionState> => ({
        threadId: thread?.appThreadId ?? input.threadId,
        sessionId: thread?.nativeThreadRef?.nativeId ?? input.providerSessionId,
        cwd,
        sandboxMode,
        fetchWorker,
        session: protocolSession,
        history,
        state: started.state,
      });
      const persist = Effect.fn("NativeProviderAdapter.persist")(function* () {
        if (!thread?.nativeThreadRef) return;
        const encoded = yield* Effect.try({
          try: () =>
            definition.history.encode({
              sessionId: thread!.nativeThreadRef!.nativeId!,
              history,
              turns: records,
              totalProcessedTokens,
            }),
          catch: (cause) => protocolError("Could not encode provider history", cause),
        });
        yield* historyFiles
          .write(thread.nativeThreadRef.nativeId!, encoded)
          .pipe(
            Effect.mapError((cause) => protocolError("Could not persist provider history", cause)),
          );
      });
      const load = Effect.fn("NativeProviderAdapter.load")(function* (
        target: OrchestrationV2ProviderThread,
      ) {
        const nativeId = target.nativeThreadRef?.nativeId;
        if (!nativeId) return yield* protocolError("Provider history identifier is missing");
        const encoded = yield* historyFiles
          .read(nativeId)
          .pipe(
            Effect.mapError((cause) => protocolError("Could not load provider history", cause)),
          );
        if (encoded === undefined) return yield* protocolError("Provider history is missing");
        const restored = yield* definition.history
          .decode(encoded, nativeId)
          .pipe(
            Effect.mapError((cause) => protocolError("Could not decode provider history", cause)),
          );
        if (!restored) return yield* protocolError("Provider history is invalid");
        history = [...restored.history];
        records = [...restored.turns];
        totalProcessedTokens = restored.totalProcessedTokens;
        workingSetLoaded = true;
        thread = {
          ...target,
          providerSessionId: input.providerSessionId,
          status: "idle",
          updatedAt: yield* DateTime.now,
        };
        return thread!;
      });
      const snapshot = () => ({
        providerThread: thread!,
        providerTurns: [...turns.values()],
        messages: [...messages.values()],
        runtimeRequests: [...approvals.values()].map((pending) => pending.request),
      });
      const ensureThread: Adapter.ProviderAdapterV2SessionRuntime["ensureThread"] = Effect.fn(
        "NativeProviderAdapter.ensureThread",
      )(function* (request) {
        if (thread && !request.forceNewNativeThread) return thread!;
        if (request.existingProviderThread && !request.forceNewNativeThread)
          return yield* load(request.existingProviderThread);
        const nativeId = yield* randomUuidV4.pipe(
          Effect.mapError((cause) => protocolError("Could not allocate provider history", cause)),
        );
        const time = yield* DateTime.now;
        thread = {
          id: ids.derive.providerThread({
            driver,
            providerInstanceId: definition.instanceId,
            nativeThreadId: nativeId,
          }),
          driver,
          providerInstanceId: definition.instanceId,
          providerSessionId: input.providerSessionId,
          appThreadId: request.threadId,
          ownerNodeId: null,
          nativeThreadRef: { driver, nativeId, strength: "strong" },
          nativeConversationHeadRef: null,
          status: "idle",
          firstRunOrdinal: null,
          lastRunOrdinal: null,
          handoffIds: [],
          forkedFrom: null,
          createdAt: time,
          updatedAt: time,
        };
        history = [];
        records = [];
        yield* persist();
        return thread!;
      });
      const startTurn: Adapter.ProviderAdapterV2SessionRuntime["startTurn"] = Effect.fn(
        "NativeProviderAdapter.startTurn",
      )(function* (request) {
        if (active) return yield* protocolError("The previous provider turn is still active");
        if (!thread || thread.id !== request.providerThread.id || !workingSetLoaded)
          yield* load(request.providerThread);
        const workingSet = workingSets.get(slot);
        if (workingSet) {
          workingSets.delete(slot);
          workingSets.set(slot, workingSet);
        }
        cwd = request.runtimePolicy.cwd ?? host.paths.cwd;
        fetchWorker = request.runtimePolicy.commandExecutionPolicy === "deny";
        sandboxMode = sandboxModeForPolicy(request.runtimePolicy);
        Object.assign(protocolSession, {
          model: request.modelSelection.model,
          runtimeMode: request.runtimePolicy.runtimeMode,
          cwd,
        });
        const turnId = ids.derive.providerTurn({
          driver,
          nativeTurnId: `${definition.instanceId}:${request.attemptId}:${request.providerTurnOrdinal}`,
        });
        const startedAt = yield* DateTime.now;
        let providerTurn: OrchestrationV2ProviderTurn = {
          id: turnId,
          providerThreadId: request.providerThread.id,
          nodeId: request.rootNodeId,
          runAttemptId: request.attemptId,
          nativeTurnRef: null,
          ordinal: request.providerTurnOrdinal,
          status: "running",
          startedAt,
          completedAt: null,
        };
        const turnUsage = {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        };
        let usageReceived = false;
        let usageComplete = true;
        let activeModel = request.modelSelection.model;
        let hasSubagents = false;
        let firstTokenAt: DateTime.Utc | undefined;
        let ordinal = 0;
        const baseItem = (key: string) => {
          const nativeItemId = `${turnId}:${key}`;
          return {
            id: ids.derive.turnItemFromProviderItem({ driver, nativeItemId }),
            nodeId: ids.derive.nodeFromProviderItem({ driver, nativeItemId }),
            threadId: request.threadId,
            runId: request.runId,
            providerThreadId: request.providerThread.id,
            providerTurnId: turnId,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: ++ordinal,
            startedAt,
            updatedAt: startedAt,
            completedAt: null,
            title: null,
          };
        };
        const makeNode = (
          base: Pick<ReturnType<typeof baseItem>, "nodeId" | "startedAt" | "updatedAt">,
          kind: OrchestrationV2ExecutionNode["kind"],
          status: OrchestrationV2ExecutionNode["status"],
          requestId: RuntimeRequestId | null = null,
        ): OrchestrationV2ExecutionNode => ({
          id: base.nodeId,
          threadId: request.threadId,
          runId: request.runId,
          parentNodeId: request.rootNodeId,
          rootNodeId: request.rootNodeId,
          kind,
          status,
          countsForRun: false,
          providerThreadId: request.providerThread.id,
          providerTurnId: turnId,
          nativeItemRef: null,
          runtimeRequestId: requestId,
          checkpointScopeId: null,
          startedAt: base.startedAt,
          completedAt: status === "running" || status === "waiting" ? null : base.updatedAt,
        });
        const done = yield* Deferred.make<void>();

        const preTurnHistory = [...history];
        const preTurnCount = records.length;
        let historyStart = history.length;
        const program = Effect.gen(function* () {
          const signal = yield* Effect.abortSignal;
          turns.set(turnId, providerTurn);
          if (thread) {
            thread = {
              ...thread,
              status: "active",
              firstRunOrdinal: thread.firstRunOrdinal ?? request.runOrdinal,
              lastRunOrdinal: request.runOrdinal,
              updatedAt: startedAt,
            };
            yield* emit({ type: "provider_thread.updated", driver, providerThread: thread });
          }
          yield* emit({ type: "provider_turn.updated", driver, providerTurn });
          const plan = yield* definition.prepareTurn({
            input: {
              threadId: request.threadId,
              input: [...(request.appContext ?? []).map((part) => part.text), request.message.text]
                .filter(Boolean)
                .join("\n\n"),
              attachments: request.message.attachments,
              modelSelection: request.modelSelection,
              interactionMode: request.runtimePolicy.interactionMode,
            },
            session: view(),
            readAttachment: (attachment) => {
              const target = host.resolveAttachmentPath(attachment);
              return target
                ? fileSystem.readFile(target).pipe(
                    Effect.mapError(
                      (cause) =>
                        new ProviderAdapterRequestError({
                          provider: driver,
                          method: "attachment/read",
                          detail: "Could not read attachment",
                          cause,
                        }),
                    ),
                  )
                : Effect.fail(
                    new ProviderAdapterRequestError({
                      provider: driver,
                      method: "attachment/read",
                      detail: "Attachment is missing",
                    }),
                  );
            },
          });
          activeModel = plan.model;
          if (plan.toolDeclarations.length > definition.limits.maxToolDefinitions)
            return yield* protocolError("Provider tool catalog exceeds the configured limit");
          history.push(...plan.userHistoryItems);
          let persistedUserIndex: number | undefined = historyStart;
          let roundCount = 0;
          while (true) {
            if (++roundCount > NATIVE_PROVIDER_MAX_TOOL_ROUNDS)
              return yield* protocolError("Provider tool loop exceeded its round limit");
            const before = yield* (
              definition.beforeRound?.({ session: view(), plan }) ?? Effect.void
            );
            if (before?.replacementHistory) {
              history = [...before.replacementHistory];
              persistedUserIndex = undefined;
            }
            if (before?.resetTurnHistoryStart) historyStart = 0;
            let complete:
              | Extract<
                  import("./NativeProviderTypes.ts").NativeProviderRoundEvent<
                    HistoryItem,
                    ToolCall
                  >,
                  { type: "completed" }
                >
              | undefined;
            const content = new Map<
              string,
              { base: ReturnType<typeof baseItem>; text: string; kind: "assistant" | "reasoning" }
            >();
            const publishContent = Effect.fn("NativeProviderAdapter.publishContent")(function* (
              entry: {
                base: ReturnType<typeof baseItem>;
                text: string;
                kind: "assistant" | "reasoning";
              },
              streaming: boolean,
            ) {
              const time = yield* DateTime.now;
              const base = {
                ...entry.base,
                status: streaming ? ("running" as const) : ("completed" as const),
                updatedAt: time,
                completedAt: streaming ? null : time,
              };
              yield* emit({
                type: "node.updated",
                driver,
                node: makeNode(
                  base,
                  entry.kind === "assistant" ? "assistant_message" : "reasoning",
                  base.status,
                ),
              });
              if (entry.kind === "assistant") {
                const messageId = ids.derive.messageFromProviderItem({
                  driver,
                  nativeItemId: entry.base.id,
                });
                const message: OrchestrationV2ConversationMessage = {
                  id: messageId,
                  threadId: request.threadId,
                  runId: request.runId,
                  nodeId: base.nodeId,
                  role: "assistant",
                  text: entry.text,
                  attachments: [],
                  streaming,
                  createdBy: "agent",
                  creationSource: "provider",
                  createdAt: startedAt,
                  updatedAt: time,
                };
                messages.set(messageId, message);
                yield* emit({ type: "message.updated", driver, message });
                yield* emit({
                  type: "turn_item.updated",
                  driver,
                  turnItem: {
                    ...base,
                    type: "assistant_message",
                    messageId,
                    text: entry.text,
                    streaming,
                  },
                });
              } else
                yield* emit({
                  type: "turn_item.updated",
                  driver,
                  turnItem: { ...base, type: "reasoning", text: entry.text, streaming },
                });
            });
            const deltas = yield* makeProviderTextDeltaCoalescer({
              flushIntervalMs: NATIVE_PROVIDER_TEXT_FLUSH_INTERVAL_MS,
              emit: (update) => {
                const entry = content.get(update.itemId);
                return entry
                  ? publishContent({ ...entry, text: update.text }, !update.completed)
                  : Effect.void;
              },
            });
            yield* Effect.addFinalizer(() => deltas.flushTurn(turnId));
            yield* definition
              .streamRound({ session: view(), plan, turnId: TurnId.make(turnId), signal })
              .pipe(
                Stream.runForEach(
                  Effect.fn("NativeProviderAdapter.operation")(function* (event) {
                    if (complete !== undefined)
                      return yield* protocolError("Provider emitted content after its completion");
                    if (event.type === "failed") return yield* protocolError(event.message);
                    if (event.type === "completed") {
                      complete = event;
                      return;
                    }
                    if (firstTokenAt === undefined && event.delta.length > 0)
                      firstTokenAt = yield* DateTime.now;
                    const key = `${event.kind}:${event.sourceId ?? "default"}`;
                    let entry = content.get(key);
                    if (!entry) {
                      entry = {
                        base: baseItem(`content:${ordinal}:${key}`),
                        text: "",
                        kind: event.kind,
                      };
                      content.set(key, entry);
                    }
                    entry.text += event.delta;
                    yield* deltas.append({ turnId, itemId: key, delta: event.delta });
                  }),
                ),
              );
            if (!complete)
              return yield* protocolError("Provider stream ended without a completion");
            if (
              ![...content.values()].some((entry) => entry.kind === "assistant") &&
              complete.assistantText
            )
              content.set("assistant:completed", {
                base: baseItem(`content:${ordinal}:assistant`),
                text: complete.assistantText,
                kind: "assistant",
              });
            if (
              ![...content.values()].some((entry) => entry.kind === "reasoning") &&
              complete.reasoningText
            )
              content.set("reasoning:completed", {
                base: baseItem(`content:${ordinal}:reasoning`),
                text: complete.reasoningText,
                kind: "reasoning",
              });
            for (const [key, entry] of content)
              yield* deltas.complete({ turnId, itemId: key, finalText: entry.text });
            history.push(...complete.historyItems);
            if (!complete.usage) usageComplete = false;
            if (
              complete.toolCalls.some((call) =>
                /(^|[._])(spawn_agent|Agent|subagent_spawn|spawn_agents_on_csv)$/u.test(call.name),
              )
            )
              hasSubagents = true;
            if (complete.usage) {
              usageReceived = true;
              turnUsage.inputTokens += complete.usage.inputTokens;
              turnUsage.outputTokens += complete.usage.outputTokens;
              turnUsage.cachedInputTokens += complete.usage.cachedInputTokens;
              turnUsage.reasoningTokens += complete.usage.reasoningOutputTokens;
              totalProcessedTokens += complete.usage.usedTokens;
              providerTurn = Object.assign({}, providerTurn, {
                tokenUsage: {
                  usedTokens: complete.usage.usedTokens,
                  inputTokens: complete.usage.inputTokens,
                  cachedInputTokens: complete.usage.cachedInputTokens,
                  outputTokens: complete.usage.outputTokens,
                  reasoningOutputTokens: complete.usage.reasoningOutputTokens,
                  updatedAt: DateTime.formatIso(yield* DateTime.now),
                },
              });
            }
            if (!complete.toolCalls.length) break;
            const results = yield* Effect.forEach(
              complete.toolCalls,
              Effect.fn("NativeProviderAdapter.operation")(function* (call) {
                const base = baseItem(`tool:${ordinal}:${call.sourceId ?? call.name}`);
                yield* emit({
                  type: "node.updated",
                  driver,
                  node: makeNode(base, "tool_call", "running"),
                });
                yield* emit({
                  type: "turn_item.updated",
                  driver,
                  turnItem: {
                    ...base,
                    type: "dynamic_tool",
                    toolName: call.name,
                    input: call.args,
                    status: "running",
                  },
                });
                if (
                  !(yield* definition.toolHarness.isAvailable({
                    threadId: request.threadId,
                    cwd,
                    toolName: call.name,
                    interactionMode: request.runtimePolicy.interactionMode,
                    sandboxMode,
                    fetchWorker,
                  }))
                )
                  return yield* protocolError(`Tool '${call.name}' is unavailable`);
                let denied = false;
                if (
                  !approvedTools.has(call.name) &&
                  definition.toolHarness.requiresApproval(
                    call.name,
                    request.runtimePolicy.runtimeMode,
                  )
                ) {
                  const requestId = yield* ids.allocate
                    .runtimeRequest({
                      driver,
                      providerTurnId: turnId,
                      nativeRequestId: call.sourceId ?? call.name,
                    })
                    .pipe(
                      Effect.mapError((cause) =>
                        protocolError("Could not allocate approval", cause),
                      ),
                    );
                  const decision = yield* Deferred.make<ProviderApprovalDecision>();
                  const nativeKind = definition.toolHarness.requestType(call.name);
                  const requestKind =
                    nativeKind === "file_read_approval"
                      ? ("file-read" as const)
                      : nativeKind === "file_change_approval" ||
                          nativeKind === "apply_patch_approval"
                        ? ("file-change" as const)
                        : nativeKind === "mcp_elicitation_approval"
                          ? ("mcp-elicitation" as const)
                          : nativeKind === "permission_approval"
                            ? ("permission" as const)
                            : ("command" as const);
                  const approvalBase = baseItem(`approval:${requestId}`);
                  const approvalNode = makeNode(
                    approvalBase,
                    "approval_request",
                    "waiting",
                    requestId,
                  );
                  const approval: OrchestrationV2RuntimeRequest = {
                    id: requestId,
                    nodeId: approvalBase.nodeId,
                    providerTurnId: turnId,
                    nativeRequestRef: null,
                    kind: requestKind,
                    status: "pending",
                    responseCapability: {
                      type: "live",
                      providerSessionId: input.providerSessionId,
                    },
                    createdAt: yield* DateTime.now,
                    resolvedAt: null,
                  };
                  approvals.set(requestId, { request: approval, decision, node: approvalNode });
                  yield* emit({ type: "node.updated", driver, node: approvalNode });
                  yield* emit({
                    type: "runtime_request.updated",
                    driver,
                    threadId: request.threadId,
                    runtimeRequest: approval,
                  });
                  yield* emit({
                    type: "turn_item.updated",
                    driver,
                    turnItem: {
                      ...approvalBase,
                      status: "waiting",
                      type: "approval_request",
                      requestId,
                      requestKind,
                      prompt: definition.toolHarness.approvalDetail(call.name, call.args),
                      options: [
                        { decision: "accept", label: "Allow" },
                        { decision: "decline", label: "Decline" },
                      ],
                    },
                  });
                  const choice = yield* Deferred.await(decision);
                  denied =
                    choice !== "accept" &&
                    choice !== "acceptForSession" &&
                    choice !== "acceptAlways";
                  if (choice === "acceptForSession" || choice === "acceptAlways")
                    approvedTools.add(call.name);
                  approvals.delete(requestId);
                  yield* emit({
                    type: "node.updated",
                    driver,
                    node: {
                      ...approvalNode,
                      status: "completed",
                      completedAt: yield* DateTime.now,
                    },
                  });
                  yield* emit({
                    type: "turn_item.updated",
                    driver,
                    turnItem: {
                      ...approvalBase,
                      status: "completed",
                      completedAt: yield* DateTime.now,
                      type: "approval_request",
                      requestId,
                      requestKind,
                    },
                  });
                  yield* emit({
                    type: "runtime_request.updated",
                    driver,
                    threadId: request.threadId,
                    runtimeRequest: {
                      ...approval,
                      status: "resolved",
                      decision: choice,
                      resolvedAt: yield* DateTime.now,
                    },
                  });
                }
                const result = denied
                  ? {
                      ok: false,
                      itemType: "dynamic_tool_call" as const,
                      title: call.name,
                      detail: "Tool execution was declined.",
                      output: { error: "Tool execution was declined." },
                    }
                  : yield* definition.toolHarness
                      .execute({
                        threadId: request.threadId,
                        name: call.name,
                        args: call.args,
                        cwd,
                        environment: definition.environment ?? process.env,
                        fetchWorker,
                      })
                      .pipe(
                        Effect.catch((cause) =>
                          Effect.succeed(failedNativeHarnessToolResult(call.name, cause)),
                        ),
                      );
                yield* emit({
                  type: "turn_item.updated",
                  driver,
                  turnItem: {
                    ...base,
                    status: !result.ok ? "failed" : "completed",
                    completedAt: yield* DateTime.now,
                    type: "dynamic_tool",
                    toolName: call.name,
                    input: call.args,
                    output: result.output,
                  },
                });
                yield* emit({
                  type: "node.updated",
                  driver,
                  node: makeNode(
                    { ...base, updatedAt: yield* DateTime.now },
                    "tool_call",
                    result.ok ? "completed" : "failed",
                  ),
                });
                return {
                  call,
                  result: modelFacingNativeProviderToolResult(result, {
                    itemId: base.id,
                    status: denied ? "declined" : result.ok ? "completed" : "failed",
                  }),
                } satisfies NativeProviderExecutedToolCall<ToolCall>;
              }),
              { concurrency: definition.limits.maxParallelToolCalls },
            );
            history.push(
              ...definition.toolResultsToHistoryItems({ session: view(), plan, results }),
            );
          }
          if (plan.persistedUserHistoryItems && persistedUserIndex !== undefined)
            history.splice(
              persistedUserIndex,
              plan.userHistoryItems.length,
              ...plan.persistedUserHistoryItems,
            );
          records.push({
            id: TurnId.make(turnId),
            historyStart,
            historyEnd: history.length,
            items: [],
          });
          yield* persist();
        });
        const serializedHistory = yield* encodeHistoryForSize(history).pipe(
          Effect.mapError((cause) => protocolError("Could not estimate provider history", cause)),
        );
        const admitted = admission
          ? admission.withLease(
              {
                threadId: request.threadId,
                turnId: TurnId.make(turnId),
                providerInstanceId: definition.instanceId,
                serializedHistoryBytes:
                  definition.history.estimateBytes?.(history) ??
                  Buffer.byteLength(serializedHistory),
                attachmentBytes: request.message.attachments.reduce(
                  (total, attachment) => total + attachment.sizeBytes,
                  0,
                ),
                toolBufferBytes:
                  definition.limits.maxToolOutputBytes * definition.limits.maxParallelToolCalls,
              },
              program.pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: driver,
                      method: "turn/run",
                      detail: "Provider turn failed",
                      cause,
                    }),
                ),
              ),
            )
          : program;
        const fiber = yield* Effect.uninterruptibleMask((restore) =>
          restore(Effect.scoped(admitted)).pipe(
            Effect.matchCause({
              onSuccess: () => "completed" as const,
              onFailure: (cause): "interrupted" | OrchestrationV2ProviderFailure =>
                Cause.hasInterrupts(cause)
                  ? "interrupted"
                  : makeProviderFailure({
                      class: "provider_error",
                      message: String(Cause.squash(cause)),
                    }),
            }),
            Effect.flatMap(
              Effect.fn("NativeProviderAdapter.operation")(function* (result) {
                const completedAt = yield* DateTime.now;
                const status = typeof result === "string" ? result : "failed";
                if (status !== "completed") {
                  history = preTurnHistory;
                  records.splice(preTurnCount);
                }
                for (const pending of approvals.values()) {
                  yield* emit({
                    type: "node.updated",
                    driver,
                    node: { ...pending.node, status: "cancelled", completedAt },
                  });
                  yield* emit({
                    type: "runtime_request.updated",
                    driver,
                    threadId: request.threadId,
                    runtimeRequest: {
                      ...pending.request,
                      status: "cancelled",
                      resolvedAt: completedAt,
                      responseCapability: {
                        type: "not_resumable",
                        reason: "The provider turn ended.",
                      },
                    },
                  });
                }
                approvals.clear();
                const settledStatus = status === "interrupted" ? ("cancelled" as const) : status;
                for (const node of openNodes.values())
                  if (node.providerTurnId === turnId)
                    yield* emit({
                      type: "node.updated",
                      driver,
                      node: { ...node, status: settledStatus, completedAt },
                    });
                for (const item of openItems.values())
                  if (item.providerTurnId === turnId)
                    yield* emit({
                      type: "turn_item.updated",
                      driver,
                      turnItem: {
                        ...item,
                        status: settledStatus,
                        completedAt,
                        updatedAt: completedAt,
                      },
                    });
                for (const message of openMessages.values())
                  if (message.runId === request.runId)
                    yield* emit({
                      type: "message.updated",
                      driver,
                      message: { ...message, streaming: false, updatedAt: completedAt },
                    });
                if (thread) {
                  thread = {
                    ...thread,
                    status: "idle",
                    ...(status === "completed"
                      ? {
                          nativeConversationHeadRef: {
                            driver,
                            nativeId: turnId,
                            strength: "strong" as const,
                          },
                        }
                      : {}),
                    updatedAt: completedAt,
                  };
                  yield* emit({ type: "provider_thread.updated", driver, providerThread: thread });
                }
                const turnTokenUsage = usageReceived
                  ? {
                      usageScope: "main_agent" as const,
                      usageStatus: usageComplete ? ("complete" as const) : ("partial" as const),
                      hasSubagents,
                      models: [activeModel],
                      ...turnUsage,
                    }
                  : undefined;
                providerTurn = Object.assign({}, providerTurn, {
                  status,
                  completedAt,
                  ...(turnTokenUsage === undefined ? {} : { turnTokenUsage }),
                  responseMetrics: {
                    ...providerResponseMetrics({
                      startedAt,
                      completedAt,
                      firstTokenAt,
                      tokenUsage: turnTokenUsage,
                    }),
                    ...(providerTurn.tokenUsage === undefined
                      ? {}
                      : { contextUsedTokens: providerTurn.tokenUsage.usedTokens }),
                  },
                });
                turns.set(turnId, providerTurn);
                active = undefined;
                const currentMcpRegistry =
                  mcpRegistry ??
                  Option.getOrUndefined(yield* Effect.serviceOption(McpRuntimeRegistry));
                if (
                  mcpRuntime &&
                  (yield* mcpRuntime.settle(request.threadId)) &&
                  currentMcpRegistry
                )
                  yield* currentMcpRegistry
                    .refresh({
                      providerInstanceId: definition.instanceId,
                      threadId: request.threadId,
                      runtimeSessionId: RuntimeSessionId.make(input.providerSessionId),
                    })
                    .pipe(Effect.ignoreCause({ log: true }));
                yield* emit({ type: "provider_turn.updated", driver, providerTurn });
                if (typeof result === "string")
                  yield* emit({
                    type: "turn.terminal",
                    driver,
                    providerThreadId: request.providerThread.id,
                    providerTurnId: turnId,
                    runOrdinal: request.runOrdinal,
                    status: result,
                    failure: null,
                    threadDisposition: "reusable",
                  });
                else
                  yield* emit({
                    type: "turn.terminal",
                    driver,
                    providerThreadId: request.providerThread.id,
                    providerTurnId: turnId,
                    runOrdinal: request.runOrdinal,
                    status: "failed",
                    failure: result,
                    failureItemOrdinal: ++ordinal,
                    threadDisposition: "reusable",
                  });
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                active = undefined;
                trimWorkingSets(slot);
              }).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
            ),
          ),
        ).pipe(Effect.forkIn(scope));
        active = { fiber, done };
      });
      const stop = Effect.fn("NativeProviderAdapter.stop")(function* () {
        if (active) yield* Fiber.interrupt(active.fiber);
      });
      openingSessions.delete(slot);
      const mcpSession = {
        runtimeSessionId: RuntimeSessionId.make(input.providerSessionId),
        get cwd() {
          return cwd;
        },
        isRunning: () => active !== undefined,
      };
      mcpSessions.set(input.threadId, mcpSession);
      if (mcpRuntime && mcpRegistration) yield* mcpRegistration.registerSession(protocolSession);
      sessions.add(stop);
      workingSets.set(slot, {
        isLoaded: () => workingSetLoaded,
        isActive: () => active !== undefined,
        evict: () => {
          history = [];
          records = [];
          messages.clear();
          turns.clear();
          workingSetLoaded = false;
          definition.onWorkingSetEvicted?.(thread?.appThreadId ?? input.threadId);
        },
      });
      yield* Effect.addFinalizer(
        Effect.fn("NativeProviderAdapter.operation")(function* () {
          sessions.delete(stop);
          workingSets.delete(slot);
          const ownsThread = mcpSessions.get(input.threadId) === mcpSession;
          if (ownsThread) {
            mcpSessions.delete(input.threadId);
            if (mcpRuntime && mcpRegistration)
              yield* mcpRegistration.endSession({
                providerInstanceId: definition.instanceId,
                threadId: input.threadId,
                runtimeSessionId: mcpSession.runtimeSessionId,
              });
          }
          yield* events.shutdown;
          yield* stop();
          if (ownsThread)
            yield* definition.toolHarness.releaseThread?.(input.threadId) ?? Effect.void;
        }),
      );
      return {
        instanceId: definition.instanceId,
        driver,
        providerSessionId: input.providerSessionId,
        providerSession,
        events: events.stream,
        ensureThread,
        resumeThread: ({ providerThread }) => load(providerThread),
        startTurn,
        steerTurn: ({ providerThread }) =>
          Effect.fail(
            new Adapter.ProviderAdapterSteerRunUnsupportedError({
              driver,
              providerThreadId: providerThread.id,
            }),
          ),
        interruptTurn: Effect.fn("NativeProviderAdapter.interruptTurn")(function* () {
          const running = active;
          if (running) {
            yield* Fiber.interrupt(running.fiber);
            yield* Deferred.await(running.done);
          }
        }),
        respondToRuntimeRequest: ({ requestId, decision }) => {
          const pending = approvals.get(requestId);
          return pending && decision
            ? Deferred.succeed(pending.decision, decision).pipe(Effect.asVoid)
            : Effect.fail(protocolError("Approval request is no longer pending"));
        },
        readThreadSnapshot: () => Effect.succeed(snapshot()),
        rollbackThread: Effect.fn("NativeProviderAdapter.rollbackThread")(function* (request) {
          if (active) return yield* protocolError("Cannot rewind an active turn");
          if (!thread || thread.id !== request.providerThread.id)
            yield* load(request.providerThread);
          const target = request.target;
          const index =
            target.type === "thread_start"
              ? -1
              : records.findIndex((record) => String(record.id) === target.providerTurn.id);
          if (request.target.type !== "thread_start" && index < 0)
            return yield* protocolError("Rollback target is missing from provider history");
          history.splice(index < 0 ? 0 : records[index]!.historyEnd);
          records.splice(index + 1);
          yield* persist();
          return snapshot();
        }),
        forkThread: () =>
          Effect.fail(protocolError("Use a conversation handoff to fork this provider")),
      } satisfies Adapter.ProviderAdapterV2SessionRuntime;
    }),
  });
  return {
    ...adapter,
    stopAll: () => Effect.forEach(sessions, (stop) => stop()).pipe(Effect.asVoid),
  };
});
