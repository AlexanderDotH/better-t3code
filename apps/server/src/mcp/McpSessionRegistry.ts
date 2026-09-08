import {
  CLAUDE_DRIVER_KIND,
  CODEX_DRIVER_KIND,
  CURSOR_DRIVER_KIND,
  OPENCODE_DRIVER_KIND,
  ProviderInstanceId,
  resolveBetterT3FeatureFlag,
  ThreadId,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { HttpServer } from "effect/unstable/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpProviderSession from "./McpProviderSession.ts";

export interface McpCredentialRequest {
  readonly threadId: ThreadId;
  readonly workspaceContextThreadId?: ThreadId;
  /** True selects core-only; explicit false requests the full optional profile. */
  readonly workspaceOnly?: boolean;
  /** False omits project memory when memory is disabled or provider-managed. */
  readonly projectMemoryEnabled?: boolean;
  readonly previewEnabled?: boolean;
  /** True selects a writable profile in addition to ordinary workspace reads. */
  readonly workspaceWriteEnabled?: boolean;
  readonly providerInstanceId: ProviderInstanceId;
  readonly provider: ProviderDriverKind;
}

export interface McpIssuedCredential {
  readonly config: McpProviderSession.McpProviderSessionConfig;
}

export interface McpSessionRegistryShape {
  readonly issue: (request: McpCredentialRequest) => Effect.Effect<McpIssuedCredential>;
  readonly resolve: (
    rawToken: string,
  ) => Effect.Effect<McpInvocationContext.McpInvocationScope | undefined>;
  /**
   * Records a sign of life for every credential bound to `threadId`. Provider
   * turns call this so that a session which is plainly alive keeps its
   * credential even when it goes a long time without touching an MCP tool.
   */
  readonly touch: (threadId: ThreadId) => Effect.Effect<void>;
  readonly revokeProviderSession: (providerSessionId: string) => Effect.Effect<void>;
  readonly revokeThread: (threadId: ThreadId) => Effect.Effect<void>;
  readonly revokeAll: Effect.Effect<void>;
}

export class McpSessionRegistry extends Context.Service<
  McpSessionRegistry,
  McpSessionRegistryShape
>()("t3/mcp/McpSessionRegistry") {}

interface CredentialRecord {
  readonly tokenHash: string;
  readonly ownerThreadId: ThreadId;
  readonly scope: McpInvocationContext.McpInvocationScope;
  readonly lastAliveAt: number;
}

interface RegistryState {
  readonly records: ReadonlyMap<string, CredentialRecord>;
}

export interface McpSessionRegistryOptions {
  readonly livenessWindowMs?: number;
  readonly now?: () => number;
}

/**
 * How long a credential outlives the last sign of life from its provider
 * session.
 *
 * Liveness is refreshed both by MCP traffic and by `touch` on every provider
 * turn, so a session that is still doing work never expires no matter how long
 * it goes between browser tool calls. This window therefore only bounds
 * credentials whose session died without a clean stop — the normal paths
 * (`stopSession`, `stopAll`) revoke eagerly and do not wait for it.
 *
 * The bound matters because the provider-scoped MCP endpoints are mounted
 * outside the environment auth stack and are reachable on whatever host the
 * server binds to. This token is the only thing guarding those toolkits on a
 * remote-reachable server.
 */
const DEFAULT_LIVENESS_WINDOW_MS = 24 * 60 * 60 * 1_000;

const WORKSPACE_CONTEXT_PROVIDERS = new Set<ProviderDriverKind>([
  CODEX_DRIVER_KIND,
  CLAUDE_DRIVER_KIND,
  CURSOR_DRIVER_KIND,
  OPENCODE_DRIVER_KIND,
]);

const supportsWorkspaceContext = (provider: ProviderDriverKind): boolean =>
  WORKSPACE_CONTEXT_PROVIDERS.has(provider);

const OPTIONAL_T3_TOOL_FEATURES = [
  "knowledge.graph",
  "agent.projectCoordination",
  "agent.generalSubagents",
] as const;

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const tokenFromBytes = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const getHttpMcpEndpointHost = (hostname: string): string => {
  const normalized = hostname.toLowerCase();
  const endpointHostname =
    normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]"
      ? "127.0.0.1"
      : hostname;
  return endpointHostname.includes(":") && !endpointHostname.startsWith("[")
    ? `[${endpointHostname}]`
    : endpointHostname;
};

const makeWithOptions = Effect.fn("McpSessionRegistry.make")(function* (
  options: McpSessionRegistryOptions = {},
) {
  const crypto = yield* Crypto.Crypto;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const serverSettings = Option.getOrUndefined(
    yield* Effect.serviceOption(ServerSettings.ServerSettingsService),
  );
  const environmentId = yield* environment.getEnvironmentId;
  const httpServer = yield* HttpServer.HttpServer;
  const state = yield* SynchronizedRef.make<RegistryState>({ records: new Map() });
  const currentTimeMillis = options.now ? Effect.sync(options.now) : Clock.currentTimeMillis;
  const livenessWindowMs = options.livenessWindowMs ?? DEFAULT_LIVENESS_WINDOW_MS;
  const endpointBase =
    httpServer.address._tag === "TcpAddress"
      ? `http://${getHttpMcpEndpointHost(httpServer.address.hostname)}:${httpServer.address.port}`
      : "http://127.0.0.1";

  const hashToken = (token: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(token))
      .pipe(Effect.map(bytesToHex), Effect.orDie);

  const pruneDead = (records: ReadonlyMap<string, CredentialRecord>, timestamp: number) => {
    const next = new Map(
      Array.from(records).filter(
        ([, record]) => timestamp - record.lastAliveAt <= livenessWindowMs,
      ),
    );
    return next.size === records.size ? records : next;
  };

  const issue: McpSessionRegistryShape["issue"] = Effect.fn("McpSessionRegistry.issue")(
    function* (request) {
      const issuedAt = yield* currentTimeMillis;
      const workspaceContextEnabled = supportsWorkspaceContext(request.provider);
      const workspaceWriteEnabled =
        workspaceContextEnabled && request.workspaceWriteEnabled === true;
      const previewEnabled = request.previewEnabled !== false;
      const configuredOptionalGroups = serverSettings
        ? yield* serverSettings.getSettings.pipe(
            Effect.map((settings) =>
              OPTIONAL_T3_TOOL_FEATURES.some((feature) =>
                resolveBetterT3FeatureFlag(settings.betterT3Environment, feature),
              ),
            ),
            Effect.catch((cause) =>
              Effect.logWarning(
                "Could not read optional T3 tool settings; using the core MCP profile.",
                { cause },
              ).pipe(Effect.as(false)),
            ),
          )
        : false;
      const coreWorkspaceOnly =
        request.workspaceOnly === true ||
        (workspaceContextEnabled &&
          !previewEnabled &&
          !configuredOptionalGroups &&
          request.workspaceOnly === undefined);
      const projectMemoryEnabled = request.projectMemoryEnabled !== false;
      const providerSessionId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      const rawToken = yield* crypto.randomBytes(32).pipe(Effect.map(tokenFromBytes), Effect.orDie);
      const tokenHash = yield* hashToken(rawToken);
      const capabilities: ReadonlySet<McpInvocationContext.McpCapability> = coreWorkspaceOnly
        ? workspaceContextEnabled
          ? new Set(["workspace", ...(workspaceWriteEnabled ? (["workspace-write"] as const) : [])])
          : new Set()
        : workspaceContextEnabled
          ? previewEnabled
            ? new Set([
                "preview",
                "workspace",
                ...(workspaceWriteEnabled ? (["workspace-write"] as const) : []),
                "coordination",
              ])
            : new Set([
                "workspace",
                ...(workspaceWriteEnabled ? (["workspace-write"] as const) : []),
                "coordination",
              ])
          : previewEnabled
            ? new Set(["preview", "coordination"])
            : new Set(["coordination"]);
      const readEndpointPath = coreWorkspaceOnly
        ? projectMemoryEnabled
          ? "/mcp/workspace-only"
          : "/mcp/workspace-only-no-memory"
        : workspaceContextEnabled
          ? previewEnabled
            ? projectMemoryEnabled
              ? "/mcp/workspace"
              : "/mcp/workspace-no-memory"
            : projectMemoryEnabled
              ? "/mcp/workspace-no-preview"
              : "/mcp/workspace-no-preview-no-memory"
          : previewEnabled
            ? "/mcp"
            : "/mcp/coordination";
      const endpointPath = workspaceWriteEnabled
        ? readEndpointPath.replace("/mcp/workspace", "/mcp/workspace-write")
        : readEndpointPath;
      const scope: McpInvocationContext.McpInvocationScope = {
        environmentId,
        ownerThreadId: request.threadId,
        threadId: ThreadId.make(request.workspaceContextThreadId ?? request.threadId),
        providerSessionId,
        providerInstanceId: ProviderInstanceId.make(request.providerInstanceId),
        capabilities,
        issuedAt,
      };
      yield* SynchronizedRef.update(state, ({ records }) => {
        const next = new Map(pruneDead(records, issuedAt));
        next.set(tokenHash, {
          tokenHash,
          ownerThreadId: request.threadId,
          scope,
          lastAliveAt: issuedAt,
        });
        return { records: next };
      });
      return {
        config: {
          environmentId,
          threadId: request.threadId,
          providerSessionId,
          providerInstanceId: scope.providerInstanceId,
          endpoint: `${endpointBase}${endpointPath}`,
          authorizationHeader: `Bearer ${rawToken}`,
        },
      };
    },
  );

  const resolve: McpSessionRegistryShape["resolve"] = Effect.fn("McpSessionRegistry.resolve")(
    function* (rawToken) {
      if (rawToken.length === 0) return undefined;
      const tokenHash = yield* hashToken(rawToken);
      const timestamp = yield* currentTimeMillis;
      return yield* SynchronizedRef.modify(state, ({ records }) => {
        const current = pruneDead(records, timestamp);
        const record = current.get(tokenHash);
        if (!record) return [undefined, { records: current }] as const;
        const next = new Map(current);
        next.set(tokenHash, { ...record, lastAliveAt: timestamp });
        return [record.scope, { records: next }] as const;
      });
    },
  );

  const touch: McpSessionRegistryShape["touch"] = Effect.fn("McpSessionRegistry.touch")(
    function* (threadId) {
      const timestamp = yield* currentTimeMillis;
      yield* SynchronizedRef.update(state, ({ records }) => {
        const current = pruneDead(records, timestamp);
        const next = new Map(current);
        for (const [tokenHash, record] of current) {
          if (record.ownerThreadId === threadId) {
            next.set(tokenHash, { ...record, lastAliveAt: timestamp });
          }
        }
        return { records: next };
      });
    },
  );

  const revokeWhere = (predicate: (record: CredentialRecord) => boolean) =>
    SynchronizedRef.update(state, ({ records }) => ({
      records: new Map(Array.from(records).filter(([, record]) => !predicate(record))),
    }));

  return McpSessionRegistry.of({
    issue,
    resolve,
    touch,
    revokeProviderSession: Effect.fn("McpSessionRegistry.revokeProviderSession")(
      function* (providerSessionId) {
        yield* revokeWhere((record) => record.scope.providerSessionId === providerSessionId);
      },
    ),
    revokeThread: Effect.fn("McpSessionRegistry.revokeThread")(function* (threadId) {
      yield* revokeWhere((record) => record.ownerThreadId === threadId);
    }),
    revokeAll: SynchronizedRef.set(state, { records: new Map() }),
  });
});

let activeMcpSessionRegistry: McpSessionRegistryShape | undefined;

const make = Effect.acquireRelease(
  makeWithOptions().pipe(
    Effect.tap((registry) =>
      Effect.sync(() => {
        activeMcpSessionRegistry = registry;
      }),
    ),
  ),
  (registry) =>
    Effect.sync(() => {
      if (activeMcpSessionRegistry === registry) {
        activeMcpSessionRegistry = undefined;
      }
    }),
);

export const layer = Layer.effect(McpSessionRegistry, make);

export const issueActiveMcpCredential = (
  request: McpCredentialRequest,
): Effect.Effect<McpIssuedCredential | undefined> =>
  activeMcpSessionRegistry
    ? activeMcpSessionRegistry
        .revokeThread(request.threadId)
        .pipe(Effect.andThen(activeMcpSessionRegistry.issue(request)))
    : Effect.sync((): McpIssuedCredential | undefined => undefined);

/**
 * Refreshes the liveness of a thread's MCP credential. Called on every provider
 * turn so an active session is never mistaken for an abandoned one.
 */
export const touchActiveMcpThread = (threadId: ThreadId): Effect.Effect<void> =>
  activeMcpSessionRegistry ? activeMcpSessionRegistry.touch(threadId) : Effect.void;

export const revokeActiveMcpThread = (threadId: ThreadId): Effect.Effect<void> =>
  activeMcpSessionRegistry ? activeMcpSessionRegistry.revokeThread(threadId) : Effect.void;

export const revokeAllActiveMcpCredentials = (): Effect.Effect<void> =>
  activeMcpSessionRegistry ? activeMcpSessionRegistry.revokeAll : Effect.void;

/** Exposed for tests. */
export const __testing = {
  make: makeWithOptions,
};
