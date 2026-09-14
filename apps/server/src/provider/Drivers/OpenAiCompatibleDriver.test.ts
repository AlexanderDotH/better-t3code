import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  LM_STUDIO_BASE_URL,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { NoOpMcpConfigEngineLayer } from "../../mcp/testUtils.ts";
import { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";

import { LmStudioDriver, OpenAiCompatibleDriver } from "./OpenAiCompatibleDriver.ts";

const decodeCompatibleSettings = Schema.decodeSync(OpenAiCompatibleDriver.configSchema);
const decodeStudioSettings = Schema.decodeSync(LmStudioDriver.configSchema);

const testLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-compatible-driver-test-" }),
  ServerSettingsService.layerTest(),
  NoOpMcpConfigEngineLayer,
  Layer.mock(ServerSecretStore.ServerSecretStore)({ get: () => Effect.succeed(Option.none()) }),
  Layer.mock(BackgroundPolicy.BackgroundPolicy)({ shouldRunScopeWork: () => Effect.succeed(true) }),
  Layer.mock(SubagentResourceGovernor)({}),
  Layer.mock(WorkspaceContext.WorkspaceContext)({}),
  Layer.mock(WorkspaceFileSystem.WorkspaceFileSystem)({}),
).pipe(Layer.provideMerge(NodeServices.layer));

describe("OpenAI-compatible endpoint drivers", () => {
  it("keeps both provider identities independent with disabled multi-instance defaults", () => {
    for (const [driver, kind, displayName, baseUrl] of [
      [OpenAiCompatibleDriver, "openaiCompatible", "OpenAI Compatible", ""],
      [LmStudioDriver, "lmstudio", "LM Studio", LM_STUDIO_BASE_URL],
    ] as const) {
      expect(driver.driverKind).toBe(kind);
      expect(driver.metadata).toEqual({ displayName, supportsMultipleInstances: true });
      const defaults = { enabled: false, baseUrl, defaultModel: "", customModels: [] };
      const decodeSettings =
        driver === LmStudioDriver ? decodeStudioSettings : decodeCompatibleSettings;
      expect(driver.defaultConfig()).toEqual(defaults);
      expect(decodeSettings({})).toEqual(defaults);
      expect(
        decodeSettings({
          enabled: true,
          baseUrl: "http://localhost:5432/proxy/v1",
          defaultModel: "Example/Model:Q4_K_M",
        }),
      ).toMatchObject({
        enabled: true,
        baseUrl: "http://localhost:5432/proxy/v1",
        defaultModel: "Example/Model:Q4_K_M",
      });
    }
  });

  it.effect("periodically checks only enabled, saved endpoints", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const requests: Array<string> = [];
        const client = HttpClient.make((request) => {
          requests.push(request.url);
          return Effect.succeed(
            HttpClientResponse.fromWeb(request, Response.json({ data: [{ id: "local-coder" }] })),
          );
        });
        for (const driver of [OpenAiCompatibleDriver, LmStudioDriver]) {
          const baseUrl = `http://${driver.driverKind.toLowerCase()}.test/v1`;
          const instance = yield* driver
            .create({
              instanceId: ProviderInstanceId.make(`${driver.driverKind}-saved`),
              displayName: "Saved endpoint",
              enabled: true,
              environment: [],
              config: { ...driver.defaultConfig(), baseUrl, defaultModel: "local-coder" },
            })
            .pipe(Effect.provideService(HttpClient.HttpClient, client));
          expect(yield* instance.snapshot.refresh).toMatchObject({
            instanceId: instance.instanceId,
            driver: driver.driverKind,
            status: "ready",
          });
          const previousChecks = requests.filter((url) => url === `${baseUrl}/models`).length;
          yield* TestClock.adjust(DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL);
          expect(requests.filter((url) => url === `${baseUrl}/models`).length).toBeGreaterThan(
            previousChecks,
          );
          yield* driver
            .create({
              instanceId: ProviderInstanceId.make(`${driver.driverKind}-disabled`),
              displayName: undefined,
              enabled: false,
              environment: [],
              config: { ...driver.defaultConfig(), baseUrl: "http://disabled.test/v1" },
            })
            .pipe(Effect.provideService(HttpClient.HttpClient, client));
        }
        yield* TestClock.adjust(DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL);
        expect(new Set(requests)).toEqual(
          new Set(["http://openaicompatible.test/v1/models", "http://lmstudio.test/v1/models"]),
        );
      }),
    ).pipe(Effect.provide(testLayer)),
  );
});
