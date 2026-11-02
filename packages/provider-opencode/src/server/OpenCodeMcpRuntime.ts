import {
  McpRuntimeError,
  McpRuntimeServerKey,
  McpServerId,
  McpServerName,
  RuntimeSessionId,
  type McpRuntimeResource,
  type McpRuntimeResourceTemplate,
  type McpRuntimeServer,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderSessionId,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import type { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import type {
  ProviderAdapterShape,
  ProviderMcpRuntimeTarget,
} from "@t3tools/provider-core/server/mcpRuntime";
import type { OpenCodeMcpServerConfig } from "@t3tools/provider-core/server/mcpConfiguration";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";

export interface OpenCodeMcpStatus {
  readonly name: string;
  readonly status:
    | "connected"
    | "pending"
    | "disabled"
    | "failed"
    | "needs_auth"
    | "needs_client_registration";
  readonly error?: string | undefined;
  readonly canAuthorize: boolean;
}

export interface OpenCodeMcpClient {
  readonly statuses: Effect.Effect<ReadonlyArray<OpenCodeMcpStatus>, Error>;
  readonly details?: (name: string) => Effect.Effect<
    {
      readonly resources: ReadonlyArray<McpRuntimeResource>;
      readonly templates: ReadonlyArray<McpRuntimeResourceTemplate>;
    },
    Error
  >;
  readonly reconnect: (
    name: string,
    checkCurrent: Effect.Effect<void, McpRuntimeError>,
  ) => Effect.Effect<void, Error>;
  readonly authorize?: (
    name: string,
    checkCurrent: Effect.Effect<void, McpRuntimeError>,
  ) => Effect.Effect<string, Error>;
  readonly applyConfiguration: (
    next: Readonly<Record<string, OpenCodeMcpServerConfig>>,
    previous: Readonly<Record<string, OpenCodeMcpServerConfig>>,
    checkCurrent: Effect.Effect<void, McpRuntimeError>,
  ) => Effect.Effect<void, Error>;
}

export interface OpenCodeMcpSession {
  readonly threadId: ThreadId;
  readonly providerSessionId: ProviderSessionId;
  readonly cwd: string;
  readonly model: string;
  readonly runtimeMode: RuntimeMode;
  readonly client: OpenCodeMcpClient;
  readonly builtInNames: ReadonlySet<string>;
  readonly configured: () => Readonly<Record<string, OpenCodeMcpServerConfig>>;
  readonly setConfigured: (servers: Readonly<Record<string, OpenCodeMcpServerConfig>>) => void;
  readonly resolveConfiguration: Effect.Effect<
    Readonly<Record<string, OpenCodeMcpServerConfig>>,
    Error
  >;
}

const keyFor = (name: string) =>
  McpRuntimeServerKey.make(name.trim().slice(0, 512) || "unknown-server");

function normalizeServer(
  status: OpenCodeMcpStatus,
  input: ProviderMcpRuntimeTarget,
  session: OpenCodeMcpSession,
  observedAt: string,
): McpRuntimeServer {
  const config = session.configured()[status.name];
  const builtIn = session.builtInNames.has(status.name);
  const state =
    status.status === "needs_auth"
      ? "auth-required"
      : status.status === "needs_client_registration"
        ? "setup-required"
        : status.status === "pending"
          ? "starting"
          : status.status;
  return {
    ...input,
    providerKey: keyFor(status.name),
    name: McpServerName.make(status.name.trim().slice(0, 128) || "Unknown MCP server"),
    source: builtIn ? "t3-built-in" : config === undefined ? "provider-native" : "t3-managed",
    ...(config === undefined
      ? {}
      : {
          serverId: McpServerId.make(
            status.name.startsWith("t3-managed:")
              ? status.name.slice("t3-managed:".length)
              : status.name,
          ),
          transport: config.type === "local" ? ("stdio" as const) : ("http" as const),
        }),
    state,
    statusSource: "provider-query",
    observedAt,
    authState:
      status.status === "connected"
        ? "authenticated"
        : status.status === "needs_auth"
          ? "required"
          : status.status === "disabled"
            ? "none"
            : "unknown",
    availableActions: status.canAuthorize
      ? ["refresh", "reconnect", "authorize"]
      : ["refresh", "reconnect"],
    reportsTools: false,
    ...(status.error?.trim() ? { issue: { message: status.error.trim().slice(0, 1_024) } } : {}),
    configDrift: "none",
  };
}

export const make = Effect.fn("OpenCodeMcpRuntime.make")(function* (
  host: ProviderHost["Service"],
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
) {
  const factoryScope = yield* Effect.scope;
  const sessions = new Map<ThreadId, OpenCodeMcpSession>();
  let registered = false;

  const requireSession = Effect.fn("OpenCodeMcpRuntime.requireSession")(function* (
    target: ProviderMcpRuntimeTarget,
  ) {
    const session = sessions.get(target.threadId);
    if (target.providerInstanceId !== instanceId || session === undefined) {
      return yield* new McpRuntimeError({
        code: "context-not-found",
        detail: "This OpenCode MCP session is no longer active.",
      });
    }
    if (RuntimeSessionId.make(session.providerSessionId) !== target.runtimeSessionId) {
      return yield* new McpRuntimeError({
        code: "session-replaced",
        detail: "This OpenCode MCP session has been replaced.",
      });
    }
    return session;
  });
  const checkSession = (target: ProviderMcpRuntimeTarget, session: OpenCodeMcpSession) =>
    requireSession(target).pipe(
      Effect.filterOrFail(
        (current) => current === session,
        () =>
          new McpRuntimeError({
            code: "session-replaced",
            detail: "This OpenCode MCP session has been replaced.",
          }),
      ),
      Effect.asVoid,
    );
  const read = Effect.fn("OpenCodeMcpRuntime.read")(function* (target: ProviderMcpRuntimeTarget) {
    const session = yield* requireSession(target);
    const statuses = yield* session.client.statuses;
    yield* checkSession(target, session);
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    const reported = statuses.map((status) => normalizeServer(status, target, session, observedAt));
    for (const [name, config] of Object.entries(session.configured())) {
      if (statuses.some((status) => status.name === name)) continue;
      reported.push({
        ...normalizeServer(
          { name, status: config.enabled === false ? "disabled" : "pending", canAuthorize: false },
          target,
          session,
          observedAt,
        ),
        state: config.enabled === false ? "disabled" : "unknown",
        statusSource: "configuration",
      });
    }
    return { session, statuses, servers: reported };
  });
  const findServer = Effect.fn("OpenCodeMcpRuntime.findServer")(function* (
    target: ProviderMcpRuntimeTarget & { readonly providerKey: McpRuntimeServerKey },
  ) {
    const view = yield* read(target);
    const server = view.servers.find((candidate) => candidate.providerKey === target.providerKey);
    const matches = view.statuses.filter(
      (candidate) => keyFor(candidate.name) === target.providerKey,
    );
    if (server === undefined || matches.length > 1) {
      return yield* new McpRuntimeError({
        code: "server-not-found",
        detail: "OpenCode did not report an unambiguous MCP server with this name.",
      });
    }
    return { ...view, server, name: matches[0]?.name ?? target.providerKey };
  });

  const adapter = {
    capabilities: { mcp: "nativeConfig" },
    mcpRuntime: {
      getSnapshot: (target) => read(target).pipe(Effect.map((view) => view.servers)),
      getServerDetails: Effect.fn("OpenCodeMcpRuntime.details")(function* (target) {
        const view = yield* findServer(target);
        const details =
          view.session.client.details === undefined
            ? { resources: [], templates: [] }
            : yield* view.session.client.details(view.name);
        yield* checkSession(target, view.session);
        return { server: view.server, tools: [], ...details };
      }),
      runAction: Effect.fn("OpenCodeMcpRuntime.action")(function* (target) {
        const view = yield* findServer(target);
        let authorizationUrl: string | undefined;
        if (target.action === "reconnect") {
          yield* view.session.client.reconnect(view.name, checkSession(target, view.session));
        } else if (target.action === "authorize") {
          if (
            !view.server.availableActions.includes("authorize") ||
            view.session.client.authorize === undefined
          ) {
            return yield* new McpRuntimeError({
              code: "action-unsupported",
              detail: "This OpenCode MCP server does not support OAuth authorization.",
            });
          }
          const authorization = yield* view.session.client.authorize(
            view.name,
            checkSession(target, view.session),
          );
          authorizationUrl = authorization;
          const url = yield* Effect.try({
            try: () => new URL(authorization),
            catch: () =>
              new McpRuntimeError({
                code: "authorization-unavailable",
                detail: "OpenCode returned an invalid authorization URL.",
              }),
          });
          if (url.protocol !== "https:" && url.protocol !== "http:")
            return yield* new McpRuntimeError({
              code: "authorization-unavailable",
              detail: "OpenCode returned an unsupported authorization URL.",
            });
        }
        yield* checkSession(target, view.session);
        return {
          accepted: true,
          action: target.action,
          providerKey: target.providerKey,
          ...(authorizationUrl === undefined ? {} : { authorizationUrl }),
        };
      }),
      applyConfiguration: Effect.fn("OpenCodeMcpRuntime.applyConfiguration")(function* (target) {
        const session = yield* requireSession(target);
        const next = yield* session.resolveConfiguration;
        yield* checkSession(target, session);
        yield* session.client.applyConfiguration(
          next,
          session.configured(),
          checkSession(target, session),
        );
        yield* checkSession(target, session);
        session.setConfigured(next);
      }),
    },
  } satisfies ProviderAdapterShape<Error>;

  const attach = Effect.fn("OpenCodeMcpRuntime.attach")(function* (session: OpenCodeMcpSession) {
    if (host.mcpRuntime !== undefined && !registered) {
      yield* host.mcpRuntime
        .registerAdapter(instanceId, adapter)
        .pipe(Effect.provideService(Scope.Scope, factoryScope));
      registered = true;
    }
    const current = sessions.get(session.threadId);
    if (current?.providerSessionId === session.providerSessionId) return;
    const target = {
      providerInstanceId: instanceId,
      threadId: session.threadId,
      runtimeSessionId: RuntimeSessionId.make(session.providerSessionId),
    };
    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const now = DateTime.formatIso(yield* DateTime.now);
        if (host.mcpRuntime !== undefined)
          yield* host.mcpRuntime.registerSession({
            provider: driver,
            providerInstanceId: instanceId,
            threadId: session.threadId,
            runtimeSessionId: target.runtimeSessionId,
            status: "ready",
            runtimeMode: session.runtimeMode,
            cwd: session.cwd,
            model: session.model,
            createdAt: now,
            updatedAt: now,
          });
        sessions.set(session.threadId, session);
      }),
      () =>
        Effect.gen(function* () {
          if (sessions.get(session.threadId) === session) sessions.delete(session.threadId);
          if (host.mcpRuntime !== undefined) yield* host.mcpRuntime.endSession(target);
        }),
    );
  });
  const detach = Effect.fn("OpenCodeMcpRuntime.detach")(function* (
    threadId: ThreadId,
    providerSessionId: ProviderSessionId,
  ) {
    if (sessions.get(threadId)?.providerSessionId !== providerSessionId) return;
    sessions.delete(threadId);
    if (host.mcpRuntime !== undefined)
      yield* host.mcpRuntime.endSession({
        providerInstanceId: instanceId,
        threadId,
        runtimeSessionId: RuntimeSessionId.make(providerSessionId),
      });
  });
  return { adapter, attach, detach };
});
