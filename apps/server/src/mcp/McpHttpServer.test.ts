import { expect, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  PreviewTabId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type WorkspaceContextResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { McpProtocol, McpSchema, McpServer } from "effect/unstable/ai";
import { HttpBody, HttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";

import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import * as GeneralSubagents from "../subagents/GeneralSubagentCoordinator.ts";
import * as WorkspaceContext from "../workspace/WorkspaceContext.ts";

const environmentId = EnvironmentId.make("environment-mcp-test");
const threadId = ThreadId.make("thread-mcp-test");
const tabId = PreviewTabId.make("tab-mcp-test");
const alternateTabId = PreviewTabId.make("tab-mcp-alternate");
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
const client = McpSchema.McpServerClient.of({
  clientId: 1,
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
  Layer.provideMerge(PreviewAutomationBroker.layer.pipe(Layer.provide(NodeServices.layer))),
);

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

it.effect("returns bounded structural preview snapshot failures", () =>
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
        .callTool({ name: "preview_snapshot", arguments: {} })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.provideService(McpSchema.McpServerClient, client),
        );

      expect(snapshot.isError).toBe(true);
      expect(snapshot.content).toEqual([{ type: "text", text: "Preview snapshot failed." }]);
      expect(snapshot.structuredContent).toEqual({
        error: {
          _tag: "PreviewAutomationExecutionError",
          operation: "snapshot",
          failureCount: 1,
        },
      });
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
  "keeps preview tools isolated and rejects preview-only credentials on workspace MCP",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const emptyWorkspaceResult: WorkspaceContextResult = {
          queries: [],
          reads: [],
          truncated: false,
          warnings: [],
        };
        const registryLayer = Layer.succeed(McpSessionRegistry.McpSessionRegistry, {
          issue: () => Effect.die("unused"),
          resolve: (token) =>
            Effect.succeed(
              token === "preview-token"
                ? invocation
                : token === "workspace-token"
                  ? workspaceInvocation
                  : token === "workspace-no-preview-token"
                    ? workspaceWithoutPreviewInvocation
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
        const projectionLayer = Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
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
        } as ProjectionSnapshotQuery.ProjectionSnapshotQueryShape);
        const workspaceLayer = Layer.succeed(WorkspaceContext.WorkspaceContext, {
          execute: () => Effect.succeed(emptyWorkspaceResult),
        });
        const generalSubagentLayer = Layer.succeed(
          GeneralSubagents.GeneralSubagentCoordinator,
          GeneralSubagents.GeneralSubagentCoordinator.of({
            listModels: () => Effect.die("unused"),
            spawn: () => Effect.die("unused"),
            wait: () => Effect.die("unused"),
            cancel: () => Effect.die("unused"),
          }),
        );
        const routes = McpHttpServer.layer.pipe(
          Layer.provide(registryLayer),
          Layer.provide(projectionLayer),
          Layer.provide(workspaceLayer),
          Layer.provide(generalSubagentLayer),
          Layer.provide(PreviewAutomationBroker.layer.pipe(Layer.provide(NodeServices.layer))),
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
          const body = JSON.parse(yield* response.text) as {
            readonly result: {
              readonly tools: ReadonlyArray<{
                readonly name: string;
                readonly annotations?: {
                  readonly readOnlyHint?: boolean;
                  readonly destructiveHint?: boolean;
                  readonly idempotentHint?: boolean;
                  readonly openWorldHint?: boolean;
                };
              }>;
            };
          };
          return body.result.tools;
        });

        const rejected = yield* initialize("/mcp/workspace", "preview-token");
        expect(rejected.status).toBe(401);

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
        expect(previewTools.map(({ name }) => name)).not.toContain("workspace_context");
        expect(previewTools.find(({ name }) => name === "project_agent_send")?.annotations).toEqual(
          {
            title: "Message project agents",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
        );
        expect(previewTools.find(({ name }) => name === "subagent_spawn")?.annotations).toEqual({
          title: "Spawn general subagent",
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
        expect(
          workspaceTools.find(({ name }) => name === "workspace_context")?.annotations,
        ).toEqual({
          title: "Search and read workspace context",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });

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
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).toContain("workspace_context");
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).toContain(
          "project_agent_list",
        );
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).toContain("subagent_spawn");
        expect(workspaceWithoutPreviewTools.map(({ name }) => name)).not.toContain(
          "preview_status",
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
        expect(coordinationTools.map(({ name }) => name)).not.toContain("workspace_context");
        expect(coordinationTools.map(({ name }) => name)).not.toContain("preview_status");

        const workspaceOnly = yield* initialize("/mcp/workspace-only", "workspace-only-token");
        expect(workspaceOnly.status).toBe(200);
        const workspaceOnlyTools = yield* listTools(
          "/mcp/workspace-only",
          "workspace-only-token",
          workspaceOnly.headers["mcp-session-id"]!,
        );
        expect(workspaceOnlyTools.map(({ name }) => name)).toEqual(["workspace_context"]);
      }),
    ).pipe(Effect.provide(NodeHttpServer.layerTest)),
);

it.effect("registers annotated tools and preserves authenticated request context", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
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
              ? {
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
                }
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
      expect(clickTool?.tool.outputSchema).toEqual({
        type: "object",
        additionalProperties: false,
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
        expect(result.structuredContent).toEqual({});
        expect(result.content).toEqual([{ type: "text", text: "{}" }]);
      }
    }),
  ).pipe(Effect.provide(TestLayer)),
);
