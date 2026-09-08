import type {
  McpRuntimeError,
  McpRuntimeSnapshot,
  McpRuntimeSnapshotInput,
  McpRuntimeServer,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { ProviderAdapterError } from "../provider/Errors.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import type { RuntimeEntry } from "./McpRuntimeContextState.ts";

interface RuntimeRefreshFlight {
  readonly result: Deferred.Deferred<McpRuntimeSnapshot, McpRuntimeError>;
  readonly allowTrailing: boolean;
}

interface RuntimeRefreshFlightSelection {
  readonly flight: RuntimeRefreshFlight;
  readonly owner: boolean;
}

export interface McpRuntimeRefreshCoordinatorDependencies {
  readonly contextKey: (input: McpRuntimeSnapshotInput) => string;
  readonly requireEntry: (
    input: McpRuntimeSnapshotInput,
    requireActive: boolean,
  ) => Effect.Effect<RuntimeEntry, McpRuntimeError>;
  readonly adapterFor: (
    providerInstanceId: McpRuntimeSnapshotInput["providerInstanceId"],
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, McpRuntimeError>;
  readonly replaceServers: (
    input: McpRuntimeSnapshotInput,
    incoming: ReadonlyArray<McpRuntimeServer>,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
  readonly markStale: (
    input: McpRuntimeSnapshotInput,
    error: unknown,
  ) => Effect.Effect<McpRuntimeSnapshot, McpRuntimeError>;
}

export const makeMcpRuntimeRefreshCoordinator = Effect.fn("makeMcpRuntimeRefreshCoordinator")(
  function* (dependencies: McpRuntimeRefreshCoordinatorDependencies) {
    const refreshFlights = yield* Ref.make<ReadonlyMap<string, RuntimeRefreshFlight>>(new Map());
    const trailingRefreshes = yield* Ref.make<ReadonlySet<string>>(new Set());

    const refreshOnce = (input: McpRuntimeSnapshotInput) =>
      Effect.gen(function* () {
        const current = yield* dependencies.requireEntry(input, false);
        if (current.context.state === "inactive") {
          return {
            context: current.context,
            revision: current.revision,
            observedAt: current.observedAt,
            servers: Array.from(current.servers.values()).sort((left, right) =>
              left.name.localeCompare(right.name),
            ),
          } satisfies McpRuntimeSnapshot;
        }
        const adapter = yield* dependencies.adapterFor(input.providerInstanceId);
        const mcpRuntime = adapter.mcpRuntime;
        if (mcpRuntime === undefined) return yield* dependencies.replaceServers(input, []);
        const result = yield* Effect.exit(mcpRuntime.getSnapshot(input));
        if (result._tag === "Failure") {
          return yield* dependencies.markStale(input, Cause.squash(result.cause));
        }
        return yield* dependencies.replaceServers(input, result.value);
      });

    const removeRefreshFlight = (key: string, flight: RuntimeRefreshFlight) =>
      Ref.update(refreshFlights, (current) => {
        if (current.get(key) !== flight) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });

    const runRefreshFlight = Effect.fn("McpRuntimeRefreshCoordinator.runRefreshFlight")(function* (
      input: McpRuntimeSnapshotInput,
      allowTrailing: boolean,
    ) {
      const key = dependencies.contextKey(input);
      const flight: RuntimeRefreshFlight = {
        result: yield* Deferred.make<McpRuntimeSnapshot, McpRuntimeError>(),
        allowTrailing,
      };
      const selected = yield* Ref.modify(
        refreshFlights,
        (
          current,
        ): readonly [RuntimeRefreshFlightSelection, ReadonlyMap<string, RuntimeRefreshFlight>] => {
          const existing = current.get(key);
          if (existing !== undefined) return [{ flight: existing, owner: false }, current] as const;
          const next = new Map(current);
          next.set(key, flight);
          return [{ flight, owner: true }, next] as const;
        },
      );
      if (!selected.owner) return yield* Deferred.await(selected.flight.result);
      const result = yield* Effect.exit(refreshOnce(input));
      yield* removeRefreshFlight(key, flight);
      if (result._tag === "Failure") {
        yield* Deferred.failCause(flight.result, result.cause);
        return yield* Effect.failCause(result.cause);
      }
      yield* Deferred.succeed(flight.result, result.value);
      return result.value;
    });

    const refresh = (input: McpRuntimeSnapshotInput) => runRefreshFlight(input, true);

    const refreshAfterProviderEvent = Effect.fn(
      "McpRuntimeRefreshCoordinator.refreshAfterProviderEvent",
    )(function* (input: McpRuntimeSnapshotInput) {
      const key = dependencies.contextKey(input);
      const active = (yield* Ref.get(refreshFlights)).get(key);
      if (active === undefined) {
        yield* runRefreshFlight(input, true).pipe(Effect.ignore);
        return;
      }
      if (!active.allowTrailing) {
        yield* Deferred.await(active.result).pipe(Effect.ignore);
        return;
      }
      yield* Ref.update(trailingRefreshes, (current) => new Set(current).add(key));
      yield* Effect.exit(Deferred.await(active.result));
      const claimed = yield* Ref.modify(trailingRefreshes, (current) => {
        if (!current.has(key)) return [false, current] as const;
        const next = new Set(current);
        next.delete(key);
        return [true, next] as const;
      });
      if (claimed) yield* runRefreshFlight(input, false).pipe(Effect.ignore);
    });

    return { refresh, refreshAfterProviderEvent };
  },
);
