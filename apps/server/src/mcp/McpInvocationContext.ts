import {
  type EnvironmentId,
  ProjectAgentCoordinationUnavailableError,
  McpCapabilityUnavailableError,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
  WorkspaceContextUnavailableError,
  WorkspaceEditError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type McpCapability =
  | "preview"
  | "workspace"
  | "workspace-write"
  | "coordination"
  | "device"
  | "pull-requests";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  /** Authenticated runtime thread that owns this MCP credential. */
  readonly ownerThreadId?: ThreadId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

/** The error a missing capability surfaces as; preview keeps its own so the broker can route it. */
export type McpCapabilityError<C extends McpCapability> = C extends "preview"
  ? PreviewAutomationUnavailableError
  : McpCapabilityUnavailableError;

const missingCapability = (
  invocation: McpInvocationScope,
  capability: McpCapability,
): PreviewAutomationUnavailableError | McpCapabilityUnavailableError => {
  const fields = {
    environmentId: invocation.environmentId,
    threadId: invocation.threadId,
    providerSessionId: invocation.providerSessionId,
    providerInstanceId: invocation.providerInstanceId,
  };
  return capability === "preview"
    ? new PreviewAutomationUnavailableError({ capability, ...fields })
    : new McpCapabilityUnavailableError({ capability, ...fields });
};

export const requireMcpCapability = <const C extends McpCapability>(
  capability: C,
): Effect.Effect<McpInvocationScope, McpCapabilityError<C>, McpInvocationContext> =>
  McpInvocationContext.pipe(
    Effect.filterOrFail(
      (invocation) => invocation.capabilities.has(capability),
      // The conditional type narrows what the literal argument decided at runtime.
      (invocation) => missingCapability(invocation, capability) as McpCapabilityError<C>,
    ),
    Effect.withSpan("mcp.requireCapability"),
  );
export const requireWorkspaceMcpCapability = Effect.fn("mcp.requireWorkspaceCapability")(
  function* () {
    const invocation = yield* McpInvocationContext;
    if (!invocation.capabilities.has("workspace")) {
      return yield* new WorkspaceContextUnavailableError({
        reason: "credential_not_authorized",
      });
    }
    return invocation;
  },
);

export const requireWorkspaceWriteMcpCapability = Effect.fn("mcp.requireWorkspaceWriteCapability")(
  function* () {
    const invocation = yield* McpInvocationContext;
    if (!invocation.capabilities.has("workspace-write")) {
      return yield* new WorkspaceEditError({ reason: "credential_not_authorized" });
    }
    return invocation;
  },
);

export const requireCoordinationMcpCapability = Effect.fn("mcp.requireCoordinationCapability")(
  function* () {
    const invocation = yield* McpInvocationContext;
    if (!invocation.capabilities.has("coordination")) {
      return yield* new ProjectAgentCoordinationUnavailableError({
        reason: "credential_not_authorized",
      });
    }
    return invocation;
  },
);
