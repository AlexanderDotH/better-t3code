import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  PreviewTabId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WORKSPACE_CONTEXT_MAX_QUERIES,
  WORKSPACE_CONTEXT_MAX_READS,
  type WorkspaceContextResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Deferred from "effect/Deferred";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { McpProtocol, McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { HttpBody, HttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { DeviceService } from "../device/DeviceService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerConfig from "../config.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import * as GeneralSubagents from "../subagents/GeneralSubagentCoordinator.ts";
import * as WorkspaceContext from "../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as ProjectMemoryPolicy from "../projectMemory/ProjectMemoryPolicy.ts";
import * as ProjectMemoryStore from "../projectMemory/ProjectMemoryStore.ts";
import { ProjectContextQuery } from "../projectIndexing/query/ProjectContextQuery.ts";
import {
  WorkspaceContextTool,
  WorkspaceEditTool,
  WorkspaceFindTool,
  WorkspaceReadTool,
} from "./toolkits/workspace/tools.ts";

const decodeToolAnnotations = Schema.decodeUnknownSync(McpSchema.ToolAnnotations);
const decodeListToolsResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ result: McpSchema.ListToolsResult })),
);
const encodeJsonText = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const environmentId = EnvironmentId.make("environment-mcp-test");
const threadId = ThreadId.make("thread-mcp-test");
const tabId = PreviewTabId.make("tab-mcp-test");
const alternateTabId = PreviewTabId.make("tab-mcp-alternate");
const decodeJsonText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const invocation = {
  environmentId,
  threadId,
  providerSessionId: "provider-session-mcp-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview", "coordination"] as const),
  issuedAt: 1,
};
const workspaceInvocation: McpInvocationContext.McpInvocationScope = {
  ...invocation,
  capabilities: new Set(["preview", "workspace", "coordination"]),
};
const workspaceWithoutPreviewInvocation: McpInvocationContext.McpInvocationScope = {
  ...invocation,
  capabilities: new Set(["workspace", "coordination"]),
};
const coordinationInvocation: McpInvocationContext.McpInvocationScope = {
  ...invocation,
  capabilities: new Set(["coordination"]),
};
const workspaceOnlyInvocation: McpInvocationContext.McpInvocationScope = {
  ...invocation,
  capabilities: new Set(["workspace"]),
};
const workspaceWriteInvocation: McpInvocationContext.McpInvocationScope = {
  ...invocation,
  capabilities: new Set(["preview", "workspace", "workspace-write", "coordination"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "mcp-test", version: "1.0.0" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});
const TestLayer = McpHttpServer.PreviewToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(PreviewAutomationBroker.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-http-server-test-" })),
  Layer.provideMerge(NodeServices.layer),
);
const PullRequestsTestLayer = McpHttpServer.PullRequestsToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () => Effect.succeedNone,
      }),
      Layer.mock(OrchestrationEngineService)({}),
      NodeServices.layer,
    ),
  ),
);

const snapshotResult = {
  url: "http://example.test/",
  title: "Example",
  loading: false,
  visibleText: "Example",
  interactiveElements: [],
  accessibilityTree: {},
  consoleEntries: [],
  networkEntries: [],
  actionTimeline: [],
  screenshot: {
    mimeType: "image/png",
    data: Buffer.from("png").toString("base64"),
    width: 10,
    height: 5,
  },
};

/** Answers every snapshot request on a fresh broker host with the given result. */
const serveSnapshots = (clientId: string, result: unknown) =>
  Effect.gen(function* () {
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const connected = yield* Deferred.make<void>();
    const inputs: Array<unknown> = [];
    const events = yield* broker.connect({ clientId, environmentId });
    yield* Stream.runForEach(events, (event) => {
      if (event.type === "connected") return Deferred.succeed(connected, undefined);
      inputs.push(event.request.input);
      return broker.respond({
        clientId,
        connectionId: event.connectionId,
        requestId: event.request.requestId,
        ok: true,
        result,
      });
    }).pipe(Effect.forkScoped);
    yield* Deferred.await(connected);
    return inputs;
  });

const callSnapshot = (args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    return yield* server
      .callTool({ name: "preview_snapshot", arguments: args })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
  });

it("normalizes empty successful notification responses to accepted", () => {
  const notificationResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.text("", { status: 200, contentType: "application/json" }),
  );
  expect(notificationResponse.status).toBe(202);

  const resultResponse = McpHttpServer.normalizeMcpHttpResponse(
    HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id: 1, result: {} }),
  );
  expect(resultResponse.status).toBe(200);
});

it("normalizes MCP tool schemas without dropping class-backed tool metadata", () => {
  const annotations = decodeToolAnnotations({
    title: "Read workspace context",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const tool = new McpSchema.Tool({
    name: "workspace_context",
    title: "Workspace context",
    description: "Reads bounded workspace context.",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    outputSchema: { properties: { result: { type: "string" } }, type: "object" },
    annotations,
    _meta: { owner: "t3" },
  });

  const normalized = McpHttpServer.normalizeMcpTool(tool);

  expect(normalized).toBeInstanceOf(McpSchema.Tool);
  expect(normalized).not.toBe(tool);
  expect(normalized.name).toBe(tool.name);
  expect(normalized.title).toBe(tool.title);
  expect(normalized.description).toBe(tool.description);
  expect(normalized.outputSchema).toEqual(tool.outputSchema);
  expect(normalized.annotations).toEqual(annotations);
  expect(normalized._meta).toEqual(tool._meta);
  expect(normalized.inputSchema).toEqual({
    properties: { text: { type: "string" } },
    type: "object",
  });
});

it("keeps every refined workspace operation readable to MCP clients", () => {
  const normalize = (tool: Parameters<typeof Tool.getJsonSchema>[0]) =>
    McpHttpServer.normalizeMcpToolInputSchema(Tool.getJsonSchema(tool));
  const context = normalize(WorkspaceContextTool);
  const find = normalize(WorkspaceFindTool);
  const read = normalize(WorkspaceReadTool);
  const edit = normalize(WorkspaceEditTool);

  for (const schema of [context, find, read, edit]) {
    expect(JSON.stringify(schema)).not.toContain('"allOf"');
  }
  const findSchema = JSON.stringify(find);
  const editSchema = JSON.stringify(edit);
  for (const mode of ["auto", "path", "content"]) {
    expect(findSchema).toContain(`"${mode}"`);
  }
  for (const operation of ["write", "replace", "splice", "delete"]) {
    expect(editSchema).toContain(`"${operation}"`);
  }
  expect(editSchema).toContain('"content"');
  expect(editSchema).toContain('"text"');
  expect(context).toMatchObject({
    properties: {
      queries: {
        anyOf: expect.arrayContaining([
          expect.objectContaining({
            type: "array",
            maxItems: WORKSPACE_CONTEXT_MAX_QUERIES,
            items: expect.objectContaining({ type: "object" }),
          }),
        ]),
      },
      reads: {
        anyOf: expect.arrayContaining([
          expect.objectContaining({
            type: "array",
            maxItems: WORKSPACE_CONTEXT_MAX_READS,
            items: expect.objectContaining({ type: "object" }),
          }),
        ]),
      },
    },
  });
  expect(find).toMatchObject({
    properties: {
      queries: {
        type: "array",
        minItems: 1,
        maxItems: WORKSPACE_CONTEXT_MAX_QUERIES,
        items: { type: "object" },
      },
    },
  });
  expect(read).toMatchObject({
    properties: {
      reads: {
        type: "array",
        minItems: 1,
        maxItems: WORKSPACE_CONTEXT_MAX_READS,
        items: { type: "object" },
      },
    },
  });
  expect(edit).toMatchObject({
    properties: {
      changes: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: {
          properties: {
            edits: {
              type: "array",
              minItems: 1,
              maxItems: 256,
              items: { anyOf: expect.any(Array) },
            },
          },
        },
      },
    },
  });
});

it.effect("routes Codex resource reservations through their exact lifecycle", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const governor = yield* ResourceProtection.makeSubagentResourceGovernor();
      yield* governor.observe({
        sampledAtMs: 0,
        memory: {
          totalBytes: 16 * ResourceProtection.GIBIBYTE,
          availableBytes: 16 * ResourceProtection.GIBIBYTE,
          swapTotalBytes: 8 * ResourceProtection.GIBIBYTE,
          swapFreeBytes: 8 * ResourceProtection.GIBIBYTE,
        },
        processes: [],
      });
      const registryLayer = Layer.succeed(McpSessionRegistry.McpSessionRegistry, {
        issue: () => Effect.die("unused"),
        resolve: (token) => Effect.succeed(token === "resource-token" ? invocation : undefined),
        touch: () => Effect.void,
        revokeProviderSession: () => Effect.void,
        revokeThread: () => Effect.void,
        revokeAll: Effect.void,
      });
      const route = McpHttpServer.CodexResourceAdmissionRouteLive.pipe(
        Layer.provide(registryLayer),
        Layer.provideMerge(Layer.succeed(ResourceProtection.SubagentResourceGovernor, governor)),
      );
      yield* HttpRouter.serve(route, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const httpClient = yield* HttpClient.HttpClient;
      const post = (body: unknown) =>
        httpClient.post("/internal/resource-protection/codex-admit", {
          headers: { authorization: "Bearer resource-token" },
          body: HttpBody.text(JSON.stringify(body), "application/json"),
        });

      const rootAdmission = yield* post({
        action: "admit-root-turn",
        configurationKey: "codex-config",
        lifecycleId: "turn-1",
      });
      expect(rootAdmission.status).toBe(200);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * ResourceProtection.GIBIBYTE);

      expect((yield* post({ action: "release-root-turn", lifecycleId: "turn-1" })).status).toBe(
        200,
      );
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);

      expect(
        (yield* post({
          action: "admit-subagent",
          configurationKey: "codex-config",
          lifecycleId: "tool-use-1",
        })).status,
      ).toBe(200);
      expect(
        (yield* post({
          action: "confirm-subagent",
          configurationKey: "codex-config",
          agentId: "agent-1",
        })).status,
      ).toBe(200);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(4 * ResourceProtection.GIBIBYTE);

      expect((yield* post({ action: "release-subagent", agentId: "agent-1" })).status).toBe(200);
      expect((yield* governor.latest).reservedMemoryBytes).toBe(0);
      expect((yield* post({ action: "unknown" })).status).toBe(400);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect.each([{}, { includeImage: false }])(
  "returns bounded structural preview snapshot failures %#",
  (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* McpServer.McpServer;
        const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
        const events = yield* broker.connect({
          clientId: "mcp-failure-client",
          environmentId,
        });
        yield* Stream.runForEach(events, (event) =>
          event.type === "connected"
            ? Effect.void
            : broker.respond({
                clientId: "mcp-failure-client",
                connectionId: event.connectionId,
                requestId: event.request.requestId,
                ok: false,
                error: {
                  _tag: "PreviewAutomationExecutionError",
                  message: "sensitive renderer failure",
                  detail: { consoleOutput: "sensitive browser output" },
                },
              }),
        ).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        const snapshot = yield* server
          .callTool({ name: "preview_snapshot", arguments: input })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );

        const message = "Preview automation snapshot failed on client mcp-failure-client.";
        expect(snapshot.isError).toBe(true);
        expect(snapshot.content).toEqual([
          { type: "text", text: `Preview snapshot failed: ${message}` },
        ]);
        expect(snapshot.structuredContent).toEqual({
          error: {
            _tag: "PreviewAutomationExecutionError",
            operation: "snapshot",
            failureCount: 1,
            message,
          },
        });
      }),
    ).pipe(Effect.provide(TestLayer)),
);

it.effect.each([
  { args: {}, advice: "No active preview tab was found for snapshot. Call preview_open first." },
  {
    args: { tabId: alternateTabId },
    advice: `Preview tab ${alternateTabId} was not found for snapshot. Omit tabId to use the current tab, or call preview_open.`,
  },
])("tells the agent to open a tab when the snapshot has none $args", ({ args, advice }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
      const connected = yield* Deferred.make<void>();
      const events = yield* broker.connect({ clientId: "mcp-no-tab-client", environmentId });
      yield* Stream.runForEach(events, (event) =>
        event.type === "connected"
          ? Deferred.succeed(connected, undefined)
          : broker.respond({
              clientId: "mcp-no-tab-client",
              connectionId: event.connectionId,
              requestId: event.request.requestId,
              ok: false,
              error: { _tag: "PreviewAutomationTabNotFoundError", message: "no tab" },
            }),
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(connected);

      const snapshot = yield* callSnapshot(args);

      expect(snapshot.isError).toBe(true);
      expect(snapshot.content).toEqual([
        { type: "text", text: `Preview snapshot failed: ${advice}` },
      ]);
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("tells the agent how to fall back when no desktop app can run the snapshot", () =>
  Effect.gen(function* () {
    const snapshot = yield* callSnapshot({});

    expect(snapshot.isError).toBe(true);
    const [text] = snapshot.content;
    expect(text?.type === "text" ? text.text : "").toContain(
      "use a headless browser from the shell",
    );
    expect(snapshot.structuredContent).toMatchObject({
      error: { _tag: "PreviewAutomationNoAvailableHostError" },
    });
  }).pipe(Effect.provide(TestLayer)),
);

it.effect.each([
  { mode: "default", input: {}, images: true },
  { mode: "explicit image", input: { includeImage: true }, images: true },
  { mode: "text only", input: { includeImage: false }, images: false },
])("returns fresh $mode snapshots on repeated MCP calls", ({ input, images }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
      const connected = yield* Deferred.make<void>();
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
      const page = {
        url: "http://example.test/",
        loading: false,
        visibleText: "Save your changes",
        interactiveElements: [
          {
            tag: "button",
            role: "button",
            name: "Save",
            selector: "#save",
            x: 0,
            y: 0,
            width: 20,
            height: 10,
          },
        ],
        accessibilityTree: { role: "document", name: "Example" },
        consoleEntries: [],
        networkEntries: [],
        actionTimeline: [],
      };
      const screenshot = { mimeType: "image/png", width: 1, height: 1 };
      let requests = 0;
      const events = yield* broker.connect({ clientId: "mcp-image-option-client", environmentId });
      yield* Stream.runForEach(events, (event) => {
        if (event.type === "connected") return Deferred.succeed(connected, undefined);
        requests += 1;
        expect(event.request).toMatchObject({
          operation: "snapshot",
          tabId: alternateTabId,
          threadId,
        });
        expect(event.request.input).toEqual({});
        return broker.respond({
          clientId: "mcp-image-option-client",
          connectionId: event.connectionId,
          requestId: event.request.requestId,
          ok: true,
          result: {
            ...page,
            title: `Snapshot ${requests}`,
            screenshot: { ...screenshot, data: png },
          },
        });
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(connected);

      for (const call of [1, 2, 3, 4, 5, 6]) {
        const snapshot = yield* server
          .callTool({
            name: "preview_snapshot",
            arguments: { ...input, tabId: alternateTabId },
          })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
        const metadata = { ...page, title: `Snapshot ${call}`, screenshot };
        const { accessibilityTree: _tree, ...boundedMetadata } = metadata;
        expect(snapshot.isError).toBe(false);
        expect(snapshot.structuredContent).toEqual({
          ...boundedMetadata,
          omitted: ["accessibilityTree (use interactiveElements locators or preview_evaluate)"],
        });
        const [identity, text, ...rest] = snapshot.content;
        expect(identity?.type === "text" ? decodeJsonText(identity.text) : null).toEqual({
          url: page.url,
        });
        expect(text?.type === "text" ? decodeJsonText(text.text) : null).toEqual(boundedMetadata);
        expect(rest).toEqual([
          {
            type: "text",
            text: "Snapshot text was bounded. Omitted: accessibilityTree (use interactiveElements locators or preview_evaluate).",
          },
          ...(images
            ? [
                {
                  type: "image",
                  mimeType: "image/png",
                  data: new Uint8Array(Buffer.from(png, "base64")),
                },
              ]
            : []),
        ]);
      }

      // Output selection belongs to this call, not the MCP session's history.
      const nextDefault = yield* server
        .callTool({
          name: "preview_snapshot",
          arguments: { tabId: alternateTabId },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(nextDefault.content.map((content) => content.type)).toEqual([
        "text",
        "text",
        "text",
        "image",
      ]);
      expect(nextDefault.structuredContent).toMatchObject({ title: "Snapshot 7", screenshot });
      expect(nextDefault.structuredContent).not.toHaveProperty("accessibilityTree");
      expect(requests).toBe(7);
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects non-boolean snapshot image options before selecting a browser host", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    for (const includeImage of ["false", 0, null]) {
      const result = yield* server
        .callTool({
          name: "preview_snapshot",
          arguments: { includeImage },
        })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Preview snapshot failed: AiError." }]);
      expect(result.structuredContent).toEqual({
        error: { _tag: "AiError", operation: "snapshot", failureCount: 1 },
      });
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("saves the snapshot PNG on request and reports its path", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const inputs = yield* serveSnapshots("mcp-save-client", snapshotResult);

      const snapshot = yield* callSnapshot({ save: true });

      expect(snapshot.isError).toBe(false);
      // The browser never receives the server-only `save` flag.
      expect(inputs).toEqual([{}]);
      const structured = snapshot.structuredContent as { readonly screenshotPath?: string };
      const screenshotPath = structured.screenshotPath;
      expect(typeof screenshotPath).toBe("string");
      expect(path.dirname(screenshotPath!)).toBe(config.browserArtifactsDir);
      expect(path.basename(screenshotPath!)).toMatch(
        /^browser-screenshot-example-test-[0-9a-z]+-[0-9a-f]{8}\.png$/,
      );
      expect(Buffer.from(yield* fileSystem.readFile(screenshotPath!)).toString()).toBe("png");
      const [, text] = snapshot.content;
      expect(text?.type === "text" ? text.text : "").toContain(screenshotPath);

      const unsaved = yield* callSnapshot({});
      expect(unsaved.structuredContent).not.toHaveProperty("screenshotPath");

      // A save without the image skips the page dump.
      const pathOnly = yield* callSnapshot({ save: true, includeImage: false });
      const saved = pathOnly.structuredContent as { readonly screenshotPath: string };
      expect(saved).toEqual({ url: snapshotResult.url, screenshotPath: expect.any(String) });
      expect(Buffer.from(yield* fileSystem.readFile(saved.screenshotPath)).toString()).toBe("png");
      const [only, ...others] = pathOnly.content;
      expect(others).toEqual([]);
      expect(only?.type === "text" ? decodeJsonText(only.text) : null).toEqual(saved);
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("reports a tagged error when the screenshot cannot be saved", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      // A regular file where the artifacts directory should be makes every write fail.
      yield* fileSystem.writeFileString(config.browserArtifactsDir, "");
      yield* serveSnapshots("mcp-save-failure-client", snapshotResult);

      const snapshot = yield* callSnapshot({ save: true });

      expect(snapshot.isError).toBe(true);
      expect(snapshot.content).toEqual([
        { type: "text", text: "Preview snapshot failed: PreviewScreenshotSaveError." },
      ]);
      expect(snapshot.structuredContent).toEqual({
        error: { _tag: "PreviewScreenshotSaveError", operation: "snapshot", failureCount: 1 },
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "registers the pull request toolkit and surfaces a missing capability as a tool error",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const names = server.tools.map(({ tool }) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "link_pull_request",
          "unlink_pull_request",
          "list_thread_pull_requests",
        ]),
      );
      const linkTool = server.tools.find(({ tool }) => tool.name === "link_pull_request");
      expect(linkTool?.tool.annotations?.idempotentHint).toBe(true);
      expect(linkTool?.tool.annotations?.openWorldHint).toBe(false);
      expect(linkTool?.tool.description).toContain("Register every pull request you open");

      const denied = yield* server
        .callTool({ name: "list_thread_pull_requests", arguments: {} })
        .pipe(
          // A preview-only credential: the token predates the toolkit or was minted elsewhere.
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(denied.isError).toBe(true);
      expect(denied.content).toEqual([
        { type: "text", text: "MCP credential does not grant the pull-requests capability." },
      ]);
    }).pipe(Effect.provide(PullRequestsTestLayer)),
);

it.effect("keeps the snapshot text under the agent's output ceiling", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // Mirrors the real failure: a [role] container whose innerText is the whole
      // project list, repeated for several elements, plus a big AX tree.
      const pageText = "/Users/theo/Code/project\nClaude, Codex · 79 threads\n".repeat(600);
      const element = (name: string, index: number) => ({
        tag: "div",
        role: "presentation",
        name,
        selector: `div:nth-of-type(${index})`,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      });
      const oversized = {
        ...snapshotResult,
        visibleText: pageText,
        interactiveElements: [
          element(pageText, 1),
          element(pageText, 2),
          element(pageText, 3),
          element("Continue", 4),
        ],
        accessibilityTree: { nodes: Array.from({ length: 2_000 }, (_, i) => ({ nodeId: `${i}` })) },
        consoleEntries: Array.from({ length: 100 }, (_, i) => ({
          level: "log",
          text: `entry ${i}`,
          timestamp: "t",
        })),
      };
      yield* serveSnapshots("mcp-bounded-client", oversized);

      const snapshot = yield* callSnapshot({ includeImage: false });

      expect(snapshot.isError).toBe(false);
      const [identity, text, notice] = snapshot.content;
      expect(identity?.type === "text" ? decodeJsonText(identity.text) : null).toEqual({
        url: oversized.url,
      });
      expect(text?.type).toBe("text");
      const body = text?.type === "text" ? text.text : "";
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
        McpHttpServer.MAX_SNAPSHOT_TEXT_BYTES,
      );
      const parsed = decodeJsonText(body) as {
        readonly accessibilityTree?: unknown;
        readonly visibleText: string;
        readonly interactiveElements: ReadonlyArray<{ readonly name: string }>;
        readonly consoleEntries: ReadonlyArray<{ readonly text: string }>;
      };
      expect(parsed.accessibilityTree).toBeUndefined();
      expect(parsed.visibleText.length).toBeLessThanOrEqual(8_001);
      expect(parsed.interactiveElements).toHaveLength(4);
      expect(parsed.interactiveElements[0]?.name.length).toBeLessThanOrEqual(201);
      expect(parsed.interactiveElements[3]?.name).toBe("Continue");
      expect(parsed.consoleEntries).toHaveLength(40);
      expect(parsed.consoleEntries[0]?.text).toBe("entry 60");
      expect(notice?.type === "text" ? notice.text : "").toContain("accessibilityTree");
      expect(notice?.type === "text" ? notice.text : "").toContain("60 older console entries");
      // Claude Code shows the model structuredContent instead of the text, so it is bounded too.
      expect(snapshot.structuredContent).toEqual({
        ...parsed,
        omitted: expect.arrayContaining(["60 older console entries"]),
      });
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("bounds the snapshot text even when nothing but logs and the title are large", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const oversized = {
        ...snapshotResult,
        title: "t".repeat(70_000),
        interactiveElements: [],
        consoleEntries: [{ level: "log", text: "x".repeat(70_000), timestamp: "t" }],
      };
      yield* serveSnapshots("mcp-bounded-logs-client", oversized);

      const snapshot = yield* callSnapshot({ includeImage: false });

      const [, text] = snapshot.content;
      const body = text?.type === "text" ? text.text : "";
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
        McpHttpServer.MAX_SNAPSHOT_TEXT_BYTES,
      );
      const parsed = decodeJsonText(body) as {
        readonly title: string;
        readonly consoleEntries: ReadonlyArray<{ readonly text: string }>;
      };
      expect(parsed.title.length).toBe(2_049);
      expect(parsed.consoleEntries[0]?.text.length).toBe(501);
      const notice = snapshot.content[2];
      const noticeText = notice?.type === "text" ? notice.text : "";
      expect(noticeText).toContain("url or title after 2048 characters");
      expect(noticeText).toContain("console entries text after 500 characters");
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("bounds page text made of wide characters before dropping locators", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // The character caps alone leave 8,000 three-byte characters, about 24 KB.
      yield* serveSnapshots("mcp-wide-text-client", {
        ...snapshotResult,
        visibleText: "界".repeat(9_000),
        interactiveElements: Array.from({ length: 20 }, (_, i) => ({
          tag: "button",
          role: "button",
          name: `Button ${i}`,
          selector: `#button-${i}`,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        })),
      });

      const snapshot = yield* callSnapshot({ includeImage: false });

      const [, text, notice] = snapshot.content;
      const body = text?.type === "text" ? text.text : "";
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
        McpHttpServer.MAX_SNAPSHOT_TEXT_BYTES,
      );
      const parsed = decodeJsonText(body) as {
        readonly visibleText: string;
        readonly interactiveElements: ReadonlyArray<unknown>;
      };
      expect(parsed.visibleText).toMatch(/^界+…$/);
      expect(parsed.interactiveElements).toHaveLength(20);
      expect(notice?.type === "text" ? notice.text : "").toContain(
        "visibleText after 4000 characters",
      );
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("sheds log entries before locators when every list is full", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const long = "x".repeat(2_000);
      const oversized = {
        ...snapshotResult,
        interactiveElements: Array.from({ length: 20 }, (_, i) => ({
          tag: "button",
          role: "button",
          name: `Button ${i}`,
          selector: `#button-${i}`,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
        })),
        consoleEntries: Array.from({ length: 200 }, () => ({
          level: long,
          text: long,
          timestamp: long,
          source: long,
        })),
        networkEntries: Array.from({ length: 200 }, () => ({
          url: long,
          method: long,
          status: 200,
          failed: false,
          errorText: long,
          timestamp: long,
        })),
        actionTimeline: Array.from({ length: 200 }, () => ({
          id: long,
          action: long,
          status: "succeeded",
          startedAt: long,
          completedAt: long,
          error: long,
        })),
      };
      yield* serveSnapshots("mcp-full-logs-client", oversized);

      const snapshot = yield* callSnapshot({ includeImage: false });

      const [, text, notice] = snapshot.content;
      const body = text?.type === "text" ? text.text : "";
      expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
        McpHttpServer.MAX_SNAPSHOT_TEXT_BYTES,
      );
      const parsed = decodeJsonText(body) as {
        readonly interactiveElements: ReadonlyArray<unknown>;
        readonly consoleEntries: ReadonlyArray<unknown>;
        readonly networkEntries: ReadonlyArray<unknown>;
        readonly actionTimeline: ReadonlyArray<unknown>;
      };
      // Locators survive; the log lists take the cut.
      expect(parsed.interactiveElements).toHaveLength(20);
      expect(
        parsed.consoleEntries.length + parsed.networkEntries.length + parsed.actionTimeline.length,
      ).toBeLessThan(120);
      const noticeText = notice?.type === "text" ? notice.text : "";
      expect(noticeText).toContain("40 of 40 actionTimeline");
      expect(noticeText).not.toMatch(/\d+ of \d+ interactiveElements/);
    }),
  ).pipe(Effect.provide(TestLayer)),
);

it.effect("terminates HTTP MCP sessions with DELETE", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const serverLayer = McpServer.layerHttp({
        name: "MCP termination test",
        version: "1.0.0",
        path: "/mcp",
        protocols: [McpProtocol.v2025_06_18],
      });
      yield* HttpRouter.serve(serverLayer, {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(Layer.build);
      const httpClient = yield* HttpClient.HttpClient;

      const initializeResponse = yield* httpClient.post("/mcp", {
        headers: { accept: "application/json, text/event-stream" },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-test","version":"1.0.0"}}}`,
          "application/json",
        ),
      });
      const sessionId = initializeResponse.headers["mcp-session-id"];
      expect(initializeResponse.status).toBe(200);
      expect(sessionId).not.toBeNull();

      const missingSessionResponse = yield* httpClient.del("/mcp");
      expect(missingSessionResponse.status).toBe(400);

      const unknownSessionResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": "unknown-session" },
      });
      expect(unknownSessionResponse.status).toBe(404);

      const terminateResponse = yield* httpClient.del("/mcp", {
        headers: { "mcp-session-id": sessionId! },
      });
      expect(terminateResponse.status).toBe(204);

      const reusedSessionResponse = yield* httpClient.post("/mcp", {
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId!,
        },
        body: HttpBody.text(
          `{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}`,
          "application/json",
        ),
      });
      expect(reusedSessionResponse.status).toBe(404);
    }),
  ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect(
  "keeps read tools isolated and publishes editing only on writable workspace profiles",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emptyWorkspaceResult: WorkspaceContextResult = {
          queries: [],
          reads: [],
          truncated: false,
          warnings: [],
        };
        const workspaceWriteTokens = new Set([
          "workspace-write-token",
          "workspace-write-no-memory-token",
          "workspace-write-no-preview-token",
          "workspace-write-no-preview-no-memory-token",
          "workspace-write-only-token",
          "workspace-write-only-no-memory-token",
        ]);
        const registryLayer = Layer.succeed(McpSessionRegistry.McpSessionRegistry, {
          issue: () => Effect.die("unused"),
          resolve: (token) =>
            Effect.succeed(
              workspaceWriteTokens.has(token)
                ? workspaceWriteInvocation
                : token === "preview-token"
                  ? invocation
                  : token === "workspace-token"
                    ? workspaceInvocation
                    : token === "workspace-no-memory-token"
                      ? workspaceInvocation
                      : token === "workspace-no-preview-token" ||
                          token === "workspace-no-preview-no-memory-token"
                        ? workspaceWithoutPreviewInvocation
                        : token === "workspace-only-no-memory-token"
                          ? workspaceOnlyInvocation
                          : token === "coordination-token"
                            ? coordinationInvocation
                            : token === "workspace-only-token"
                              ? workspaceOnlyInvocation
                              : undefined,
            ),
          touch: () => Effect.void,
          revokeProviderSession: () => Effect.void,
          revokeThread: () => Effect.void,
          revokeAll: Effect.void,
        });
        const projectionLayer = Layer.mock(ProjectionSnapshotQuery)({
          getThreadCheckpointContext: () =>
            Effect.succeed(
              Option.some({
                threadId,
                projectId: ProjectId.make("project-mcp-test"),
                workspaceRoot: "/workspace/project",
                worktreePath: null,
                checkpointsEnabled: true,
                checkpoints: [],
              }),
            ),
        });
        const workspaceLayer = Layer.succeed(WorkspaceContext.WorkspaceContext, {
          execute: () => Effect.succeed(emptyWorkspaceResult),
        });
        const workspaceFileSystemLayer = Layer.mock(WorkspaceFileSystem.WorkspaceFileSystem)({
          editFiles: () => Effect.die("unused"),
        });
        const generalSubagentLayer = Layer.mock(GeneralSubagents.GeneralSubagentCoordinator)({});
        const projectMemoryLayer = Layer.mock(ProjectMemoryStore.ProjectMemoryStore)({});
        const routes = McpHttpServer.layer.pipe(
          Layer.provide(registryLayer),
          Layer.provide(projectionLayer),
          Layer.provide(Layer.mock(OrchestrationEngineService)({})),
          Layer.provide(Layer.mock(DeviceService)({})),
          Layer.provide(workspaceLayer),
          Layer.provide(workspaceFileSystemLayer),
          Layer.provide(generalSubagentLayer),
          Layer.provide(projectMemoryLayer),
          Layer.provide(Layer.mock(ProjectContextQuery)({})),
          Layer.provide(ProjectMemoryPolicy.layer),
          Layer.provide(PreviewAutomationBroker.layer),
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-mcp-workspace-test-" }),
          ),
          Layer.provide(NodeServices.layer),
        );
        yield* HttpRouter.serve(routes, {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(Layer.build);
        const httpClient = yield* HttpClient.HttpClient;
        const initializeBody = HttpBody.text(
          `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcp-test","version":"1.0.0"}}}`,
          "application/json",
        );
        const initialize = (path: string, token: string) =>
          httpClient.post(path, {
            headers: {
              accept: "application/json, text/event-stream",
              authorization: `Bearer ${token}`,
            },
            body: initializeBody,
          });
        const listTools = Effect.fn("McpHttpServer.test.listTools")(function* (
          path: string,
          token: string,
          sessionId: string,
        ) {
          const response = yield* httpClient.post(path, {
            headers: {
              accept: "application/json, text/event-stream",
              authorization: `Bearer ${token}`,
              "mcp-session-id": sessionId,
              "mcp-protocol-version": "2025-06-18",
            },
            body: HttpBody.text(
              `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
              "application/json",
            ),
          });
          return decodeListToolsResponse(yield* response.text).result.tools;
        });
        const workspaceReadToolNames = [
          "workspace_context",
          "workspace_find",
          "workspace_read",
        ] as const;

        const rejected = yield* initialize("/mcp/workspace", "preview-token");
        expect(rejected.status).toBe(401);
        expect((yield* initialize("/mcp/workspace-write", "workspace-token")).status).toBe(401);
        expect((yield* initialize("/mcp/workspace-write", "expired-token")).status).toBe(401);

        const preview = yield* initialize("/mcp", "preview-token");
        expect(preview.status).toBe(200);
        const previewTools = yield* listTools(
          "/mcp",
          "preview-token",
          preview.headers["mcp-session-id"]!,
        );
        expect(previewTools.map(({ name }) => name)).toContain("preview_status");
        expect(previewTools.map(({ name }) => name)).toContain("project_agent_list");
        expect(previewTools.map(({ name }) => name)).toContain("project_agent_claim");
        expect(previewTools.map(({ name }) => name)).toContain("project_agent_send");
        expect(previewTools.map(({ name }) => name)).toContain("project_agent_inbox");
        expect(previewTools.map(({ name }) => name)).toContain("subagent_models");
        expect(previewTools.map(({ name }) => name)).toContain("subagent_spawn");
        expect(previewTools.map(({ name }) => name)).toContain("subagent_wait");
        expect(previewTools.map(({ name }) => name)).toContain("subagent_cancel");
        expect(previewTools.filter(({ name }) => name === "thread_context")).toHaveLength(1);
        for (const name of workspaceReadToolNames) {
          expect(previewTools.map(({ name }) => name)).not.toContain(name);
        }
        expect(previewTools.map(({ name }) => name)).not.toContain("workspace_edit");
        expect(previewTools.map(({ name }) => name)).not.toContain("knowledge_graph_query");
        expect(
          previewTools
            .filter(({ inputSchema }) => inputSchema.type !== "object")
            .map(({ name }) => name),
        ).toEqual([]);
        expect(previewTools.find(({ name }) => name === "project_agent_send")?.title).toBe(
          "Message project agents",
        );
        expect(previewTools.find(({ name }) => name === "project_agent_send")?.annotations).toEqual(
          {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
        );
        expect(previewTools.find(({ name }) => name === "subagent_spawn")?.annotations).toEqual({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        });

        const workspace = yield* initialize("/mcp/workspace", "workspace-token");
        expect(workspace.status).toBe(200);
        const workspaceTools = yield* listTools(
          "/mcp/workspace",
          "workspace-token",
          workspace.headers["mcp-session-id"]!,
        );
        expect(workspaceTools.map(({ name }) => name)).toContain("preview_status");
        expect(workspaceTools.map(({ name }) => name)).toContain("project_agent_list");
        expect(workspaceTools.map(({ name }) => name)).toContain("subagent_spawn");
        expect(workspaceTools.filter(({ name }) => name === "thread_context")).toHaveLength(1);
        expect(workspaceTools.filter(({ name }) => name === "project_memory")).toHaveLength(1);
        expect(workspaceTools.map(({ name }) => name)).toContain("knowledge_graph_query");
        for (const [name, title] of [
          ["workspace_context", "Search and read workspace context"],
          ["workspace_find", "Find workspace files and text"],
          ["workspace_read", "Read workspace files"],
        ] as const) {
          expect(workspaceTools.find((tool) => tool.name === name)?.title).toBe(title);
          expect(workspaceTools.find((tool) => tool.name === name)?.annotations).toEqual({
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          });
        }
        expect(workspaceTools.map(({ name }) => name)).not.toContain("workspace_edit");

        const workspaceWithoutPreview = yield* initialize(
          "/mcp/workspace-no-preview",
          "workspace-no-preview-token",
        );
        expect(workspaceWithoutPreview.status).toBe(200);
        const workspaceWithoutPreviewTools = yield* listTools(
          "/mcp/workspace-no-preview",
          "workspace-no-preview-token",
          workspaceWithoutPreview.headers["mcp-session-id"]!,
        );
        for (const name of workspaceReadToolNames) {
          expect(workspaceWithoutPreviewTools.map(({ name }) => name)).toContain(name);
        }
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).toContain(
          "knowledge_graph_query",
        );
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).toContain(
          "project_agent_list",
        );
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).toContain("subagent_spawn");
        expect(
          workspaceWithoutPreviewTools.filter(({ name }) => name === "thread_context"),
        ).toHaveLength(1);
        expect(
          workspaceWithoutPreviewTools.filter(({ name }) => name === "project_memory"),
        ).toHaveLength(1);
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).not.toContain(
          "preview_status",
        );
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).not.toContain(
          "workspace_edit",
        );

        const coordination = yield* initialize("/mcp/coordination", "coordination-token");
        expect(coordination.status).toBe(200);
        const coordinationTools = yield* listTools(
          "/mcp/coordination",
          "coordination-token",
          coordination.headers["mcp-session-id"]!,
        );
        expect(coordinationTools.map(({ name }) => name)).toContain("project_agent_list");
        expect(coordinationTools.map(({ name }) => name)).toContain("subagent_spawn");
        expect(coordinationTools.filter(({ name }) => name === "thread_context")).toHaveLength(1);
        for (const name of workspaceReadToolNames) {
          expect(coordinationTools.map(({ name }) => name)).not.toContain(name);
        }
        expect(coordinationTools.map(({ name }) => name)).not.toContain("workspace_edit");
        expect(coordinationTools.map(({ name }) => name)).not.toContain("knowledge_graph_query");
        expect(coordinationTools.map(({ name }) => name)).not.toContain("preview_status");

        const workspaceOnly = yield* initialize("/mcp/workspace-only", "workspace-only-token");
        expect(workspaceOnly.status).toBe(200);
        const workspaceOnlyTools = yield* listTools(
          "/mcp/workspace-only",
          "workspace-only-token",
          workspaceOnly.headers["mcp-session-id"]!,
        );
        expect(workspaceOnlyTools.map(({ name }) => name).toSorted()).toEqual([
          "project_context",
          "project_memory",
          "thread_context",
          "workspace_context",
          "workspace_find",
          "workspace_read",
        ]);
        const workspaceOnlyNoMemory = yield* initialize(
          "/mcp/workspace-only-no-memory",
          "workspace-only-no-memory-token",
        );
        expect(workspaceOnlyNoMemory.status).toBe(200);
        const workspaceOnlyNoMemoryTools = yield* listTools(
          "/mcp/workspace-only-no-memory",
          "workspace-only-no-memory-token",
          workspaceOnlyNoMemory.headers["mcp-session-id"]!,
        );
        expect(workspaceOnlyNoMemoryTools.map(({ name }) => name).toSorted()).toEqual([
          "project_context",
          "thread_context",
          "workspace_context",
          "workspace_find",
          "workspace_read",
        ]);
        const readOnlyProfiles = [
          ["/mcp", "preview-token"],
          ["/mcp/coordination", "coordination-token"],
          ["/mcp/workspace", "workspace-token"],
          ["/mcp/workspace-no-memory", "workspace-no-memory-token"],
          ["/mcp/workspace-no-preview", "workspace-no-preview-token"],
          ["/mcp/workspace-no-preview-no-memory", "workspace-no-preview-no-memory-token"],
          ["/mcp/workspace-only", "workspace-only-token"],
          ["/mcp/workspace-only-no-memory", "workspace-only-no-memory-token"],
        ] as const;
        for (const [path, token] of readOnlyProfiles) {
          const initialized = yield* initialize(path, token);
          expect(initialized.status).toBe(200);
          const tools = yield* listTools(path, token, initialized.headers["mcp-session-id"]!);
          expect(tools.map(({ name }) => name)).not.toContain("workspace_edit");
        }
        const writableProfiles = [
          ["/mcp/workspace-write", "workspace-write-token"],
          ["/mcp/workspace-write-no-memory", "workspace-write-no-memory-token"],
          ["/mcp/workspace-write-no-preview", "workspace-write-no-preview-token"],
          [
            "/mcp/workspace-write-no-preview-no-memory",
            "workspace-write-no-preview-no-memory-token",
          ],
          ["/mcp/workspace-write-only", "workspace-write-only-token"],
          ["/mcp/workspace-write-only-no-memory", "workspace-write-only-no-memory-token"],
        ] as const;
        for (const [path, token] of writableProfiles) {
          const initialized = yield* initialize(path, token);
          expect(initialized.status).toBe(200);
          const tools = yield* listTools(path, token, initialized.headers["mcp-session-id"]!);
          for (const name of workspaceReadToolNames) {
            expect(tools.map(({ name }) => name)).toContain(name);
          }
          expect(tools.filter(({ name }) => name === "workspace_edit")).toHaveLength(1);
          expect(tools.find(({ name }) => name === "workspace_edit")?.annotations).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: false,
          });
        }
        const fullSchemaBytes = Buffer.byteLength(encodeJsonText(workspaceTools));
        const narrowSchemaBytes = Buffer.byteLength(encodeJsonText(workspaceOnlyTools));
        expect(narrowSchemaBytes).toBeLessThanOrEqual(fullSchemaBytes / 2);
        expect(workspaceTools.map(({ name }) => name)).toEqual(
          expect.arrayContaining([
            "preview_status",
            "knowledge_graph_query",
            "project_agent_list",
            "subagent_spawn",
          ]),
        );
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("registers annotated tools and preserves authenticated request context", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
      const toolIcon = {
        _tag: "website" as const,
        pageUrl: "http://example.test/",
      };
      const routedRequests: Array<{
        readonly operation: string;
        readonly tabId?: string | undefined;
      }> = [];
      const events = yield* broker.connect({
        clientId: "mcp-test-client",
        environmentId,
      });
      yield* Stream.runForEach(events, (event) => {
        if (event.type === "connected") return Effect.void;
        routedRequests.push(event.request);
        return broker.respond({
          clientId: "mcp-test-client",
          connectionId: event.connectionId,
          requestId: event.request.requestId,
          ok: true,
          result:
            event.request.operation === "snapshot"
              ? snapshotResult
              : event.request.operation === "evaluate"
                ? ["Connect", "Continue"]
                : event.request.operation === "press"
                  ? undefined
                  : {
                      available: true,
                      visible: true,
                      tabId,
                      url: "http://example.test/",
                      title: "Example",
                      loading: false,
                    },
        });
      }).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      expect(server.tools.some(({ tool }) => tool.name === "workspace_context")).toBe(false);

      const statusTool = server.tools.find(({ tool }) => tool.name === "preview_status");
      expect(statusTool?.tool.annotations?.readOnlyHint).toBe(true);
      expect(statusTool?.tool.annotations?.idempotentHint).toBe(true);
      expect(statusTool?.tool.annotations?.destructiveHint).toBe(false);

      const snapshotTool = server.tools.find(({ tool }) => tool.name === "preview_snapshot");
      expect(snapshotTool?.tool.annotations?.readOnlyHint).toBe(true);
      expect(snapshotTool?.tool.annotations?.idempotentHint).toBe(true);
      expect(snapshotTool?.tool.annotations?.openWorldHint).toBe(true);

      const clickTool = server.tools.find(({ tool }) => tool.name === "preview_click");
      expect(clickTool?.tool.annotations?.readOnlyHint).toBe(false);
      expect(clickTool?.tool.annotations?.destructiveHint).toBe(true);
      expect(clickTool?.tool.annotations?.openWorldHint).toBe(true);
      expect(clickTool?.tool.outputSchema).toMatchObject({
        type: "object",
        additionalProperties: true,
        description: "The preview action completed successfully.",
      });

      const navigateTool = server.tools.find(({ tool }) => tool.name === "preview_navigate");
      expect(navigateTool?.tool.annotations?.destructiveHint).toBe(false);
      expect(navigateTool?.tool.annotations?.openWorldHint).toBe(true);

      const status = yield* server
        .callTool({ name: "preview_status", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(status.isError).toBe(false);
      expect(status.structuredContent).toMatchObject({
        available: true,
        tabId,
      });

      const malformed = yield* server
        .callTool({ name: "preview_click", arguments: { selector: "" } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
          Effect.flip,
        );
      expect(malformed._tag).toBe("InvalidParams");

      const snapshot = yield* server
        .callTool({ name: "preview_snapshot", arguments: { tabId: alternateTabId } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(snapshot.isError).toBe(false);
      expect(snapshot.content.some((content) => content.type === "image")).toBe(true);
      expect(snapshot.structuredContent).toMatchObject({
        screenshot: { mimeType: "image/png", width: 10, height: 5 },
      });
      expect(routedRequests.find(({ operation }) => operation === "snapshot")?.tabId).toBe(
        alternateTabId,
      );

      // Arrays and primitives are wrapped so structuredContent stays a JSON object.
      // Claude Code rejects the whole result otherwise.
      const evaluateTool = server.tools.find(({ tool }) => tool.name === "preview_evaluate");
      expect(evaluateTool?.tool.outputSchema).toMatchObject({ type: "object" });
      const evaluated = yield* server
        .callTool({ name: "preview_evaluate", arguments: { expression: "buttons()" } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(evaluated.isError).toBe(false);
      expect(evaluated.structuredContent).toEqual({ value: ["Connect", "Continue"], toolIcon });
      const evaluatedText = evaluated.content[0];
      expect(evaluatedText?.type === "text" ? decodeJsonText(evaluatedText.text) : null).toEqual({
        toolIcon,
        value: ["Connect", "Continue"],
      });

      const actionRequests = [
        { name: "preview_click", arguments: { x: 10, y: 10 } },
        { name: "preview_type", arguments: { text: "Hello" } },
        { name: "preview_press", arguments: { key: "Enter" } },
        { name: "preview_scroll", arguments: { deltaY: 100 } },
        { name: "preview_wait_for", arguments: { text: "Example" } },
      ];
      for (const request of actionRequests) {
        const result = yield* server
          .callTool(request)
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
        expect(result.isError).toBe(false);
        expect(result.structuredContent).toEqual({ toolIcon });
        expect(routedRequests.at(-1)?.operation).toBe("status");
        const text = result.content[0];
        expect(text?.type === "text" ? decodeJsonText(text.text) : null).toEqual({ toolIcon });
      }
    }),
  ).pipe(Effect.provide(TestLayer)),
);
