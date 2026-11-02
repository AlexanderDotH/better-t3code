import type { McpServerDefinition, ProviderInstanceId } from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { ProviderAdapterProtocolError } from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderAdapterV2RuntimePolicy } from "@t3tools/provider-core/server/ProviderAdapter";
import type { CodexAppServerClient } from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { McpRuntimeRegistry } from "../mcp/McpRuntimeRegistry.ts";
import * as Option from "effect/Option";
import type {
  ProviderMcpRuntimeAdapter,
  ProviderMcpRuntimeTarget,
} from "../mcp/McpRuntimeAdapters.ts";
import {
  codexManagedMcpServers,
  normalizeCodexMcpSnapshot,
  normalizeCodexMcpServer,
  normalizeCodexMcpTool,
  normalizeCodexMcpResource,
  normalizeCodexMcpResourceTemplate,
  observeCodexMcpEvent,
  type CodexMcpStartupObservation,
} from "./CodexMcpRuntimeView.ts";

export interface CodexMcpRuntimeBinding {
  readonly owner: symbol;
  readonly target: ProviderMcpRuntimeTarget;
  readonly nativeThreadId: string;
  readonly cwd: string;
  readonly model: string;
  readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
  readonly client: CodexAppServerClient["Service"];
  readonly isRunning: Effect.Effect<boolean>;
  readonly configuredServers: ReadonlyArray<McpServerDefinition>;
  readonly builtInExpected: boolean;
  readonly createdAt: DateTime.Utc;
}
interface Context extends CodexMcpRuntimeBinding {
  readonly startup: Map<string, CodexMcpStartupObservation>;
}
const driver = ProviderDriverKind.make("codex");
const key = (target: ProviderMcpRuntimeTarget) =>
  `${target.runtimeSessionId}\u0000${target.threadId}`;

export function makeCodexMcpRuntimeV2(
  instanceId: ProviderInstanceId,
  registry:
    | (Pick<McpRuntimeRegistry["Service"], "registerSession" | "endSession"> &
        Partial<Pick<McpRuntimeRegistry["Service"], "refresh">>)
    | undefined,
) {
  const contexts = new Map<string, Context>();
  const error = (detail: string, cause?: unknown) =>
    new ProviderAdapterProtocolError({ driver, detail, cause });
  const requireContext = Effect.fn("CodexMcpRuntimeV2.requireContext")(function* (
    target: ProviderMcpRuntimeTarget,
  ) {
    const context = contexts.get(key(target));
    if (target.providerInstanceId !== instanceId || !context)
      return yield* error("The Codex MCP runtime session has been replaced.");
    return context;
  });
  const assertCurrent = (context: Context) =>
    Effect.suspend(() =>
      contexts.get(key(context.target)) === context
        ? Effect.void
        : error("The Codex MCP runtime session has been replaced."),
    );
  const statuses = Effect.fn("CodexMcpRuntimeV2.readStatuses")(function* (
    context: Context,
    detail: "toolsAndAuthOnly" | "full",
    serverName?: string,
  ) {
    const result: Array<CodexSchema.V2ListMcpServerStatusResponse["data"][number]> = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = yield* context.client
        .request("mcpServerStatus/list", {
          threadId: context.nativeThreadId,
          detail,
          ...(serverName === undefined ? {} : { serverName }),
          ...(cursor === undefined ? {} : { cursor }),
        })
        .pipe(Effect.mapError((cause) => error("Could not read Codex MCP status.", cause)));
      yield* assertCurrent(context);
      result.push(...page.data);
      cursor = page.nextCursor ?? undefined;
      if (cursor !== undefined) {
        if (seen.has(cursor)) return yield* error("Codex MCP status repeated a pagination cursor.");
        seen.add(cursor);
      }
    } while (cursor !== undefined);
    return result;
  });
  const metadata = (context: Context, observedAt: string) => ({
    providerInstanceId: instanceId,
    threadId: context.target.threadId,
    runtimeSessionId: context.target.runtimeSessionId,
    observedAt,
    managedMcpServers: codexManagedMcpServers(context.configuredServers),
    builtInMcpExpected: context.builtInExpected,
  });
  const adapter: ProviderMcpRuntimeAdapter<ProviderAdapterProtocolError> = {
    getSnapshot: Effect.fn("CodexMcpRuntimeV2.getSnapshot")(function* (target) {
      const context = yield* requireContext(target);
      return normalizeCodexMcpSnapshot({
        ...metadata(context, DateTime.formatIso(yield* DateTime.now)),
        statuses: yield* statuses(context, "toolsAndAuthOnly"),
        startupStatuses: context.startup,
      });
    }),
    getServerDetails: Effect.fn("CodexMcpRuntimeV2.getServerDetails")(function* (target) {
      const context = yield* requireContext(target);
      const status = (yield* statuses(context, "full", target.providerKey)).find(
        (entry) => entry.name === target.providerKey,
      );
      if (!status) return yield* error("Codex did not report this MCP server.");
      return {
        server: normalizeCodexMcpServer({
          ...metadata(context, DateTime.formatIso(yield* DateTime.now)),
          status,
        }),
        tools: Object.values(status.tools).flatMap((tool) => {
          const normalized = normalizeCodexMcpTool(tool);
          return normalized ? [normalized] : [];
        }),
        resources: status.resources.flatMap((resource) => {
          const normalized = normalizeCodexMcpResource(resource);
          return normalized ? [normalized] : [];
        }),
        templates: status.resourceTemplates.flatMap((template) => {
          const normalized = normalizeCodexMcpResourceTemplate(template);
          return normalized ? [normalized] : [];
        }),
      };
    }),
    runAction: Effect.fn("CodexMcpRuntimeV2.runAction")(function* (target) {
      const context = yield* requireContext(target);
      const running = yield* context.isRunning;
      yield* assertCurrent(context);
      if (running)
        return {
          accepted: false,
          action: target.action,
          providerKey: target.providerKey,
          message: "Wait for current work to finish before changing an MCP connection.",
        };
      if (target.action === "authorize") {
        const response = yield* context.client
          .request("mcpServer/oauth/login", {
            threadId: context.nativeThreadId,
            name: target.providerKey,
          })
          .pipe(
            Effect.mapError((cause) => error("Could not start Codex MCP authorization.", cause)),
          );
        yield* assertCurrent(context);
        return {
          accepted: true,
          action: target.action,
          providerKey: target.providerKey,
          authorizationUrl: response.authorizationUrl,
        };
      }
      yield* context.client
        .request("config/mcpServer/reload", undefined)
        .pipe(Effect.mapError((cause) => error("Could not reload Codex MCP servers.", cause)));
      yield* assertCurrent(context);
      return { accepted: true, action: target.action, providerKey: target.providerKey };
    }),
    applyConfiguration: Effect.fn("CodexMcpRuntimeV2.applyConfiguration")(function* (target) {
      const context = yield* requireContext(target);
      const running = yield* context.isRunning;
      yield* assertCurrent(context);
      if (running) return "pending-next-session" as const;
      yield* context.client
        .request("config/mcpServer/reload", undefined)
        .pipe(Effect.mapError((cause) => error("Could not reload Codex MCP servers.", cause)));
      yield* assertCurrent(context);
      // Thread-scoped overrides are re-resolved on resume; reload alone cannot replace them.
      return "pending-next-session" as const;
    }),
  };
  return {
    adapter,
    bind: Effect.fn("CodexMcpRuntimeV2.bind")(function* (binding: CodexMcpRuntimeBinding) {
      const prior = contexts.get(key(binding.target));
      contexts.set(key(binding.target), {
        ...binding,
        startup:
          prior?.nativeThreadId === binding.nativeThreadId && prior.client === binding.client
            ? prior.startup
            : new Map(),
      });
      if (registry)
        yield* registry.registerSession({
          provider: driver,
          providerInstanceId: instanceId,
          threadId: binding.target.threadId,
          runtimeSessionId: binding.target.runtimeSessionId,
          cwd: binding.cwd,
          model: binding.model,
          runtimeMode: binding.runtimePolicy.runtimeMode,
          status: "ready",
          createdAt: DateTime.formatIso(binding.createdAt),
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        });
    }),
    release: Effect.fn("CodexMcpRuntimeV2.release")(function* (owner: symbol) {
      for (const [entryKey, context] of contexts)
        if (context.owner === owner) {
          contexts.delete(entryKey);
          if (registry) yield* registry.endSession(context.target);
        }
    }),
    observe: Effect.fn("CodexMcpRuntimeV2.observe")(function* (
      client: CodexAppServerClient["Service"],
      method: "mcpServer/startupStatus/updated" | "mcpServer/oauthLogin/completed",
      payload:
        | CodexSchema.V2McpServerStatusUpdatedNotification
        | CodexSchema.V2McpServerOauthLoginCompletedNotification,
    ) {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      for (const context of contexts.values())
        if (
          context.client === client &&
          (payload.threadId == null || payload.threadId === context.nativeThreadId)
        ) {
          observeCodexMcpEvent({ method, payload, createdAt }, context.startup);
          const live = registry?.refresh
            ? registry
            : Option.getOrUndefined(yield* Effect.serviceOption(McpRuntimeRegistry));
          if (live?.refresh)
            yield* live.refresh(context.target).pipe(Effect.ignoreCause({ log: true }));
        }
    }),
  };
}
