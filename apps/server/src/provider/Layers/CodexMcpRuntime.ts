import type {
  McpServerDefinition,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import type { ProviderAdapterError } from "../Errors.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import type { CodexAdapterShape } from "../Services/CodexAdapter.ts";
import type { CodexAdapterSessionContext } from "./CodexAdapterSession.ts";
import type { CodexSessionRuntimeError } from "./CodexSessionRuntime.ts";
import {
  applyCodexMcpStartupObservation,
  codexManagedMcpServers,
  codexMcpAvailableActions,
  codexMcpProviderKey,
  findCodexMcpStatus,
  normalizeCodexMcpResource,
  normalizeCodexMcpResourceTemplate,
  normalizeCodexMcpServer,
  normalizeCodexMcpSnapshot,
  normalizeCodexMcpTool,
} from "./CodexMcpRuntimeView.ts";

const PROVIDER = ProviderDriverKind.make("codex");

type McpRuntimeInput = {
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
};

export interface CodexMcpRuntimeDependencies {
  readonly boundInstanceId: ProviderInstanceId;
  readonly requireSession: (
    input: McpRuntimeInput,
  ) => Effect.Effect<CodexAdapterSessionContext, ProviderAdapterError>;
  readonly mapRuntimeError: (
    threadId: ThreadId,
    method: string,
    error: CodexSessionRuntimeError,
  ) => ProviderAdapterError;
  readonly resolveMcpServers?: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<McpServerDefinition>>;
}

export function makeCodexMcpRuntime(dependencies: CodexMcpRuntimeDependencies) {
  const readStatuses = (
    session: CodexAdapterSessionContext,
    detail: EffectCodexSchema.V2ListMcpServerStatusParams__McpServerStatusDetail,
  ) =>
    session.runtime
      .listMcpServerStatuses(detail)
      .pipe(
        Effect.mapError((cause) =>
          dependencies.mapRuntimeError(session.threadId, "mcpServerStatus/list", cause),
        ),
      );

  const reloadStatuses = (session: CodexAdapterSessionContext) => {
    const previousStatuses = new Map(session.mcpStartupStatuses);
    return Effect.sync(() => session.mcpStartupStatuses.clear()).pipe(
      Effect.andThen(session.runtime.reloadMcpServers),
      Effect.tapError(() =>
        Effect.sync(() => {
          for (const [providerKey, status] of previousStatuses) {
            if (!session.mcpStartupStatuses.has(providerKey)) {
              session.mcpStartupStatuses.set(providerKey, status);
            }
          }
        }),
      ),
      Effect.mapError((cause) =>
        dependencies.mapRuntimeError(session.threadId, "config/mcpServer/reload", cause),
      ),
    );
  };

  const getSnapshot: NonNullable<CodexAdapterShape["mcpRuntime"]>["getSnapshot"] = Effect.fn(
    "CodexMcpRuntime.getSnapshot",
  )(function* (input) {
    const session = yield* dependencies.requireSession(input);
    const statuses = yield* readStatuses(session, "toolsAndAuthOnly");
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    return normalizeCodexMcpSnapshot({
      statuses,
      providerInstanceId: dependencies.boundInstanceId,
      threadId: session.threadId,
      runtimeSessionId: session.runtimeSessionId,
      observedAt,
      managedMcpServers: session.managedMcpServers,
      startupStatuses: session.mcpStartupStatuses,
      builtInMcpExpected: session.builtInMcpExpected,
    });
  });

  const getServerDetails: NonNullable<
    NonNullable<CodexAdapterShape["mcpRuntime"]>["getServerDetails"]
  > = Effect.fn("CodexMcpRuntime.getServerDetails")(function* (input) {
    const session = yield* dependencies.requireSession(input);
    const statuses = yield* readStatuses(session, "full");
    const providerKey = codexMcpProviderKey(input.providerKey);
    const status = findCodexMcpStatus(statuses, providerKey);
    if (!status) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "mcpServerStatus/list",
        detail: `Codex MCP server '${input.providerKey}' is not part of the selected runtime.`,
      });
    }
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    const server = applyCodexMcpStartupObservation(
      normalizeCodexMcpServer({
        status,
        providerInstanceId: dependencies.boundInstanceId,
        threadId: session.threadId,
        runtimeSessionId: session.runtimeSessionId,
        observedAt,
        managedMcpServers: session.managedMcpServers,
        builtInMcpExpected: session.builtInMcpExpected,
      }),
      session.mcpStartupStatuses.get(status.name),
    );
    const tools = Object.values(status.tools).flatMap((tool) => {
      const normalized = normalizeCodexMcpTool(tool);
      return normalized ? [normalized] : [];
    });
    const resources = status.resources.flatMap((resource) => {
      const normalized = normalizeCodexMcpResource(resource);
      return normalized ? [normalized] : [];
    });
    const templates = status.resourceTemplates.flatMap((template) => {
      const normalized = normalizeCodexMcpResourceTemplate(template);
      return normalized ? [normalized] : [];
    });
    return { server, tools, resources, templates };
  });

  const runAction: NonNullable<NonNullable<CodexAdapterShape["mcpRuntime"]>["runAction"]> =
    Effect.fn("CodexMcpRuntime.runAction")(function* (input) {
      const session = yield* dependencies.requireSession(input);
      const statuses = yield* readStatuses(session, "toolsAndAuthOnly");
      const providerKey = codexMcpProviderKey(input.providerKey);
      const status = findCodexMcpStatus(statuses, providerKey);
      if (!status) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "mcpServerStatus/list",
          detail: `Codex MCP server '${input.providerKey}' is not part of the selected runtime.`,
        });
      }

      if (input.action === "authorize") {
        const source =
          status.name === "t3-code" && session.builtInMcpExpected
            ? ("t3-built-in" as const)
            : session.managedMcpServers.has(status.name)
              ? ("t3-managed" as const)
              : ("provider-native" as const);
        if (!codexMcpAvailableActions(status, source).includes("authorize")) {
          return {
            accepted: false,
            action: input.action,
            providerKey,
            message: "Codex does not currently report an OAuth authorization requirement.",
          };
        }
        const authorization = yield* session.runtime
          .startMcpOauth({ serverName: status.name })
          .pipe(
            Effect.mapError((cause) =>
              dependencies.mapRuntimeError(session.threadId, "mcpServer/oauth/login", cause),
            ),
          );
        return {
          accepted: true,
          action: input.action,
          providerKey,
          authorizationUrl: authorization.authorizationUrl,
        };
      }

      yield* reloadStatuses(session);
      const refreshedStatuses = yield* readStatuses(session, "toolsAndAuthOnly");
      if (!findCodexMcpStatus(refreshedStatuses, providerKey)) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "config/mcpServer/reload",
          detail: `Codex MCP server '${input.providerKey}' was not reported after reload.`,
        });
      }
      return {
        accepted: true,
        action: input.action,
        providerKey,
        message:
          input.action === "reconnect"
            ? "Codex reloaded and rediscovered this MCP server."
            : "Codex refreshed this MCP server.",
      };
    });

  const applyConfiguration: NonNullable<
    NonNullable<CodexAdapterShape["mcpRuntime"]>["applyConfiguration"]
  > = Effect.fn("CodexMcpRuntime.applyConfiguration")(function* (input) {
    const session = yield* dependencies.requireSession(input);
    const desiredServers = dependencies.resolveMcpServers
      ? yield* dependencies.resolveMcpServers({ cwd: session.cwd })
      : Array.from(session.managedMcpServers.values());
    const desiredManagedServers = codexManagedMcpServers(desiredServers);
    const previouslyManagedKeys = new Set(session.managedMcpServers.keys());

    yield* reloadStatuses(session);
    const statuses = yield* readStatuses(session, "toolsAndAuthOnly");
    const observedKeys = new Set(statuses.map((status) => status.name));
    const missingKeys = Array.from(desiredManagedServers.keys()).filter(
      (providerKey) => !observedKeys.has(providerKey),
    );
    const lingeringKeys = Array.from(previouslyManagedKeys).filter(
      (providerKey) => !desiredManagedServers.has(providerKey) && observedKeys.has(providerKey),
    );

    if (missingKeys.length > 0 || lingeringKeys.length > 0) return "pending-next-session";
    session.managedMcpServers = desiredManagedServers;
    return "applied";
  });

  return { getSnapshot, getServerDetails, runAction, applyConfiguration } satisfies NonNullable<
    CodexAdapterShape["mcpRuntime"]
  >;
}
