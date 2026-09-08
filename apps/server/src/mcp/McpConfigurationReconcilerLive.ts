import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  makeMcpConfigurationReconcilerCore,
  McpConfigurationReconciler,
} from "./McpConfigurationReconciler.ts";
import { McpRuntimeRegistry } from "./McpRuntimeRegistry.ts";

export interface McpConfigurationRuntime {
  readonly reconcileConfiguration: McpRuntimeRegistry["Service"]["reconcileConfiguration"];
  readonly providerCapability: McpRuntimeRegistry["Service"]["providerCapability"];
}

const makeMcpConfigurationReconciler = (runtime: McpConfigurationRuntime) =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const changes = yield* serverSettings.subscribeChanges;
    const initialSettings = yield* serverSettings.getSettings;
    const reconciler = yield* makeMcpConfigurationReconcilerCore({
      initialSettings,
      readSettings: serverSettings.getSettings,
      reconcileConfiguration: runtime.reconcileConfiguration,
      providerCapability: runtime.providerCapability,
    });

    yield* Stream.runForEach(changes, () =>
      reconciler.reconcileCurrent.pipe(
        Effect.tapError((error) =>
          Effect.logWarning("failed to reconcile changed MCP configuration", {
            operation: error.operation,
            cause: error.cause,
          }),
        ),
        Effect.ignore,
      ),
    ).pipe(Effect.forkScoped);

    return reconciler;
  });

export const makeMcpConfigurationReconcilerLayer = (runtime: McpConfigurationRuntime) =>
  Layer.effect(McpConfigurationReconciler, makeMcpConfigurationReconciler(runtime));

export const McpConfigurationReconcilerLive = Layer.effect(
  McpConfigurationReconciler,
  Effect.gen(function* () {
    const runtimeRegistry = yield* McpRuntimeRegistry;
    return yield* makeMcpConfigurationReconciler(runtimeRegistry);
  }),
);
