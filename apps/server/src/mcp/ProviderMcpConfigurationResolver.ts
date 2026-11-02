import type { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import { ProviderMcpConfigurationError } from "@t3tools/provider-core/server/errors";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { McpConfigEngine } from "./McpConfigEngine.ts";

type Input = Parameters<NonNullable<ProviderHost["Service"]["resolveMcpServers"]>>[0];

export const makeProviderMcpConfigurationResolver = Effect.gen(function* () {
  const settings = yield* ServerSettingsService;
  const engine = yield* Effect.serviceOption(McpConfigEngine);
  const projects = yield* Effect.serviceOption(ProjectStoreV2);
  const threads = yield* Effect.serviceOption(ProjectionStoreV2);
  return Effect.fn("ProviderHost.resolveMcpServers")(function* (input: Input) {
    const unavailable = (cause: unknown) =>
      new ProviderMcpConfigurationError({ providerInstanceId: input.providerInstanceId, cause });
    const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
    const candidates = current.mcp.servers.filter(
      (server) =>
        server.enabled &&
        (server.providerRouting.mode === "all" ||
          server.providerRouting.instanceIds.includes(input.providerInstanceId)),
    );
    if (candidates.length === 0) return [];
    if (Option.isNone(engine))
      return yield* unavailable(new Error("Central MCP configuration is unavailable."));
    let projectId = input.projectId;
    let projectCwd = input.projectCwd;
    let cwd = input.cwd;
    if (input.threadId !== undefined && Option.isSome(projects) && Option.isSome(threads)) {
      const thread = yield* threads.value
        .getThread(input.threadId)
        .pipe(Effect.mapError(unavailable));
      const project = yield* projects.value
        .get(thread.projectId)
        .pipe(Effect.mapError(unavailable));
      if (Option.isNone(project))
        return yield* unavailable(new Error("The thread's project is unavailable."));
      projectId = thread.projectId;
      projectCwd = project.value.workspaceRoot;
      cwd = thread.worktreePath ?? projectCwd;
    } else if (
      candidates.some((server) => server.scope === "project") &&
      projectId === undefined &&
      projectCwd === undefined
    ) {
      return yield* unavailable(
        new Error("Project-scoped MCP configuration requires trusted project context."),
      );
    }
    return yield* engine.value
      .resolveActiveServers({
        providerInstanceId: input.providerInstanceId,
        cwd,
        ...(projectId === undefined ? {} : { projectId }),
        ...(projectCwd === undefined ? {} : { projectCwd }),
      })
      .pipe(Effect.mapError(unavailable));
  });
});
