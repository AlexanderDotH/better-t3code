// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerTest, ServerSettingsService } from "../../serverSettings.ts";
import {
  ProjectIndexingBridge,
  type ProjectIndexingBridgeShape,
} from "../runtime/ProjectIndexingBridge.ts";
import { layer, ProjectContextQuery } from "./ProjectContextQuery.ts";

const projectId = ProjectId.make("index-defaults-test");

function bridgeFor(resolveScope: ProjectIndexingBridgeShape["resolveScope"]) {
  return ProjectIndexingBridge.of({
    resolveScope,
    listScopes: () => Effect.succeed([]),
    capabilities: () => Effect.die("Context reads must not check a model"),
    generate: () => Effect.die("Context reads must not invoke a model"),
    admit: () => Effect.die("Context reads must not start background work"),
    readDiff: () => Effect.die("Context reads must not read a diff"),
    reconcileWatchers: () => Effect.void,
  });
}

const readOverview = Effect.gen(function* () {
  const query = yield* ProjectContextQuery;
  return yield* query.query({ projectId, operation: "overview" });
});

describe("environment indexing gate for context and Fetch", () => {
  it.effect("stops before resolving or opening any project when the master is off", () =>
    Effect.gen(function* () {
      const bridge = bridgeFor(() => Effect.die("Disabled indexing must not resolve a workspace"));
      const error = yield* Effect.flip(
        readOverview.pipe(
          Effect.provide(layer.pipe(Layer.provide(Layer.succeed(ProjectIndexingBridge, bridge)))),
        ),
      );
      expect(error.code).toBe("disabled");
      expect(error.message).toContain("Better T3");
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect("rechecks the master before returning a context response", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsService;
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-defaults-"))),
        (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
      );
      const bridge = bridgeFor(() =>
        Effect.gen(function* () {
          yield* settings.updateSettings({ projectIndexingEnabled: false });
          return {
            workspaceRoot: root,
            scope: { scopeId: "defaults-gate", projectId, workspaceFingerprint: "defaults-gate" },
          };
        }),
      );
      const error = yield* Effect.flip(
        readOverview.pipe(
          Effect.provide(layer.pipe(Layer.provide(Layer.succeed(ProjectIndexingBridge, bridge)))),
        ),
      );
      expect(error.code).toBe("disabled");
      expect(yield* Effect.promise(() => NodeFSP.readdir(root))).toEqual([]);
    }).pipe(Effect.provide(layerTest({ projectIndexingEnabled: true }))),
  );
});
