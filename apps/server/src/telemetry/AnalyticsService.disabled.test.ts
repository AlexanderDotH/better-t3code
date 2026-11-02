import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { AnalyticsService, layerDisabled } from "./AnalyticsService.ts";

it.effect("disabled analytics works without network, identity, or background services", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService;
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    yield* analytics.record("client.turn.requested", cyclic);
    yield* analytics.recordOwners([{ source: "device", ownerId: "test" }], "client");
    yield* analytics.flush;
  }).pipe(Effect.provide(layerDisabled)),
);
