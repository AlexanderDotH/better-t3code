import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ServerConfigStreamEvent, UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";
import * as UsagePaceHistory from "../provider/UsagePaceHistory.ts";

const encodeConfigEvent = Schema.encodeSync(ServerConfigStreamEvent);

it.effect("keeps malformed source URLs encodable for config subscribers", () =>
  Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    const snapshots = yield* sources.current;
    expect(snapshots.map((source) => source.label)).toEqual([
      "local-hub",
      "opaque-hub",
      "Named hub",
      "hub.test:8317",
      "Usage limit source",
    ]);
    expect(() =>
      encodeConfigEvent({
        version: 1,
        type: "usageLimitSourcesUpdated",
        payload: { sources: snapshots },
      }),
    ).not.toThrow();
    expect(snapshots.every((source) => source.error === "No management key configured.")).toBe(
      true,
    );
  }).pipe(
    Effect.provide([
      Layer.mock(UsagePaceHistory.UsagePaceHistory)({
        record: ({ limits }) => Effect.succeed(limits),
      }),
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("local-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("opaque-hub")]: {
            kind: "cliproxy",
            url: "file:///tmp/hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("named-hub")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            label: "Named hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("valid-hub")]: {
            kind: "cliproxy",
            url: "https://hub.test:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make(" ")]: {
            kind: "cliproxy",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("Unexpected network request")),
      ),
      NodeCrypto.layer,
    ]),
    Effect.scoped,
  ),
);

it.effect("retains a hub account's daily baseline through subsequent quota probes", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const history = yield* UsagePaceHistory.makeUsagePaceHistory(directory);
    yield* TestClock.setTime(Date.parse("2026-09-15T23:00:00.000Z"));
    let usedPercent = 5;
    const client = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            request.url.endsWith("auth-files")
              ? {
                  files: [
                    { id: "one", auth_index: "0", provider: "claude", email: "one@example.com" },
                  ],
                }
              : {
                  status_code: 200,
                  body: JSON.stringify({
                    seven_day: { utilization: usedPercent, resets_at: "2026-09-20T00:00:00Z" },
                  }),
                },
          ),
        ),
      ),
    );
    const sources = yield* UsageLimitSources.make.pipe(
      Effect.provideService(UsagePaceHistory.UsagePaceHistory, history),
      Effect.provideService(HttpClient.HttpClient, client),
    );
    yield* sources.refresh;
    yield* TestClock.setTime(Date.parse("2026-09-16T12:00:00.000Z"));
    usedPercent = 6;
    yield* sources.refresh;
    const accounts = (yield* sources.current)[0]?.accounts;
    expect(accounts?.[0]?.usageLimits.windows[0]).toMatchObject({
      usageHistorySource: "observed",
      usageHistory: [
        { at: "2026-09-15T23:00:00.000Z", usedPercent: 5 },
        { at: "2026-09-16T12:00:00.000Z", usedPercent: 6 },
      ],
    });
  }).pipe(
    Effect.provide([
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("hub")]: {
            kind: "cliproxy",
            url: "https://hub.test",
            managementKey: "test-key",
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      NodeServices.layer,
    ]),
    Effect.scoped,
  ),
);
