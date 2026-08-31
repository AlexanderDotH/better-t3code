import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ChatAttachment,
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { attachmentRelativePath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ChatGptAdapterBoundaryError,
  makeChatGptAdapter,
  type ChatGptHarness,
  type ChatGptAdapterResponseRequest,
  type ChatGptAdapterTransport,
} from "./ChatGptAdapter.ts";

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-chatgpt-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));
const decodeChatAttachment = Schema.decodeSync(ChatAttachment);
const decodeMcpServer = Schema.decodeSync(McpServerDefinition);

const noToolsHarness: ChatGptHarness = {
  declarations: () => Effect.succeed([]),
  isAvailable: () => Effect.succeed(false),
  requiresApproval: () => false,
  requestType: () => "dynamic_tool_call",
  approvalDetail: (name) => name,
  execute: () => Effect.die("No tool should execute."),
};

function fakeTransport(input: {
  readonly requests: Array<ChatGptAdapterResponseRequest>;
}): ChatGptAdapterTransport {
  const assistantItem = {
    type: "message",
    id: "message-1",
    role: "assistant",
    content: [{ type: "output_text", text: "Hello from ChatGPT." }],
  } as const;
  return {
    listModels: Effect.succeed([
      {
        id: "gpt-5.6-codex",
        displayName: "GPT-5.6 Codex",
        contextWindow: 400_000,
        default: true,
        reasoningEfforts: ["medium", "high"],
      },
    ]),
    streamResponse: (request) => {
      input.requests.push(request);
      return Stream.fromIterable([
        { type: "outputTextDelta" as const, itemId: "message-1", delta: "Hello " },
        { type: "outputTextDelta" as const, itemId: "message-1", delta: "from ChatGPT." },
        { type: "outputItemDone" as const, item: assistantItem },
        {
          type: "responseCompleted" as const,
          responseId: "response-1",
          status: "completed" as const,
          outputItems: [assistantItem],
          usage: {
            inputTokens: 11,
            cachedInputTokens: 3,
            outputTokens: 7,
            reasoningOutputTokens: 2,
            totalTokens: 18,
          },
        },
      ]);
    },
    compact: () => Effect.die("Compaction is not expected in this test."),
  };
}

describe("ChatGptAdapter", () => {
  it.effect("streams a response and resumes the T3-owned transcript", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requests: Array<ChatGptAdapterResponseRequest> = [];
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            instanceId: ProviderInstanceId.make("chatgpt_personal"),
            transport: fakeTransport({ requests }),
            harness: {
              declarations: () => Effect.succeed([]),
              isAvailable: () => Effect.succeed(false),
              requiresApproval: () => false,
              requestType: () => "dynamic_tool_call",
              approvalDetail: (name) => name,
              execute: () => Effect.die("No tool should execute."),
            },
          },
        );
        const threadId = ThreadId.make("chatgpt-native-history");
        const deltaFiber = yield* adapter.streamEvents.pipe(
          Stream.filter((event) => event.type === "content.delta"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        const session = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          providerInstanceId: ProviderInstanceId.make("chatgpt_personal"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        yield* adapter.sendTurn({ threadId, input: "Say hello." });

        const firstDelta = yield* Fiber.join(deltaFiber);
        expect(Option.isSome(firstDelta)).toBe(true);
        if (Option.isSome(firstDelta) && firstDelta.value.type === "content.delta") {
          expect(firstDelta.value.payload).toMatchObject({
            streamKind: "assistant_text",
            delta: "Hello ",
          });
        }
        expect(session.model).toBe("gpt-5.6-codex");
        expect(requests).toHaveLength(1);
        expect(requests[0]?.input).toMatchObject([
          { type: "message", role: "user", content: [{ type: "input_text", text: "Say hello." }] },
        ]);
        expect(requests[0]?.instructions).toContain("workspace_context");
        expect(requests[0]?.instructions).toContain("workspace_edit");
        expect(requests[0]?.instructions).toMatch(/formatters.*generators.*binaries/i);

        const beforeResume = yield* adapter.readThread(threadId);
        expect(beforeResume.turns).toHaveLength(1);
        expect(JSON.stringify(beforeResume.turns)).toContain("Hello from ChatGPT.");
        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          providerInstanceId: ProviderInstanceId.make("chatgpt_personal"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
          resumeCursor: session.resumeCursor,
        });
        expect(yield* adapter.readThread(threadId)).toEqual(beforeResume);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("passes Fetch isolation into the native tool catalog", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const declarationFetchFlags: Array<boolean> = [];
        const requests: Array<ChatGptAdapterResponseRequest> = [];
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            instanceId: ProviderInstanceId.make("chatgpt_personal"),
            transport: fakeTransport({ requests }),
            harness: {
              ...noToolsHarness,
              declarations: ({ fetchWorker }) =>
                Effect.sync(() => {
                  declarationFetchFlags.push(fetchWorker);
                  return [];
                }),
            },
          },
        );
        const threadId = ThreadId.make("chatgpt-fetch-tool-isolation");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          providerInstanceId: ProviderInstanceId.make("chatgpt_personal"),
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          sandboxMode: "read-only",
          purpose: "fetch-worker",
        });

        yield* adapter.sendTurn({ threadId, input: "Inspect the workspace." });

        expect(declarationFetchFlags).toEqual([true]);
        expect(requests[0]?.instructions).toContain("workspace_context");
        expect(requests[0]?.instructions).not.toContain("workspace_edit");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("replays completed legacy tool history without re-executing it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requests: Array<ChatGptAdapterResponseRequest> = [];
        const executed: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = [];
        const functionCall = {
          type: "function_call",
          id: "function-item-1",
          callId: "call-1",
          name: "write_file",
          arguments: '{"path":"notes.txt","contents":"hello"}',
        } as const;
        const assistantItem = {
          type: "message",
          id: "message-2",
          role: "assistant",
          content: [{ type: "output_text", text: "Done." }],
        } as const;
        const rounds = [
          [
            { type: "outputItemDone" as const, item: functionCall },
            {
              type: "responseCompleted" as const,
              responseId: "response-tools-1",
              status: "completed" as const,
              outputItems: [functionCall],
            },
          ],
          [
            { type: "outputTextDelta" as const, itemId: "message-2", delta: "Done." },
            { type: "outputItemDone" as const, item: assistantItem },
            {
              type: "responseCompleted" as const,
              responseId: "response-tools-2",
              status: "completed" as const,
              outputItems: [assistantItem],
            },
          ],
        ];
        const transport: ChatGptAdapterTransport = {
          listModels: Effect.succeed([
            {
              id: "gpt-5.6-codex",
              displayName: "GPT-5.6 Codex",
              contextWindow: 400_000,
              default: true,
              reasoningEfforts: ["medium"],
            },
          ]),
          streamResponse: (request) => {
            requests.push(request);
            return Stream.fromIterable(rounds.shift() ?? []);
          },
          compact: () => Effect.die("Compaction is not expected in this test."),
        };
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport,
            harness: {
              declarations: () =>
                Effect.succeed([
                  {
                    name: "write_file",
                    description: "Write a workspace file.",
                    inputSchema: { type: "object" },
                  },
                ]),
              isAvailable: () => Effect.succeed(true),
              requiresApproval: () => false,
              requestType: () => "file_change_approval",
              approvalDetail: (_name, args) => String(args.path ?? "write_file"),
              execute: ({ name, args }) => {
                executed.push({ name, args });
                return Effect.succeed({
                  ok: true,
                  itemType: "file_change",
                  title: "Write notes.txt",
                  detail: "5 bytes written",
                  output: { path: "notes.txt", bytesWritten: 5 },
                });
              },
            },
          },
        );
        const threadId = ThreadId.make("chatgpt-native-tool-loop");
        const session = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });

        yield* adapter.sendTurn({ threadId, input: "Write the note." });

        expect(executed).toEqual([
          {
            name: "write_file",
            args: { path: "notes.txt", contents: "hello" },
          },
        ]);
        expect(requests).toHaveLength(2);
        expect(JSON.stringify(requests[1]?.input)).toContain("function_call_output");
        expect(JSON.stringify(requests[1]?.input)).toContain("notes.txt");
        const beforeResume = yield* adapter.readThread(threadId);
        expect(JSON.stringify(beforeResume)).toContain("Done.");

        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
          resumeCursor: session.resumeCursor,
        });

        expect(yield* adapter.readThread(threadId)).toEqual(beforeResume);
        expect(executed).toHaveLength(1);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("executes parallel function calls before continuing the model round", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bothStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const executed: string[] = [];
        const calls = ["tool_a", "tool_b"].map((name, index) => ({
          type: "function_call" as const,
          id: `function-${index}`,
          callId: `call-${index}`,
          name,
          arguments: "{}",
        }));
        const done = {
          type: "message",
          id: "parallel-done",
          role: "assistant",
          content: [{ type: "output_text", text: "Both tools completed." }],
        } as const;
        const rounds = [
          [
            ...calls.map((item) => ({ type: "outputItemDone" as const, item })),
            {
              type: "responseCompleted" as const,
              responseId: "parallel-1",
              status: "completed" as const,
              outputItems: calls,
            },
          ],
          [
            { type: "outputItemDone" as const, item: done },
            {
              type: "responseCompleted" as const,
              responseId: "parallel-2",
              status: "completed" as const,
              outputItems: [done],
            },
          ],
        ];
        const requests: Array<ChatGptAdapterResponseRequest> = [];
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: {
              ...fakeTransport({ requests }),
              streamResponse: (request) => {
                requests.push(request);
                return Stream.fromIterable(rounds.shift() ?? []);
              },
            },
            harness: {
              declarations: () =>
                Effect.succeed(
                  calls.map(({ name }) => ({
                    name,
                    description: name,
                    inputSchema: { type: "object" },
                  })),
                ),
              isAvailable: () => Effect.succeed(true),
              requiresApproval: () => false,
              requestType: () => "dynamic_tool_call",
              approvalDetail: (name) => name,
              execute: ({ name }) =>
                Effect.gen(function* () {
                  executed.push(name);
                  if (executed.length === 2) yield* Deferred.succeed(bothStarted, undefined);
                  yield* Deferred.await(release);
                  return {
                    ok: true,
                    itemType: "mcp_tool_call" as const,
                    title: name,
                    detail: "completed",
                    output: { name },
                  };
                }),
            },
          },
        );
        const threadId = ThreadId.make("chatgpt-parallel-tools");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Run both tools." })
          .pipe(Effect.forkChild);
        yield* Deferred.await(bothStarted);
        expect(executed.toSorted()).toEqual(["tool_a", "tool_b"]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(turnFiber);
        expect(JSON.stringify(requests[1]?.input)).toContain("call-0");
        expect(JSON.stringify(requests[1]?.input)).toContain("call-1");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("waits for T3 approval before executing a protected tool", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const commandCall = {
          type: "function_call",
          id: "command-item-1",
          callId: "command-call-1",
          name: "exec_command",
          arguments: '{"command":"git status --short"}',
        } as const;
        const done = {
          type: "message",
          id: "message-after-command",
          role: "assistant",
          content: [{ type: "output_text", text: "Clean." }],
        } as const;
        const rounds = [
          [
            { type: "outputItemDone" as const, item: commandCall },
            {
              type: "responseCompleted" as const,
              responseId: "approval-response-1",
              status: "completed" as const,
              outputItems: [commandCall],
            },
          ],
          [
            { type: "outputItemDone" as const, item: done },
            {
              type: "responseCompleted" as const,
              responseId: "approval-response-2",
              status: "completed" as const,
              outputItems: [done],
            },
          ],
        ];
        const executed: Array<string> = [];
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: {
              listModels: Effect.succeed([
                {
                  id: "gpt-5.6-codex",
                  displayName: "GPT-5.6 Codex",
                  contextWindow: 400_000,
                  default: true,
                  reasoningEfforts: ["medium"],
                },
              ]),
              streamResponse: () => Stream.fromIterable(rounds.shift() ?? []),
              compact: () => Effect.die("Compaction is not expected in this test."),
            },
            harness: {
              declarations: () =>
                Effect.succeed([
                  {
                    name: "exec_command",
                    description: "Run a bounded command.",
                    inputSchema: { type: "object" },
                  },
                ]),
              isAvailable: () => Effect.succeed(true),
              requiresApproval: () => true,
              requestType: () => "command_execution_approval",
              approvalDetail: (_name, args) => String(args.command),
              execute: ({ name }) => {
                executed.push(name);
                return Effect.succeed({
                  ok: true,
                  itemType: "command_execution",
                  title: "git status --short",
                  detail: "Exited with code 0",
                  output: { stdout: "", exitCode: 0 },
                });
              },
            },
          },
        );
        const threadId = ThreadId.make("chatgpt-native-approval");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          sandboxMode: "danger-full-access",
        });
        const requestFiber = yield* adapter.streamEvents.pipe(
          Stream.filter((event) => event.type === "request.opened"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Inspect the repository." })
          .pipe(Effect.forkChild);
        const opened = yield* Fiber.join(requestFiber);
        expect(Option.isSome(opened)).toBe(true);
        if (Option.isNone(opened) || opened.value.type !== "request.opened") return;
        expect(executed).toEqual([]);

        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(opened.value.requestId),
          "accept",
        );
        yield* Fiber.join(turnFiber);
        expect(executed).toEqual(["exec_command"]);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps forty lightweight sessions and rejects the forty-first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: fakeTransport({ requests: [] }),
            harness: {
              declarations: () => Effect.succeed([]),
              isAvailable: () => Effect.succeed(false),
              requiresApproval: () => false,
              requestType: () => "dynamic_tool_call",
              approvalDetail: (name) => name,
              execute: () => Effect.die("No tool should execute."),
            },
          },
        );
        for (let index = 0; index < 40; index += 1) {
          yield* adapter.startSession({
            threadId: ThreadId.make(`chatgpt-managed-session-${index}`),
            provider: ProviderDriverKind.make("chatgpt"),
            cwd: process.cwd(),
            runtimeMode: "full-access",
            sandboxMode: "danger-full-access",
          });
        }

        expect(yield* adapter.listSessions()).toHaveLength(40);
        const failure = yield* adapter
          .startSession({
            threadId: ThreadId.make("chatgpt-managed-session-41"),
            provider: ProviderDriverKind.make("chatgpt"),
            cwd: process.cwd(),
            runtimeMode: "full-access",
            sandboxMode: "danger-full-access",
          })
          .pipe(Effect.flip);
        expect(failure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "session/start",
        });
        expect(failure.detail).toContain("at most 40 managed sessions");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("fails visibly before sending more than ninety tool definitions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let streamCalls = 0;
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: {
              ...fakeTransport({ requests: [] }),
              streamResponse: () => {
                streamCalls += 1;
                return Stream.empty;
              },
            },
            harness: {
              declarations: () =>
                Effect.succeed(
                  Array.from({ length: 91 }, (_, index) => ({
                    name: `tool_${index}`,
                    description: `Tool ${index}`,
                    inputSchema: { type: "object" },
                  })),
                ),
              isAvailable: () => Effect.succeed(true),
              requiresApproval: () => false,
              requestType: () => "dynamic_tool_call",
              approvalDetail: (name) => name,
              execute: () => Effect.die("No tool should execute."),
            },
          },
        );
        const threadId = ThreadId.make("chatgpt-tool-definition-cap");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        const failure = yield* adapter
          .sendTurn({ threadId, input: "Use a tool." })
          .pipe(Effect.flip);

        expect(streamCalls).toBe(0);
        expect(failure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "session/prompt",
        });
        expect(failure.detail).toContain("91 tools");
        expect(failure.detail).toContain("90-definition limit");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("compacts against the live context window and hard-fails compaction errors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requests: Array<ChatGptAdapterResponseRequest> = [];
        const compactedInputs: Array<ReadonlyArray<unknown>> = [];
        let responseIndex = 0;
        const transport: ChatGptAdapterTransport = {
          listModels: Effect.succeed([
            {
              id: "gpt-small-context",
              displayName: "GPT Small Context",
              contextWindow: 100,
              default: true,
              reasoningEfforts: ["medium"],
            },
          ]),
          streamResponse: (request) => {
            requests.push(request);
            responseIndex += 1;
            const item = {
              type: "message",
              id: `message-${responseIndex}`,
              role: "assistant",
              content: [{ type: "output_text", text: `response-${responseIndex}` }],
            } as const;
            return Stream.fromIterable([
              { type: "outputItemDone" as const, item },
              {
                type: "responseCompleted" as const,
                responseId: `response-${responseIndex}`,
                status: "completed" as const,
                outputItems: [item],
              },
            ]);
          },
          compact: (request) => {
            compactedInputs.push(request.input);
            return Effect.succeed({
              input: [
                {
                  type: "message",
                  role: "developer",
                  content: [{ type: "input_text", text: "Compacted conversation." }],
                },
              ],
            });
          },
        };
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          { transport, harness: noToolsHarness },
        );
        const threadId = ThreadId.make("chatgpt-compaction");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        yield* adapter.sendTurn({ threadId, input: "short" });
        yield* adapter.sendTurn({ threadId, input: "x".repeat(800) });

        expect(compactedInputs).toHaveLength(1);
        expect(JSON.stringify(requests.at(-1)?.input)).toContain("Compacted conversation.");

        const failingTransport: ChatGptAdapterTransport = {
          ...transport,
          compact: () =>
            Effect.fail(
              new ChatGptAdapterBoundaryError({
                operation: "responses/compact",
                detail: "protocol drift",
              }),
            ),
        };
        const failingAdapter = yield* makeChatGptAdapter(
          { enabled: true },
          { transport: failingTransport, harness: noToolsHarness },
        );
        const failingThread = ThreadId.make("chatgpt-compaction-failure");
        yield* failingAdapter.startSession({
          threadId: failingThread,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        yield* failingAdapter.sendTurn({ threadId: failingThread, input: "short" });
        const failure = yield* failingAdapter
          .sendTurn({ threadId: failingThread, input: "x".repeat(800) })
          .pipe(Effect.flip);
        expect(failure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "responses/compact",
        });
        expect(failure.detail).toContain("protocol drift");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("sends image attachments without retaining their inline bytes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const attachment = decodeChatAttachment({
          type: "image",
          id: "chatgpt-image",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 4,
        });
        yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
        yield* fileSystem.writeFile(
          path.join(config.attachmentsDir, attachmentRelativePath(attachment)),
          new Uint8Array([1, 2, 3, 4]),
        );

        const requests: Array<ChatGptAdapterResponseRequest> = [];
        const reservations: Array<{ readonly attachmentBytes: number }> = [];
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: fakeTransport({ requests }),
            harness: noToolsHarness,
            admission: {
              withLease: (reservation, effect) => {
                reservations.push({ attachmentBytes: reservation.attachmentBytes });
                return effect;
              },
            },
          },
        );
        const threadId = ThreadId.make("chatgpt-image-attachment");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        yield* adapter.sendTurn({ threadId, attachments: [attachment] });
        expect(JSON.stringify(requests[0]?.input)).toContain("data:image/png;base64,AQIDBA==");
        expect(reservations[0]?.attachmentBytes).toBe(4);

        yield* adapter.sendTurn({ threadId, input: "What was attached?" });
        const continuedInput = JSON.stringify(requests[1]?.input);
        expect(continuedInput).toContain("[Attached image: image.png");
        expect(continuedInput).not.toContain("data:image/png;base64");
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps forty sessions controllable while retaining at most eight idle histories", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const evicted: ThreadId[] = [];
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: fakeTransport({ requests: [] }),
            harness: noToolsHarness,
            onWorkingSetEvicted: (threadId) => evicted.push(threadId),
          },
        );
        const rssBefore = process.memoryUsage().rss;
        const threadIds = Array.from({ length: 40 }, (_, index) =>
          ThreadId.make(`chatgpt-soak-${index}`),
        );
        for (const threadId of threadIds) {
          yield* adapter.startSession({
            threadId,
            provider: ProviderDriverKind.make("chatgpt"),
            cwd: process.cwd(),
            runtimeMode: "full-access",
            sandboxMode: "danger-full-access",
          });
          yield* adapter.sendTurn({ threadId, input: `Session ${threadId}` });
        }

        expect(yield* adapter.listSessions()).toHaveLength(40);
        expect(new Set(evicted).size).toBeGreaterThanOrEqual(32);
        for (const threadId of threadIds) {
          expect((yield* adapter.readThread(threadId)).turns).toHaveLength(1);
        }
        expect(process.memoryUsage().rss - rssBefore).toBeLessThanOrEqual(2 * 1024 ** 3);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("blocks session starts and turns as soon as instance auth is unavailable", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let authorized = false;
        const requests: Array<ChatGptAdapterResponseRequest> = [];
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: fakeTransport({ requests }),
            harness: noToolsHarness,
            authorize: Effect.sync(() => authorized),
          },
        );
        const threadId = ThreadId.make("chatgpt-auth-gate");
        const start = () =>
          adapter.startSession({
            threadId,
            provider: ProviderDriverKind.make("chatgpt"),
            cwd: process.cwd(),
            runtimeMode: "full-access",
            sandboxMode: "danger-full-access",
          });

        const startFailure = yield* start().pipe(Effect.flip);
        expect(startFailure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "authentication/status",
        });
        authorized = true;
        yield* start();
        authorized = false;
        const turnFailure = yield* adapter
          .sendTurn({ threadId, input: "Must not run" })
          .pipe(Effect.flip);
        expect(turnFailure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "authentication/status",
        });
        expect(requests).toEqual([]);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("reports configured MCP servers through the adapter runtime surface", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const instanceId = ProviderInstanceId.make("chatgpt_mcp_status");
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            instanceId,
            transport: fakeTransport({ requests: [] }),
            harness: noToolsHarness,
            resolveMcpServers: () =>
              Effect.succeed([
                decodeMcpServer({
                  id: "docs",
                  name: "Docs",
                  enabled: true,
                  providerRouting: { mode: "all" },
                  scope: "global",
                  transport: "http",
                  url: "https://mcp.example.test",
                  headers: {},
                }),
              ]),
          },
        );
        const threadId = ThreadId.make("chatgpt-mcp-status");
        const session = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          providerInstanceId: instanceId,
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        const runtime = adapter.mcpRuntime;
        expect(runtime).toBeDefined();
        if (!runtime) return;
        const servers = yield* runtime.getSnapshot({
          providerInstanceId: instanceId,
          threadId,
          runtimeSessionId: session.runtimeSessionId,
        });
        expect(servers).toMatchObject([
          {
            serverId: "docs",
            providerKey: "docs",
            name: "Docs",
            source: "t3-managed",
            transport: "http",
          },
        ]);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("finishes an active turn with a visible interruption when the instance stops", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const responseStarted = yield* Deferred.make<void>();
        const adapter = yield* makeChatGptAdapter(
          { enabled: true },
          {
            transport: {
              ...fakeTransport({ requests: [] }),
              streamResponse: () =>
                Stream.unwrap(
                  Deferred.succeed(responseStarted, undefined).pipe(Effect.as(Stream.never)),
                ),
            },
            harness: noToolsHarness,
          },
        );
        const threadId = ThreadId.make("chatgpt-disconnect-interrupt");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("chatgpt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        const terminalFiber = yield* adapter.streamEvents.pipe(
          Stream.filter((event) => event.type === "turn.completed"),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const turnFiber = yield* adapter
          .sendTurn({ threadId, input: "Keep working" })
          .pipe(Effect.forkChild);
        yield* Deferred.await(responseStarted);
        yield* adapter.stopAll();

        const terminal = yield* Fiber.join(terminalFiber);
        expect(Option.getOrUndefined(terminal)).toMatchObject({
          type: "turn.completed",
          payload: { state: "interrupted" },
        });
        yield* Fiber.interrupt(turnFiber);
      }),
    ).pipe(Effect.provide(testLayer)),
  );
});
