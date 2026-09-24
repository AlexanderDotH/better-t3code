import {
  resolveProjectIndexSettings,
  type ProjectIndexDefaults,
  type ProjectIndexStatusV1,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";

export interface ProjectIndexingDefaultsSource {
  readonly get: Effect.Effect<ProjectIndexDefaults, Error>;
  readonly subscribe: Effect.Effect<Stream.Stream<ProjectIndexDefaults>, never, Scope.Scope>;
}

export function withProjectIndexDefaults(
  status: ProjectIndexStatusV1,
  defaults: ProjectIndexDefaults | undefined,
): ProjectIndexStatusV1 {
  return {
    ...status,
    ...(defaults === undefined ? {} : { defaults }),
    state: resolveProjectIndexSettings(status.settings, defaults).enabled
      ? status.state
      : "disabled",
  };
}
