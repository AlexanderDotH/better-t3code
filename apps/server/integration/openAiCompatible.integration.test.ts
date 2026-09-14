// @effect-diagnostics-next-line nodeBuiltinImport:off - Integration test exercises a real Node HTTP server boundary.
import * as NodeHttp from "node:http";
import * as NodeStreamConsumers from "node:stream/consumers";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";

import * as ServerConfig from "../src/config.ts";
import { makeNativeProviderHarness } from "../src/provider/nativeHarness/NativeProviderHarness.ts";
import { NATIVE_HARNESS_WORKSPACE_EDIT_TOOL } from "../src/provider/nativeHarness/NativeHarnessTools.ts";
import { makeOpenAiCompatibleAdapter } from "../src/provider/openaiCompatible/OpenAiCompatibleAdapter.ts";
import { makeOpenAiCompatibleTransport } from "../src/provider/openaiCompatible/OpenAiCompatibleTransport.ts";
import * as WorkspaceContext from "../src/workspace/WorkspaceContext.ts";
import * as WorkspaceEntries from "../src/workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../src/workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../src/workspace/WorkspacePaths.ts";

const MODEL = "fixture-coder";
const TOOL_CALL_ID = "write-note";
const TOOL_ARGUMENTS = JSON.stringify({
  changes: [
    { path: "notes.txt", edits: [{ type: "write", mode: "create", content: "written by T3\n" }] },
  ],
});

const WorkspaceFileSystemLayer = WorkspaceFileSystem.layer.pipe(
  Layer.provide(WorkspacePaths.layer),
  Layer.provide(
    Layer.succeed(WorkspaceEntries.WorkspaceEntries, {
      invalidate: () => Effect.void,
      browse: () => Effect.die("The endpoint turn does not browse the workspace index."),
      list: () => Effect.die("The endpoint turn does not list the workspace index."),
      refresh: () => Effect.die("The endpoint turn does not refresh the workspace index."),
      search: () => Effect.die("The endpoint turn does not search the workspace index."),
      searchContents: () => Effect.die("The endpoint turn does not search workspace contents."),
    }),
  ),
);

const TestLayer = Layer.mergeAll(
  WorkspaceFileSystemLayer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-endpoint-integration-" }),
  FetchHttpClient.layer,
  Layer.succeed(WorkspaceContext.WorkspaceContext, {
    execute: () => Effect.die("The endpoint turn only edits its temporary workspace."),
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

function sseRound(deltas: ReadonlyArray<unknown>, finishReason: string) {
  return [
    ...deltas.map((delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] })),
    { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } },
  ]
    .map(
      (chunk) => `data: ${JSON.stringify({ id: "fixture-response", model: MODEL, ...chunk })}\n\n`,
    )
    .join("")
    .concat("data: [DONE]\n\n");
}

const makeEndpoint = Effect.fn("OpenAiCompatibleIntegration.makeEndpoint")(function* () {
  const requests: Array<{
    authorization: string | undefined;
    body: unknown;
  }> = [];
  const failures: Array<unknown> = [];
  const responses = [
    sseRound(
      [
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: TOOL_CALL_ID,
              type: "function",
              function: {
                name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
                arguments: TOOL_ARGUMENTS.slice(0, 37),
              },
            },
          ],
        },
        { tool_calls: [{ index: 0, function: { arguments: TOOL_ARGUMENTS.slice(37) } }] },
      ],
      "tool_calls",
    ),
    sseRound([{ role: "assistant", content: "Created " }, { content: "notes.txt." }], "stop"),
    sseRound([{ role: "assistant", content: "The note is still saved." }], "stop"),
  ];
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      NodeHttp.createServer((request, response) => {
        void (async () => {
          if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
            response.writeHead(404).end();
            return;
          }
          requests.push({
            authorization: request.headers.authorization,
            body: (await NodeStreamConsumers.json(request)) as unknown,
          });
          const next = responses.shift();
          if (next === undefined) throw new Error("Unexpected additional completion request.");
          response.writeHead(200, { "Content-Type": "text/event-stream" });
          response.end(next);
        })().catch((error: unknown) => {
          failures.push(error);
          response.writeHead(500).end();
        });
      }),
    ),
    (server) => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  yield* Effect.tryPromise(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve();
        });
      }),
  );
  const address = server.address();
  assert.isOk(address !== null && typeof address !== "string");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, failures };
});

describe.each(["openaiCompatible", "lmstudio"] as const)(
  "%s native endpoint integration",
  (driverKind) => {
    it.live(
      "executes approved streamed workspace tools and resumes the persisted conversation",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-endpoint-workspace-" });
            const endpoint = yield* makeEndpoint();
            const instanceId = ProviderInstanceId.make(`${driverKind}-private-endpoint`);
            const provider = ProviderDriverKind.make(driverKind);
            const threadId = ThreadId.make(`${driverKind}-integration-thread`);
            const apiKey = driverKind === "openaiCompatible" ? "fixture-instance-key" : undefined;
            const transport = yield* makeOpenAiCompatibleTransport({
              baseUrl: endpoint.baseUrl,
              resolveApiKey: Effect.succeed(
                apiKey === undefined ? Option.none() : Option.some(Redacted.make(apiKey)),
              ),
            });
            const harness = yield* makeNativeProviderHarness({
              run: () => Effect.die("The endpoint turn must not spawn a command."),
            });
            const settings = {
              enabled: true,
              baseUrl: endpoint.baseUrl,
              defaultModel: MODEL,
              customModels: [],
            };
            const options = { driverKind, instanceId, transport, harness, environment: {} };
            const adapter = yield* makeOpenAiCompatibleAdapter(settings, options);
            const sessionInput = {
              threadId,
              provider,
              providerInstanceId: instanceId,
              cwd,
              runtimeMode: "approval-required" as const,
              sandboxMode: "workspace-write" as const,
            };
            const session = yield* adapter.startSession(sessionInput);
            const eventsFiber = yield* adapter.streamEvents.pipe(
              Stream.takeUntil((event) => event.type === "turn.completed"),
              Stream.runCollect,
              Effect.forkChild({ startImmediately: true }),
            );
            const approvalFiber = yield* adapter.streamEvents.pipe(
              Stream.filter((event) => event.type === "request.opened"),
              Stream.runHead,
              Effect.forkChild({ startImmediately: true }),
            );
            const turnFiber = yield* adapter
              .sendTurn({ threadId, input: "Create notes.txt with written by T3." })
              .pipe(Effect.forkChild);
            const approval = yield* Fiber.join(approvalFiber);
            assert.isOk(Option.isSome(approval) && approval.value.type === "request.opened");
            assert.isDefined(approval.value.requestId);
            expect(yield* fs.exists(path.join(cwd, "notes.txt"))).toBe(false);
            expect(endpoint.requests).toHaveLength(1);
            yield* adapter.respondToRequest(
              threadId,
              ApprovalRequestId.make(approval.value.requestId),
              "accept",
            );
            yield* Fiber.join(turnFiber);
            const events = yield* Fiber.join(eventsFiber);

            expect(session).toMatchObject({
              provider,
              providerInstanceId: instanceId,
              model: MODEL,
            });
            expect(yield* fs.readFileString(path.join(cwd, "notes.txt"))).toBe("written by T3\n");
            expect(events).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  type: "item.completed",
                  payload: expect.objectContaining({ itemType: "file_change" }),
                }),
                expect.objectContaining({
                  type: "turn.completed",
                  payload: expect.objectContaining({ state: "completed" }),
                }),
              ]),
            );
            expect(
              events.every(
                (event) =>
                  event.provider === provider &&
                  event.runtimeSessionId === session.runtimeSessionId,
              ),
            ).toBe(true);
            expect(endpoint.requests).toHaveLength(2);
            expect(endpoint.requests[0]?.body).toMatchObject({
              model: MODEL,
              stream: true,
              messages: expect.arrayContaining([
                { role: "user", content: "Create notes.txt with written by T3." },
              ]),
              tools: expect.arrayContaining([
                expect.objectContaining({
                  type: "function",
                  function: expect.objectContaining({ name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL }),
                }),
              ]),
            });
            const toolHistory = expect.arrayContaining([
              expect.objectContaining({
                role: "assistant",
                tool_calls: [
                  {
                    id: TOOL_CALL_ID,
                    type: "function",
                    function: {
                      name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL,
                      arguments: TOOL_ARGUMENTS,
                    },
                  },
                ],
              }),
              {
                role: "tool",
                tool_call_id: TOOL_CALL_ID,
                content: expect.stringContaining('"action":"created"'),
              },
            ]);
            expect(endpoint.requests[1]?.body).toMatchObject({ messages: toolHistory });
            const snapshot = yield* adapter.readThread(threadId);
            expect(snapshot.turns).toHaveLength(1);
            expect(snapshot.turns[0]?.items).toEqual(
              expect.arrayContaining([{ type: "assistant_message", text: "Created notes.txt." }]),
            );

            const otherInstanceId = ProviderInstanceId.make(`${driverKind}-other-endpoint`);
            const otherAdapter = yield* makeOpenAiCompatibleAdapter(settings, {
              ...options,
              instanceId: otherInstanceId,
            });
            const otherInstanceResume = yield* otherAdapter
              .startSession({
                ...sessionInput,
                providerInstanceId: otherInstanceId,
                resumeCursor: session.resumeCursor,
              })
              .pipe(Effect.flip);
            expect(otherInstanceResume._tag).toBe("ProviderAdapterRequestError");
            expect(endpoint.requests).toHaveLength(2);

            yield* adapter.stopSession(threadId);
            const resumedAdapter = yield* makeOpenAiCompatibleAdapter(settings, options);
            const resumed = yield* resumedAdapter.startSession({
              ...sessionInput,
              resumeCursor: session.resumeCursor,
            });
            expect(resumed).toMatchObject({
              provider,
              providerInstanceId: instanceId,
              resumeCursor: session.resumeCursor,
            });
            expect(resumed.runtimeSessionId).not.toBe(session.runtimeSessionId);
            expect((yield* resumedAdapter.readThread(threadId)).turns).toEqual(snapshot.turns);
            yield* resumedAdapter.sendTurn({ threadId, input: "Is the note still saved?" });
            expect(endpoint.requests).toHaveLength(3);
            expect(endpoint.requests[2]?.body).toMatchObject({ messages: toolHistory });
            expect(endpoint.requests[2]?.body).toMatchObject({
              messages: expect.arrayContaining([
                { role: "assistant", content: "Created notes.txt." },
                { role: "user", content: "Is the note still saved?" },
              ]),
            });
            expect((yield* resumedAdapter.readThread(threadId)).turns).toHaveLength(2);
            expect(endpoint.requests.map(({ authorization }) => authorization)).toEqual(
              Array(3).fill(apiKey === undefined ? undefined : `Bearer ${apiKey}`),
            );
            expect(endpoint.failures).toEqual([]);
          }).pipe(Effect.provide(TestLayer)),
        ),
    );

    it.live("blocks endpoint-requested file writes in plan mode", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-endpoint-plan-" });
          const endpoint = yield* makeEndpoint();
          const instanceId = ProviderInstanceId.make(`${driverKind}-plan-endpoint`);
          const threadId = ThreadId.make(`${driverKind}-plan-thread`);
          const transport = yield* makeOpenAiCompatibleTransport({
            baseUrl: endpoint.baseUrl,
            resolveApiKey: Effect.succeed(Option.none()),
          });
          const harness = yield* makeNativeProviderHarness({
            run: () => Effect.die("A plan must not spawn a command."),
          });
          const adapter = yield* makeOpenAiCompatibleAdapter(
            { enabled: true, baseUrl: endpoint.baseUrl, defaultModel: MODEL, customModels: [] },
            { driverKind, instanceId, transport, harness, environment: {} },
          );
          yield* adapter.startSession({
            threadId,
            provider: ProviderDriverKind.make(driverKind),
            providerInstanceId: instanceId,
            cwd,
            runtimeMode: "full-access",
            sandboxMode: "danger-full-access",
          });
          yield* adapter.sendTurn({
            threadId,
            input: "Plan how to create notes.txt.",
            interactionMode: "plan",
          });

          expect(yield* fs.exists(path.join(cwd, "notes.txt"))).toBe(false);
          expect(endpoint.requests).toHaveLength(2);
          expect(endpoint.requests[0]?.body).toMatchObject({
            tools: expect.not.arrayContaining([
              expect.objectContaining({
                function: expect.objectContaining({ name: NATIVE_HARNESS_WORKSPACE_EDIT_TOOL }),
              }),
            ]),
          });
          expect(endpoint.requests[1]?.body).toMatchObject({
            messages: expect.arrayContaining([
              {
                role: "tool",
                tool_call_id: TOOL_CALL_ID,
                content: expect.stringContaining("not available"),
              },
            ]),
          });
          expect(endpoint.failures).toEqual([]);
        }).pipe(Effect.provide(TestLayer)),
      ),
    );
  },
);
