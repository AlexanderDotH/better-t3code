import type {
  ResourceMonitorHostMemory,
  ResourceMonitorProcessSample,
  ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { NativeTelemetryClient } from "../resourceTelemetry/NativeTelemetryClient.ts";
import { constrainHostMemoryToCurrentCgroup } from "./ContainerMemoryBudget.ts";
import { resolveResourceProtectionPolicy } from "./ResourceProtectionPolicy.ts";

interface ResourceProtectionRuntimeGovernor {
  readonly setPolicy: (
    policy: ReturnType<typeof resolveResourceProtectionPolicy>,
  ) => Effect.Effect<void>;
  readonly telemetryUnavailable: Effect.Effect<void>;
  readonly monitoringDemand: Stream.Stream<boolean>;
  readonly observe: (sample: {
    readonly sampledAtMs: number;
    readonly memory: ResourceMonitorHostMemory;
    readonly processes: ReadonlyArray<ResourceMonitorProcessSample>;
  }) => Effect.Effect<void>;
}

export function resourceProtectionSnapshotStream<A, E, R>(
  demand: Stream.Stream<boolean>,
  snapshots: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, R> {
  return demand.pipe(Stream.switchMap((active) => (active ? snapshots : Stream.empty)));
}

export const attachResourceProtectionRuntime = Effect.fnUntraced(function* (input: {
  readonly governor: ResourceProtectionRuntimeGovernor;
  readonly nativeTelemetry: NativeTelemetryClient["Service"];
  readonly settingsChanges: Stream.Stream<ServerSettings>;
}) {
  yield* input.settingsChanges.pipe(
    Stream.runForEach((settings) =>
      input.governor.setPolicy(resolveResourceProtectionPolicy(settings)),
    ),
    Effect.forkScoped,
  );
  yield* Stream.unwrap(
    Effect.map(input.nativeTelemetry.subscribeHealth, ({ latest, changes }) =>
      Stream.concat(Stream.make(latest), changes),
    ),
  ).pipe(
    Stream.filter((health) => health.status !== "healthy"),
    Stream.runForEach(() => input.governor.telemetryUnavailable),
    Effect.forkScoped,
  );
  yield* resourceProtectionSnapshotStream(
    input.governor.monitoringDemand,
    input.nativeTelemetry.resourceProtectionSnapshots,
  ).pipe(
    Stream.runForEach(({ snapshot }) =>
      input.governor.observe({
        sampledAtMs: snapshot.sampledAtUnixMs,
        memory: constrainHostMemoryToCurrentCgroup(snapshot.memory),
        processes: snapshot.processes,
      }),
    ),
    Effect.catchCause((cause) =>
      Effect.logError("resource protection telemetry stream stopped", { cause }),
    ),
    Effect.forkScoped,
  );
});
