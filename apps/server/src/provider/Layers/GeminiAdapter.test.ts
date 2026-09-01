import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import type { InProcessWorkAdmissionRequest } from "../../resourceProtection/InProcessWorkAdmission.ts";
import * as ResourceProtection from "../../resourceProtection/SubagentResourceGovernor.ts";
import type { GeminiClient } from "../GeminiClient.ts";
import type { GeminiHarnessToolExecutor } from "./GeminiHarness.ts";
import { makeGeminiAdapter } from "./GeminiAdapter.ts";

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-gemini-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function response(input: {
  readonly text?: string;
  readonly functionCall?: {
    readonly id: string;
    readonly name: string;
    readonly args: Record<string, unknown>;
  };
}): GenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            ...(input.text ? [{ text: input.text }] : []),
            ...(input.functionCall ? [{ functionCall: input.functionCall }] : []),
          ],
        },
        finishReason: input.functionCall ? "STOP" : "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 4,
      totalTokenCount: 14,
    },
  } as GenerateContentResponse;
}

function fakeClient(input: {
  readonly rounds: Array<ReadonlyArray<GenerateContentResponse>>;
  readonly requests: Array<GenerateContentParameters>;
}): GeminiClient {
  return {
    models: {
      generateContent: async () => response({ text: "{}" }),
      generateContentStream: async (request) => {
        input.requests.push(request);
        const chunks = input.rounds.shift() ?? [];
        return (async function* () {
          for (const chunk of chunks) yield chunk;
        })();
      },
      list: async () => {
        throw new Error("model discovery is not used by adapter tests");
      },
    },
  } as GeminiClient;
}

describe("GeminiAdapter", () => {
  it.effect("uses shared Native admission for Gemini and releases the lease", () => {
    const requests: Array<InProcessWorkAdmissionRequest> = [];
    let releaseCount = 0;
    const resourceLayer = Layer.mock(ResourceProtection.SubagentResourceGovernor)({
      acquireInProcessLease: (request) =>
        Effect.sync(() => {
          requests.push(request);
          return {
            workId: request.workId,
            reservedBytes: 1024,
            release: Effect.sync(() => {
              releaseCount += 1;
            }),
          };
        }),
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter(
          { enabled: true, customModels: [] },
          {
            environment: { GOOGLE_API_KEY: "test-key" },
            clientFactory: () =>
              fakeClient({ requests: [], rounds: [[response({ text: "Done." })]] }),
            toolExecutor: {
              execute: () => Effect.die("No tool should run for a text-only Gemini turn"),
            },
          },
        );
        const threadId = ThreadId.make("gemini-shared-native-admission");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("gemini"),
          providerInstanceId: ProviderInstanceId.make("gemini"),
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          sandboxMode: "read-only",
        });
        yield* adapter.sendTurn({ threadId, input: "Use the shared resource governor." });

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          threadId,
          provider: ProviderDriverKind.make("gemini"),
          providerInstanceId: ProviderInstanceId.make("gemini"),
        });
        expect(releaseCount).toBe(1);
      }),
    ).pipe(Effect.provide(testLayer.pipe(Layer.provideMerge(resourceLayer))));
  });

  it.effect("runs the official SDK tool loop through T3 and resumes T3-owned history", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requests: Array<GenerateContentParameters> = [];
        const executed: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = [];
        const client = fakeClient({
          requests,
          rounds: [
            [
              response({
                functionCall: {
                  id: "call-write",
                  name: "workspace_edit",
                  args: {
                    changes: [
                      {
                        path: "notes.txt",
                        edits: [{ type: "write", mode: "upsert", content: "hello" }],
                      },
                    ],
                  },
                },
              }),
            ],
            [response({ text: "Done." })],
          ],
        });
        const toolExecutor: GeminiHarnessToolExecutor = {
          execute: ({ name, args }) => {
            executed.push({ name, args });
            return Effect.succeed({
              ok: true,
              itemType: "file_change",
              title: "Workspace edit",
              detail: "1 file changed",
              output: {
                changes: [{ path: "notes.txt", action: "created", edit_count: 1 }],
              },
            });
          },
        };
        const adapter = yield* makeGeminiAdapter(
          { enabled: true, customModels: [] },
          {
            environment: { GOOGLE_API_KEY: "test-key" },
            clientFactory: () => client,
            toolExecutor,
          },
        );
        const threadId = ThreadId.make("gemini-sdk-tool-loop");
        const session = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("gemini"),
          providerInstanceId: ProviderInstanceId.make("gemini"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
        });
        yield* adapter.sendTurn({ threadId, input: "Write a note." });

        expect(executed).toEqual([
          {
            name: "workspace_edit",
            args: {
              changes: [
                {
                  path: "notes.txt",
                  edits: [{ type: "write", mode: "upsert", content: "hello" }],
                },
              ],
            },
          },
        ]);
        expect(requests).toHaveLength(2);
        const secondContents = requests[1]?.contents;
        expect(JSON.stringify(secondContents)).toContain("functionResponse");
        expect(JSON.stringify(secondContents)).toContain("notes.txt");
        expect(requests[0]?.config?.systemInstruction).toContain("T3 Code is the harness");
        expect(requests[0]?.config?.systemInstruction).toContain("workspace_context");
        expect(requests[0]?.config?.systemInstruction).toContain("workspace_edit");
        expect(requests[0]?.config?.systemInstruction).toMatch(/formatters.*generators.*binaries/i);

        const beforeResume = yield* adapter.readThread(threadId);
        expect(beforeResume.turns).toHaveLength(1);
        yield* adapter.stopSession(threadId);
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("gemini"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "danger-full-access",
          resumeCursor: session.resumeCursor,
        });
        const afterResume = yield* adapter.readThread(threadId);
        expect(afterResume.turns).toEqual(beforeResume.turns);
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("waits for a T3 approval before executing a protected tool", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const executed: Array<string> = [];
        const client = fakeClient({
          requests: [],
          rounds: [
            [
              response({
                functionCall: {
                  id: "call-command",
                  name: "exec_command",
                  args: { command: "git status --short" },
                },
              }),
            ],
            [response({ text: "Clean." })],
          ],
        });
        const adapter = yield* makeGeminiAdapter(
          { enabled: true, customModels: [] },
          {
            environment: { GEMINI_API_KEY: "test-key" },
            clientFactory: () => client,
            toolExecutor: {
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
        const threadId = ThreadId.make("gemini-sdk-approval");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("gemini"),
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
          .sendTurn({ threadId, input: "Check the repository." })
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

  it.effect("rejects an undeclared tool call at the execution boundary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requests: Array<GenerateContentParameters> = [];
        const executed: Array<string> = [];
        const client = fakeClient({
          requests,
          rounds: [
            [
              response({
                functionCall: {
                  id: "call-unavailable-command",
                  name: "exec_command",
                  args: { command: "touch should-not-exist" },
                },
              }),
            ],
            [response({ text: "The command is unavailable." })],
          ],
        });
        const adapter = yield* makeGeminiAdapter(
          { enabled: true, customModels: [] },
          {
            environment: { GOOGLE_API_KEY: "test-key" },
            clientFactory: () => client,
            toolExecutor: {
              execute: ({ name }) => {
                executed.push(name);
                return Effect.die("The fenced executor must not be called");
              },
            },
          },
        );
        const threadId = ThreadId.make("gemini-sdk-execution-fence");
        yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("gemini"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          sandboxMode: "read-only",
        });
        yield* adapter.sendTurn({ threadId, input: "Try an unavailable command." });

        expect(executed).toEqual([]);
        expect(
          requests[0]?.config?.tools?.[0]?.functionDeclarations?.map(({ name }) => name),
        ).toEqual(["workspace_find", "workspace_read", "workspace_context"]);
        expect(requests[0]?.config?.systemInstruction).toContain("workspace_find");
        expect(requests[0]?.config?.systemInstruction).toContain("workspace_read");
        expect(requests[0]?.config?.systemInstruction).toContain("workspace_context");
        expect(requests[0]?.config?.systemInstruction).not.toContain("workspace_edit");
        expect(JSON.stringify(requests[1]?.contents)).toContain(
          "Tool 'exec_command' is not available in this session mode.",
        );
      }),
    ).pipe(Effect.provide(testLayer)),
  );

  it.effect("fails visibly instead of silently resetting missing T3-owned history", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* makeGeminiAdapter(
          { enabled: true, customModels: [] },
          {
            environment: { GOOGLE_API_KEY: "test-key" },
            clientFactory: () => fakeClient({ requests: [], rounds: [] }),
            toolExecutor: {
              execute: () => Effect.die("No tool should run while resuming"),
            },
          },
        );
        const failure = yield* adapter
          .startSession({
            threadId: ThreadId.make("gemini-sdk-missing-resume"),
            provider: ProviderDriverKind.make("gemini"),
            cwd: process.cwd(),
            runtimeMode: "full-access",
            sandboxMode: "danger-full-access",
            resumeCursor: {
              schemaVersion: 1,
              sessionId: "10000000-0000-4000-8000-000000000001",
            },
          })
          .pipe(Effect.flip);

        expect(failure).toMatchObject({
          _tag: "ProviderAdapterRequestError",
          method: "session/resume",
        });
        expect(failure.detail).toContain("no longer available");
      }),
    ).pipe(Effect.provide(testLayer)),
  );
});
