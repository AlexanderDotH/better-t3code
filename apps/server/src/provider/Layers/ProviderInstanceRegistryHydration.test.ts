import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfigMap,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { ServerSettingsService } from "../../serverSettings.ts";
import { ProviderInstanceRegistryMutator } from "../Services/ProviderInstanceRegistryMutator.ts";
import {
  ProviderInstanceSettingsSync,
  ProviderInstanceSettingsSyncLive,
} from "./ProviderInstanceRegistryHydration.ts";

it.effect(
  "waits for endpoint hydration and serializes queued updates against the latest settings",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let applied: ProviderInstanceConfigMap = {};
      let first = true;
      let active = 0;
      let peak = 0;
      const mutator = Layer.succeed(ProviderInstanceRegistryMutator, {
        reconcile: (configMap) =>
          Effect.gen(function* () {
            active++;
            peak = Math.max(peak, active);
            if (first) {
              first = false;
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
            }
            applied = configMap;
            active--;
          }),
      });
      yield* Effect.gen(function* () {
        const sync = yield* ProviderInstanceSettingsSync;
        const settings = yield* ServerSettingsService;
        const initial = yield* sync.synchronize.pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        const instanceId = ProviderInstanceId.make("endpoint");
        for (const baseUrl of ["http://first.test/v1", "http://second.test/v1"]) {
          yield* settings.updateSettings({
            providerInstances: {
              [instanceId]: {
                driver: ProviderDriverKind.make("openaiCompatible"),
                enabled: true,
                config: { baseUrl },
              },
            },
          });
        }
        const saved = yield* sync.synchronize.pipe(Effect.forkScoped);
        expect(applied[instanceId]).toBeUndefined();
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(initial);
        yield* Fiber.join(saved);
        expect(applied[instanceId]?.config).toEqual({ baseUrl: "http://second.test/v1" });
        expect(peak).toBe(1);
      }).pipe(
        Effect.provide(
          ProviderInstanceSettingsSyncLive.pipe(
            Layer.provide(mutator),
            Layer.provideMerge(ServerSettingsService.layerTest()),
          ),
        ),
      );
    }).pipe(Effect.scoped),
);
