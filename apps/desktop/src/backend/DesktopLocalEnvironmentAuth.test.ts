import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

import type { DesktopBackendStartConfig } from "./DesktopBackendManager.ts";
import * as DesktopBackendPool from "./DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./DesktopLocalEnvironmentAuth.ts";

const config: DesktopBackendStartConfig = {
  executablePath: "/electron",
  entryPath: "/server/bin.mjs",
  args: [],
  cwd: "/server",
  env: {},
  extendEnv: false,
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    t3Home: "/tmp/t3",
    host: "127.0.0.1",
    desktopBootstrapToken: "desktop-bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  bootstrapDelivery: "fd3",
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
  preflightFailure: Option.none(),
};

const makeBackend = (
  overrides: Partial<DesktopBackendPool.DesktopBackendInstance> = {},
): DesktopBackendPool.DesktopBackendInstance => ({
  id: DesktopBackendPool.PRIMARY_INSTANCE_ID,
  label: Effect.succeed("Local"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeedSome(config),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.none(),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
  ...overrides,
});

const makeTestLayer = (
  requestCount: Ref.Ref<number>,
  backend: DesktopBackendPool.DesktopBackendInstance,
) =>
  DesktopLocalEnvironmentAuth.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        DesktopBackendPool.layerTest([backend]),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Ref.update(requestCount, (count) => count + 1).pipe(
              Effect.as(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json({
                    access_token: "desktop-bearer-token",
                    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                    token_type: "Bearer",
                    expires_in: 3600,
                    scope: "orchestration:read",
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

describe("DesktopLocalEnvironmentAuth", () => {
  it.effect("exchanges the desktop bootstrap credential only once", () =>
    Effect.gen(function* () {
      const requestCount = yield* Ref.make(0);

      const [first, second] = yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        return yield* Effect.all([auth.getBearerToken, auth.getBearerToken]);
      }).pipe(Effect.provide(makeTestLayer(requestCount, makeBackend())));

      assert.strictEqual(first, "desktop-bearer-token");
      assert.strictEqual(second, "desktop-bearer-token");
      assert.strictEqual(yield* Ref.get(requestCount), 1);
    }),
  );

  it.effect("waits for backend readiness before concurrent requests exchange a credential", () =>
    Effect.gen(function* () {
      const waitingForBackend = yield* Deferred.make<void>();
      const backendReady = yield* Deferred.make<void>();
      const currentConfig = yield* Ref.make(Option.none<DesktopBackendStartConfig>());
      const requestCount = yield* Ref.make(0);
      const backend = makeBackend({
        currentConfig: Ref.get(currentConfig),
        waitForReady: () =>
          Deferred.succeed(waitingForBackend, undefined).pipe(
            Effect.andThen(Deferred.await(backendReady)),
            Effect.andThen(Ref.set(currentConfig, Option.some(config))),
            Effect.as(true),
          ),
      });

      yield* Effect.gen(function* () {
        const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
        const requests = yield* Effect.all([auth.getBearerToken, auth.getBearerToken], {
          concurrency: "unbounded",
        }).pipe(Effect.forkChild);

        yield* Effect.raceFirst(Deferred.await(waitingForBackend), Fiber.join(requests));
        assert.strictEqual(yield* Ref.get(requestCount), 0);

        yield* Deferred.succeed(backendReady, undefined);
        assert.deepEqual(yield* Fiber.join(requests), [
          "desktop-bearer-token",
          "desktop-bearer-token",
        ]);
        assert.strictEqual(yield* Ref.get(requestCount), 1);
      }).pipe(Effect.provide(makeTestLayer(requestCount, backend)));
    }),
  );

  it.effect(
    "allows a later retry after backend readiness fails without exchanging a credential",
    () =>
      Effect.gen(function* () {
        const backendReady = yield* Ref.make(false);
        const requestCount = yield* Ref.make(0);
        const backend = makeBackend({ waitForReady: () => Ref.get(backendReady) });

        yield* Effect.gen(function* () {
          const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
          const error = yield* auth.getBearerToken.pipe(Effect.flip);
          assert.strictEqual(error._tag, "DesktopLocalEnvironmentAuthBackendNotReadyError");
          assert.strictEqual(yield* Ref.get(requestCount), 0);

          yield* Ref.set(backendReady, true);
          assert.strictEqual(yield* auth.getBearerToken, "desktop-bearer-token");
          assert.strictEqual(yield* Ref.get(requestCount), 1);
        }).pipe(Effect.provide(makeTestLayer(requestCount, backend)));
      }),
  );
});
