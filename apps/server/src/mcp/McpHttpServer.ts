import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { McpProtocol, McpSchema, McpServer, Tool } from "effect/unstable/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import packageJson from "../../package.json" with { type: "json" };
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as ResourceProtection from "../resourceProtection/SubagentResourceGovernor.ts";
import { ProviderDriverKind } from "@t3tools/contracts";
import {
  PreviewSnapshotToolkitHandlersLive,
  PreviewStandardToolkitHandlersLive,
} from "./toolkits/preview/handlers.ts";
import {
  PreviewSnapshotTool,
  PreviewSnapshotToolkit,
  PreviewStandardToolkit,
} from "./toolkits/preview/tools.ts";
import { WorkspaceToolkitHandlersLive } from "./toolkits/workspace/handlers.ts";
import { WorkspaceToolkit } from "./toolkits/workspace/tools.ts";
import { CoordinationToolkitHandlersLive } from "./toolkits/coordination/handlers.ts";
import { CoordinationToolkit } from "./toolkits/coordination/tools.ts";

const unauthorized = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mcp_credential",
    message: "A valid provider-scoped MCP bearer credential is required.",
  },
  {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": "Bearer",
    },
  },
);

type AuthenticatedHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpInvocationContext.McpInvocationContext
>;

type McpAuthMiddleware = (
  httpEffect: AuthenticatedHttpEffect,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest
>;

export const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    response.body._tag === "Empty" ||
    (response.body._tag === "Uint8Array" && response.body.contentLength === 0) ||
    (response.body._tag === "Raw" && response.body.contentLength === 0);
  return response.status === 200 && bodyIsEmpty
    ? HttpServerResponse.setStatus(response, 202)
    : response;
};

const makeMcpAuthMiddleware = (requiredCapability?: McpInvocationContext.McpCapability) =>
  McpSessionRegistry.McpSessionRegistry.pipe(
    Effect.map(
      (registry): McpAuthMiddleware =>
        Effect.fn("McpHttpServer.authenticateRequest")(function* (httpEffect) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const authorization = request.headers.authorization;
          const token =
            authorization?.startsWith("Bearer ") === true
              ? authorization.slice("Bearer ".length).trim()
              : "";
          const invocation = yield* registry.resolve(token);
          if (!invocation) {
            // Without this the only symptom of a dead credential is the agent
            // quietly losing the whole `t3-code` toolkit for the rest of its
            // session, with nothing on the server to explain why.
            yield* Effect.logWarning("rejected MCP request with an unusable credential", {
              reason: token.length === 0 ? "missing_bearer_token" : "unknown_or_expired_token",
            });
            return unauthorized;
          }
          if (
            requiredCapability !== undefined &&
            !invocation.capabilities.has(requiredCapability)
          ) {
            yield* Effect.logWarning("rejected MCP request without endpoint capability", {
              requiredCapability,
            });
            return unauthorized;
          }
          return yield* httpEffect.pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.map(normalizeMcpHttpResponse),
          );
        }),
    ),
    Effect.withSpan("McpHttpServer.makeAuthMiddleware", {
      attributes: {
        "mcp.required_capability": requiredCapability ?? "preview",
      },
    }),
  );

const makeMcpAuthMiddlewareLive = (requiredCapability?: McpInvocationContext.McpCapability) =>
  HttpRouter.middleware<{
    provides: McpInvocationContext.McpInvocationContext;
  }>()(makeMcpAuthMiddleware(requiredCapability)).layer;

const previewSnapshotFailure = <E>(cause: Cause.Cause<E>) => {
  if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
    return Effect.failCause(cause).pipe(Effect.orDie);
  }
  const failures = cause.reasons.filter(Cause.isFailReason);
  const firstFailure = failures[0]?.error;
  const errorTag =
    typeof firstFailure === "object" &&
    firstFailure !== null &&
    "_tag" in firstFailure &&
    typeof firstFailure._tag === "string"
      ? firstFailure._tag
      : "PreviewSnapshotError";
  const result = new McpSchema.CallToolResult({
    isError: true,
    structuredContent: {
      error: {
        _tag: errorTag,
        operation: "snapshot",
        failureCount: failures.length,
      },
    },
    content: [{ type: "text", text: "Preview snapshot failed." }],
  });
  return Effect.logWarning("preview snapshot failed", {
    operation: "snapshot",
    errorTag,
    failureCount: failures.length,
  }).pipe(Effect.as(result));
};

const registerPreviewSnapshot = Effect.fn("McpHttpServer.registerPreviewSnapshot")(function* () {
  const server = yield* McpServer.McpServer;
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const built = yield* PreviewSnapshotToolkit;
  const tool = PreviewSnapshotTool;
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: Tool.getJsonSchema(tool),
      annotations: {
        ...Context.getOption(tool.annotations, Tool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined,
        ),
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
    }),
    annotations: tool.annotations,
    handle: (payload) =>
      Effect.withFiber((fiber) => {
        const invocation = Context.getUnsafe(
          fiber.context,
          McpInvocationContext.McpInvocationContext,
        );
        return built.handle("preview_snapshot", payload).pipe(
          Stream.unwrap,
          Stream.run(Sink.last()),
          Effect.flatMap(Effect.fromOption),
          Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.matchCauseEffect({
            onFailure: previewSnapshotFailure,
            onSuccess: ({ encodedResult }) => {
              const snapshot = encodedResult as {
                readonly screenshot: {
                  readonly mimeType: "image/png";
                  readonly data: string;
                  readonly width: number;
                  readonly height: number;
                };
                readonly [key: string]: unknown;
              };
              const { screenshot, ...page } = snapshot;
              const metadata = {
                ...page,
                screenshot: {
                  mimeType: screenshot.mimeType,
                  width: screenshot.width,
                  height: screenshot.height,
                },
              };
              return Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: metadata,
                  content: [
                    { type: "text", text: JSON.stringify(metadata) },
                    {
                      type: "image",
                      data: new Uint8Array(Buffer.from(screenshot.data, "base64")),
                      mimeType: screenshot.mimeType,
                    },
                  ],
                }),
              );
            },
          }),
        );
      }),
  });
});

const PreviewStandardToolkitRegistrationLive = McpServer.toolkit(PreviewStandardToolkit).pipe(
  Layer.provide(PreviewStandardToolkitHandlersLive),
);

const PreviewSnapshotRegistrationLive = Layer.effectDiscard(registerPreviewSnapshot()).pipe(
  Layer.provide(PreviewSnapshotToolkitHandlersLive),
);

export const PreviewToolkitRegistrationLive = Layer.mergeAll(
  PreviewStandardToolkitRegistrationLive,
  PreviewSnapshotRegistrationLive,
);

export const WorkspaceToolkitRegistrationLive = McpServer.toolkit(WorkspaceToolkit).pipe(
  Layer.provide(WorkspaceToolkitHandlersLive),
);

export const CoordinationToolkitRegistrationLive = McpServer.toolkit(CoordinationToolkit).pipe(
  Layer.provide(CoordinationToolkitHandlersLive),
);

export const WorkspaceOnlyToolkitRegistrationLive = WorkspaceToolkitRegistrationLive;

export const WorkspaceWithoutPreviewToolkitRegistrationLive = Layer.mergeAll(
  CoordinationToolkitRegistrationLive,
  WorkspaceToolkitRegistrationLive,
);

export const CoordinationEnabledToolkitRegistrationLive = Layer.mergeAll(
  PreviewToolkitRegistrationLive,
  CoordinationToolkitRegistrationLive,
);

export const WorkspaceEnabledToolkitRegistrationLive = Layer.mergeAll(
  CoordinationEnabledToolkitRegistrationLive,
  WorkspaceToolkitRegistrationLive,
);

const makeMcpTransportLive = (
  path:
    | "/mcp"
    | "/mcp/coordination"
    | "/mcp/workspace"
    | "/mcp/workspace-no-preview"
    | "/mcp/workspace-only",
  requiredCapability?: McpInvocationContext.McpCapability,
) =>
  McpServer.layerHttp({
    name: "T3 Code",
    version: packageJson.version,
    path,
    protocols: [McpProtocol.v2025_06_18],
  }).pipe(Layer.provide(makeMcpAuthMiddlewareLive(requiredCapability)));

const PreviewMcpEndpointLive = Layer.fresh(
  CoordinationEnabledToolkitRegistrationLive.pipe(Layer.provideMerge(makeMcpTransportLive("/mcp"))),
);

const WorkspaceMcpEndpointLive = Layer.fresh(
  WorkspaceEnabledToolkitRegistrationLive.pipe(
    Layer.provideMerge(makeMcpTransportLive("/mcp/workspace", "workspace")),
  ),
);

const CoordinationMcpEndpointLive = Layer.fresh(
  CoordinationToolkitRegistrationLive.pipe(
    Layer.provideMerge(makeMcpTransportLive("/mcp/coordination", "coordination")),
  ),
);

const WorkspaceWithoutPreviewMcpEndpointLive = Layer.fresh(
  WorkspaceWithoutPreviewToolkitRegistrationLive.pipe(
    Layer.provideMerge(makeMcpTransportLive("/mcp/workspace-no-preview", "workspace")),
  ),
);

const WorkspaceOnlyMcpEndpointLive = Layer.fresh(
  WorkspaceOnlyToolkitRegistrationLive.pipe(
    Layer.provideMerge(makeMcpTransportLive("/mcp/workspace-only", "workspace")),
  ),
);

const CodexResourceLifecycleId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(4_096),
);
const CodexResourceConfigurationKey = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(4_096),
);
const CodexResourceAction = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("admit-root-turn"),
    configurationKey: CodexResourceConfigurationKey,
    lifecycleId: CodexResourceLifecycleId,
  }),
  Schema.Struct({
    action: Schema.Literal("release-root-turn"),
    lifecycleId: CodexResourceLifecycleId,
  }),
  Schema.Struct({
    action: Schema.Literal("admit-subagent"),
    configurationKey: CodexResourceConfigurationKey,
    lifecycleId: CodexResourceLifecycleId,
  }),
  Schema.Struct({
    action: Schema.Literal("confirm-subagent"),
    configurationKey: CodexResourceConfigurationKey,
    agentId: CodexResourceLifecycleId,
  }),
  Schema.Struct({
    action: Schema.Literal("release-subagent"),
    agentId: CodexResourceLifecycleId,
  }),
]);
const decodeCodexResourceAction = Schema.decodeUnknownOption(CodexResourceAction);

export const CodexResourceAdmissionRouteLive = HttpRouter.add(
  "POST",
  "/internal/resource-protection/codex-admit",
  Effect.gen(function* () {
    const invocation = yield* McpInvocationContext.McpInvocationContext;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const governor = Option.getOrUndefined(
      yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor),
    );
    if (!governor) {
      return HttpServerResponse.jsonUnsafe(
        { admitted: false, state: "unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    const action = Option.getOrUndefined(
      decodeCodexResourceAction(yield* request.json.pipe(Effect.orElseSucceed(() => undefined))),
    );
    if (!action) {
      return HttpServerResponse.jsonUnsafe(
        { error: "invalid_resource_protection_action" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const owner = {
      threadId: invocation.threadId,
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: invocation.providerInstanceId,
    } as const;
    let admitted = true;
    switch (action.action) {
      case "admit-root-turn":
        admitted = yield* governor.awaitAdmission({
          ...owner,
          configurationKey: `root-turn:${action.configurationKey}`,
          retention: { kind: "root-turn", lifecycleId: action.lifecycleId },
        });
        break;
      case "release-root-turn":
        yield* governor.releaseRootTurn({ ...owner, lifecycleId: action.lifecycleId });
        break;
      case "admit-subagent":
        admitted = yield* governor.awaitAdmission({
          ...owner,
          configurationKey: `subagent:${action.configurationKey}`,
          retention: { kind: "subagent", lifecycleId: action.lifecycleId },
        });
        break;
      case "confirm-subagent":
        yield* governor.confirmSubagent({
          ...owner,
          configurationKey: `subagent:${action.configurationKey}`,
          agentId: action.agentId,
        });
        break;
      case "release-subagent":
        yield* governor.releaseSubagent({ ...owner, agentId: action.agentId });
        break;
    }
    return HttpServerResponse.jsonUnsafe(
      { admitted },
      {
        status: admitted ? 200 : 409,
        headers: { "cache-control": "no-store" },
      },
    );
  }),
).pipe(Layer.provide(makeMcpAuthMiddlewareLive()));

export const layer = Layer.mergeAll(
  PreviewMcpEndpointLive,
  WorkspaceMcpEndpointLive,
  CoordinationMcpEndpointLive,
  WorkspaceWithoutPreviewMcpEndpointLive,
  WorkspaceOnlyMcpEndpointLive,
  CodexResourceAdmissionRouteLive,
);
