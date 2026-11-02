import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  McpServerId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type McpServerDefinition,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectStoreV2 } from "../orchestration-v2/ProjectStore.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { McpConfigEngine } from "./McpConfigEngine.ts";
import { makeProviderMcpConfigurationResolver } from "./ProviderMcpConfigurationResolver.ts";

const instanceId = ProviderInstanceId.make("codex-work");
const projectId = ProjectId.make("real-project");
const threadId = ThreadId.make("real-thread");
const server: McpServerDefinition = {
  id: McpServerId.make("project-docs"),
  name: "Docs",
  enabled: true,
  providerRouting: { mode: "all" },
  scope: "project",
  projectId,
  transport: "http",
  url: "https://docs.example.com/mcp",
  headers: {},
};
const settings = (servers: ReadonlyArray<McpServerDefinition>) =>
  Layer.mock(ServerSettingsService)({
    getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, mcp: { servers } }),
  });

it.effect(
  "binds project-only MCP configuration to the persisted thread's canonical project and worktree",
  () =>
    Effect.gen(function* () {
      const resolved: unknown[] = [];
      const resolver = yield* makeProviderMcpConfigurationResolver.pipe(
        Effect.provide(
          Layer.mergeAll(
            settings([server]),
            Layer.mock(McpConfigEngine)({
              resolveActiveServers: (input) => {
                resolved.push(input);
                return Effect.succeed([server]);
              },
            }),
            Layer.mock(ProjectionStoreV2)({
              getThread: (id) => {
                expect(id).toBe(threadId);
                return Effect.succeed({ projectId, worktreePath: "/trusted/worktree" } as never);
              },
            }),
            Layer.mock(ProjectStoreV2)({
              get: (id) => {
                expect(id).toBe(projectId);
                return Effect.succeedSome({ workspaceRoot: "/trusted/project" } as never);
              },
            }),
          ),
        ),
      );
      expect(
        yield* resolver({
          threadId,
          providerInstanceId: instanceId,
          cwd: "/untrusted",
          projectId: ProjectId.make("foreign"),
          projectCwd: "/foreign",
        }),
      ).toEqual([server]);
      expect(resolved).toEqual([
        {
          providerInstanceId: instanceId,
          projectId,
          projectCwd: "/trusted/project",
          cwd: "/trusted/worktree",
        },
      ]);
    }),
);

it.effect(
  "permits hosts without central MCP configuration and refuses to drop enabled definitions",
  () =>
    Effect.gen(function* () {
      const empty = yield* makeProviderMcpConfigurationResolver.pipe(Effect.provide(settings([])));
      expect(yield* empty({ providerInstanceId: instanceId, cwd: "/workspace" })).toEqual([]);
      const configured = yield* makeProviderMcpConfigurationResolver.pipe(
        Effect.provide(settings([server])),
      );
      const error = yield* configured({ providerInstanceId: instanceId, cwd: "/workspace" }).pipe(
        Effect.flip,
      );
      expect(error._tag).toBe("ProviderMcpConfigurationError");
    }),
);
