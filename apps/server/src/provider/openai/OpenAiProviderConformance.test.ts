import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import type { NativeProviderTurnAdmission } from "../nativeHarness/NativeProviderAdapter.ts";
import type { NativeProviderHarness } from "../nativeHarness/NativeProviderHarness.ts";
import {
  NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  nativeHarnessToolDeclarations,
  nativeHarnessToolIsAvailable,
} from "../nativeHarness/NativeHarnessTools.ts";
import { makeOpenAiAdapter } from "./OpenAiAdapter.ts";
import type { OpenAiCatalogModel } from "./OpenAiModelCatalog.ts";
import type { OpenAiRoundEvent } from "./OpenAiProtocol.ts";
import { OpenAiHttpError, type OpenAiTransport } from "./OpenAiTransport.ts";

const PROVIDER = ProviderDriverKind.make("openai");
const INSTANCE = ProviderInstanceId.make("openai");
const MODEL: OpenAiCatalogModel = {
  id: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  contextWindowTokens: 1_050_000,
  maxOutputTokens: 128_000,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  defaultReasoningEffort: "medium",
  toolCapabilities: { tools: true, parallelToolCalls: true, toolChoice: true },
  isVerified: true,
};
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-openai-provider-conformance-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const harness = (input: {
  readonly executed: Array<string>;
  readonly observedSandboxModes?: Array<string | undefined>;
  readonly observedFetchWorkers?: Array<boolean>;
}): NativeProviderHarness => ({
  declarations: ({ interactionMode, sandboxMode, fetchWorker }) =>
    Effect.sync(() => {
      input.observedSandboxModes?.push(sandboxMode);
      input.observedFetchWorkers?.push(fetchWorker);
      return nativeHarnessToolDeclarations({
        interactionMode,
        sandboxMode: fetchWorker ? "read-only" : sandboxMode,
      }).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    }),
  isAvailable: ({ toolName, interactionMode, sandboxMode, fetchWorker }) =>
    Effect.succeed(
      nativeHarnessToolIsAvailable({
        toolName,
        interactionMode,
        sandboxMode: fetchWorker ? "read-only" : sandboxMode,
      }),
    ),
  requiresApproval: (name) => name === NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
  requestType: () => "file_change_approval",
  approvalDetail: (name) => name,
  execute: ({ name }) =>
    Effect.sync(() => {
      input.executed.push(name);
      return {
        ok: true,
        itemType: name === NATIVE_HARNESS_WORKSPACE_EDIT_TOOL ? "file_change" : "mcp_tool_call",
        title: name,
        detail: "completed by T3",
        output: { ok: true },
      };
    }),
});

describe("OpenAI provider conformance", () => {
  it.effect(
    "owns approval, tool replay, usage, resume, rollback, and exact-runtime stop fencing",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const rounds: Array<ReadonlyArray<OpenAiRoundEvent>> = [
            [
              {
                type: "completed",
                model: MODEL.id,
                stopReason: "completed",
                historyItems: [
                  {
                    type: "reasoning",
                    id: "reasoning-1",
                    encrypted_content: "encrypted-reasoning",
                    summary: [],
                  },
                  {
                    type: "function_call",
                    id: "function-1",
                    call_id: "call-1",
                    name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
                    arguments:
                      '{"changes":[{"path":"notes.txt","edits":[{"type":"write","mode":"upsert","content":"done"}]}]}',
                  },
                ],
                toolCalls: [
                  {
                    sourceId: "function-1",
                    callId: "call-1",
                    name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
                    arguments:
                      '{"changes":[{"path":"notes.txt","edits":[{"type":"write","mode":"upsert","content":"done"}]}]}',
                  },
                ],
              },
            ],
            [
              {
                type: "contentDelta",
                kind: "assistant",
                sourceId: "message-1",
                delta: "Done",
              },
              {
                type: "completed",
                assistantText: "Done",
                model: MODEL.id,
                stopReason: "completed",
                historyItems: [
                  {
                    type: "message",
                    id: "message-1",
                    role: "assistant",
                    content: [{ type: "output_text", text: "Done", annotations: [] }],
                  },
                ],
                toolCalls: [],
                usage: {
                  inputTokens: 12,
                  cachedInputTokens: 2,
                  outputTokens: 4,
                  reasoningTokens: 1,
                  totalTokens: 16,
                },
              },
            ],
          ];
          const requests: Array<Parameters<OpenAiTransport["streamRound"]>[0]> = [];
          const transport: OpenAiTransport = {
            listModels: Effect.succeed([MODEL]),
            streamRound: (request) => {
              requests.push(request);
              return Stream.fromIterable(rounds.shift() ?? []);
            },
          };
          const executed: Array<string> = [];
          const admissions: Array<{
            readonly serializedHistoryBytes: number;
            readonly toolBufferBytes: number;
          }> = [];
          const admission: NativeProviderTurnAdmission = {
            withLease: (input, effect) => {
              admissions.push(input);
              return effect;
            },
          };
          const adapter = yield* makeOpenAiAdapter(
            { enabled: true },
            { instanceId: INSTANCE, transport, harness: harness({ executed }), admission },
          );
          const threadId = ThreadId.make("openai-conformance-tool-loop");
          const firstSession = yield* adapter.startSession({
            threadId,
            provider: PROVIDER,
            providerInstanceId: INSTANCE,
            cwd: process.cwd(),
            runtimeMode: "approval-required",
            sandboxMode: "workspace-write",
          });
          const openedFiber = yield* adapter.streamEvents.pipe(
            Stream.filter((event) => event.type === "request.opened"),
            Stream.runHead,
            Effect.forkChild,
          );
          yield* Effect.yieldNow;
          const turnFiber = yield* adapter
            .sendTurn({ threadId, input: "Write the note" })
            .pipe(Effect.forkChild);
          const opened = yield* Fiber.join(openedFiber);
          expect(Option.isSome(opened)).toBe(true);
          if (Option.isNone(opened) || opened.value.type !== "request.opened") return;
          expect(executed).toEqual([]);
          yield* adapter.respondToRequest(
            threadId,
            ApprovalRequestId.make(opened.value.requestId),
            "accept",
          );
          yield* Fiber.join(turnFiber);

          expect(executed).toEqual([NATIVE_HARNESS_WORKSPACE_EDIT_TOOL]);
          expect(admissions).toHaveLength(1);
          expect(admissions[0]?.serializedHistoryBytes).toBeGreaterThan(0);
          expect(admissions[0]?.toolBufferBytes).toBeGreaterThan(0);
          expect(requests).toHaveLength(2);
          expect(requests[1]?.history).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "reasoning",
                encrypted_content: "encrypted-reasoning",
              }),
              expect.objectContaining({ type: "function_call", call_id: "call-1" }),
              expect.objectContaining({ type: "function_call_output", call_id: "call-1" }),
            ]),
          );
          const snapshot = yield* adapter.readThread(threadId);
          expect(snapshot.turns).toHaveLength(1);
          expect(snapshot.turns[0]?.items).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "file_change",
                name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
              }),
              { type: "assistant_message", text: "Done" },
            ]),
          );
          expect(adapter.capabilities).toEqual({
            sessionModelSwitch: "in-session",
            mcp: "sessionConfig",
          });
          expect(adapter.mcpRuntime).toBeDefined();

          yield* adapter.stopSession(threadId);
          const resumed = yield* adapter.startSession({
            threadId,
            provider: PROVIDER,
            providerInstanceId: INSTANCE,
            cwd: process.cwd(),
            runtimeMode: "approval-required",
            sandboxMode: "workspace-write",
            resumeCursor: firstSession.resumeCursor,
          });
          expect((yield* adapter.readThread(threadId)).turns).toEqual(snapshot.turns);
          const staleStop = yield* adapter.forceStopSession(
            threadId,
            RuntimeSessionId.make(firstSession.runtimeSessionId),
          );
          expect(staleStop).toEqual({ outcome: "terminated", mechanism: "already-stopped" });
          expect(yield* adapter.hasSession(threadId)).toBe(true);
          expect((yield* adapter.rollbackThread(threadId, 1)).turns).toEqual([]);
          yield* adapter.forceStopSession(threadId, resumed.runtimeSessionId);
          expect(yield* adapter.hasSession(threadId)).toBe(false);
        }),
      ).pipe(Effect.provide(testLayer)),
  );

  it.effect("forces Fetch through read-only T3 tools and aborts an interrupted response", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const roundStarted = yield* Deferred.make<void>();
        const blocked = yield* Deferred.make<void>();
        let transportAborted = false;
        const requests: Array<Parameters<OpenAiTransport["streamRound"]>[0]> = [];
        const transport: OpenAiTransport = {
          listModels: Effect.succeed([MODEL]),
          streamRound: (request) => {
            requests.push(request);
            return Stream.fromEffect(
              Effect.gen(function* () {
                yield* Deferred.succeed(roundStarted, undefined);
                yield* Deferred.await(blocked);
                return {
                  type: "completed" as const,
                  model: MODEL.id,
                  stopReason: "completed",
                  historyItems: [],
                  toolCalls: [],
                };
              }),
            ).pipe(
              Stream.ensuring(
                Effect.sync(() => (transportAborted = request.signal?.aborted === true)),
              ),
            );
          },
        };
        const observedSandboxModes: Array<string | undefined> = [];
        const observedFetchWorkers: Array<boolean> = [];
        const providerHarness = harness({
          executed: [],
          observedSandboxModes,
          observedFetchWorkers,
        });
        const adapter = yield* makeOpenAiAdapter(
          { enabled: true },
          {
            instanceId: INSTANCE,
            transport,
            harness: providerHarness,
          },
        );
        const threadId = ThreadId.make("openai-conformance-fetch-interrupt");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          purpose: "fetch-worker",
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Inspect only" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(roundStarted);

        expect(observedSandboxModes).toEqual(["read-only"]);
        expect(observedFetchWorkers).toEqual([true]);
        expect(requests[0]?.tools.map(({ name }) => name)).toEqual(["workspace_context"]);
        expect(requests[0]?.tools.map(({ name }) => name)).not.toContain(
          NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
        );
        expect(requests[0]?.tools.map(({ name }) => name)).not.toContain("knowledge_graph_query");
        expect(
          yield* providerHarness.isAvailable({
            threadId,
            cwd: process.cwd(),
            toolName: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
            interactionMode: undefined,
            sandboxMode: "read-only",
            fetchWorker: true,
          }),
        ).toBe(false);
        expect(
          yield* providerHarness.isAvailable({
            threadId,
            cwd: process.cwd(),
            toolName: "knowledge_graph_query",
            interactionMode: undefined,
            sandboxMode: "read-only",
            fetchWorker: true,
          }),
        ).toBe(false);
        expect(requests[0]?.instructions).toContain("Read-only");
        yield* adapter.interruptTurn(threadId);
        yield* Fiber.await(turnFiber);
        expect(transportAborted).toBe(true);
        const [session] = yield* adapter.listSessions();
        expect(session?.status).toBe("ready");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps the session recoverable after a transient response failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0;
        const transport: OpenAiTransport = {
          listModels: Effect.succeed([MODEL]),
          streamRound: () => {
            attempts += 1;
            if (attempts === 1) {
              return Stream.fail(
                new OpenAiHttpError({
                  operation: "responses",
                  category: "service-unavailable",
                  status: 503,
                  message: "OpenAI service is unavailable",
                }),
              );
            }
            return Stream.succeed({
              type: "completed" as const,
              assistantText: "Recovered.",
              model: MODEL.id,
              stopReason: "completed",
              historyItems: [
                {
                  type: "message",
                  id: "message-recovered",
                  role: "assistant",
                  content: [{ type: "output_text", text: "Recovered.", annotations: [] }],
                },
              ],
              toolCalls: [],
            });
          },
        };
        const adapter = yield* makeOpenAiAdapter(
          { enabled: true },
          { instanceId: INSTANCE, transport, harness: harness({ executed: [] }) },
        );
        const threadId = ThreadId.make("openai-conformance-retry");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });

        const first = yield* adapter.sendTurn({ threadId, input: "Try once" }).pipe(Effect.result);
        expect(first._tag).toBe("Failure");
        expect((yield* adapter.listSessions())[0]?.status).toBe("ready");

        yield* adapter.sendTurn({ threadId, input: "Try again" });

        expect(attempts).toBe(2);
        expect((yield* adapter.readThread(threadId)).turns.at(-1)?.items).toContainEqual({
          type: "assistant_message",
          text: "Recovered.",
        });
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps generic attachment paths without uploading unsupported file inputs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requests: Array<Parameters<OpenAiTransport["streamRound"]>[0]> = [];
        const transport: OpenAiTransport = {
          listModels: Effect.succeed([MODEL]),
          streamRound: (request) => {
            requests.push(request);
            return Stream.succeed({
              type: "completed" as const,
              assistantText: "Read through the T3-managed path.",
              model: MODEL.id,
              stopReason: "completed",
              historyItems: [
                {
                  type: "message",
                  id: "message-file-path",
                  role: "assistant",
                  content: [
                    {
                      type: "output_text",
                      text: "Read through the T3-managed path.",
                      annotations: [],
                    },
                  ],
                },
              ],
              toolCalls: [],
            });
          },
        };
        const adapter = yield* makeOpenAiAdapter(
          { enabled: true },
          { instanceId: INSTANCE, transport, harness: harness({ executed: [] }) },
        );
        const threadId = ThreadId.make("openai-conformance-file-path");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });

        yield* adapter.sendTurn({
          threadId,
          input:
            'Summarize the report.\n[Attached file "report.pdf" is saved at: /attachments/report.pdf]',
          attachments: [
            {
              type: "file",
              id: "openai-report-pdf",
              name: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 456,
            },
          ],
        });

        expect(requests).toHaveLength(1);
        expect(requests[0]?.history).toContainEqual({
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: expect.stringContaining("/attachments/report.pdf"),
            },
          ],
        });
        expect(JSON.stringify(requests[0]?.history)).not.toContain("input_file");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("runs parallel subagent and knowledge-graph calls through the T3 harness", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawnStarted = yield* Deferred.make<void>();
        const graphStarted = yield* Deferred.make<void>();
        const releaseTools = yield* Deferred.make<void>();
        const executed: Array<string> = [];
        const parallelHarness: NativeProviderHarness = {
          declarations: () =>
            Effect.succeed([
              {
                name: "spawn_agent",
                description: "Start a T3-owned subagent",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: { task: { type: "string" } },
                  required: ["task"],
                },
              },
              {
                name: "knowledge_graph_query",
                description: "Query the T3-owned project graph",
                inputSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
              },
            ]),
          isAvailable: () => Effect.succeed(true),
          requiresApproval: () => false,
          requestType: () => "dynamic_tool_approval",
          approvalDetail: (name) => name,
          execute: ({ name }) =>
            Effect.gen(function* () {
              executed.push(name);
              yield* Deferred.succeed(
                name === "spawn_agent" ? spawnStarted : graphStarted,
                undefined,
              );
              yield* Deferred.await(releaseTools);
              return {
                ok: true,
                itemType: "mcp_tool_call" as const,
                title: name,
                detail: "completed by T3",
                output: { ok: true, name },
              };
            }),
        };
        const requests: Array<Parameters<OpenAiTransport["streamRound"]>[0]> = [];
        const rounds: Array<ReadonlyArray<OpenAiRoundEvent>> = [
          [
            {
              type: "completed",
              model: MODEL.id,
              stopReason: "completed",
              historyItems: [
                {
                  type: "function_call",
                  id: "function-spawn",
                  call_id: "call-spawn",
                  name: "spawn_agent",
                  arguments: '{"task":"Inspect provider A"}',
                },
                {
                  type: "function_call",
                  id: "function-graph",
                  call_id: "call-graph",
                  name: "knowledge_graph_query",
                  arguments: '{"query":"provider B"}',
                },
              ],
              toolCalls: [
                {
                  sourceId: "function-spawn",
                  callId: "call-spawn",
                  name: "spawn_agent",
                  arguments: '{"task":"Inspect provider A"}',
                },
                {
                  sourceId: "function-graph",
                  callId: "call-graph",
                  name: "knowledge_graph_query",
                  arguments: '{"query":"provider B"}',
                },
              ],
            },
          ],
          [
            {
              type: "completed",
              assistantText: "Both completed.",
              model: MODEL.id,
              stopReason: "completed",
              historyItems: [
                {
                  type: "message",
                  id: "message-parallel",
                  role: "assistant",
                  content: [{ type: "output_text", text: "Both completed.", annotations: [] }],
                },
              ],
              toolCalls: [],
            },
          ],
        ];
        const transport: OpenAiTransport = {
          listModels: Effect.succeed([MODEL]),
          streamRound: (request) => {
            requests.push(request);
            return Stream.fromIterable(rounds.shift() ?? []);
          },
        };
        const adapter = yield* makeOpenAiAdapter(
          { enabled: true },
          { instanceId: INSTANCE, transport, harness: parallelHarness },
        );
        const threadId = ThreadId.make("openai-conformance-parallel-tools");
        yield* adapter.startSession({
          threadId,
          provider: PROVIDER,
          providerInstanceId: INSTANCE,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "workspace-write",
        });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Inspect both providers" })
          .pipe(Effect.forkChild);

        yield* Effect.all([Deferred.await(spawnStarted), Deferred.await(graphStarted)], {
          concurrency: "unbounded",
        });
        expect(executed.toSorted()).toEqual(["knowledge_graph_query", "spawn_agent"]);
        yield* Deferred.succeed(releaseTools, undefined);
        yield* Fiber.join(turnFiber);

        expect(requests).toHaveLength(2);
        expect(requests[1]?.history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "function_call_output", call_id: "call-spawn" }),
            expect.objectContaining({ type: "function_call_output", call_id: "call-graph" }),
          ]),
        );
      }),
    ).pipe(Effect.provide(testLayer)),
  );
});
