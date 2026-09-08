import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { resourceProtectionSnapshotStream } from "./ResourceProtectionRuntime.ts";

describe("resource protection runtime", () => {
  it.effect("does not retain snapshot work while demand is idle", () =>
    Effect.gen(function* () {
      const subscriptions = yield* Ref.make(0);
      const snapshots = Stream.fromEffect(Ref.updateAndGet(subscriptions, (count) => count + 1));

      const idle = yield* resourceProtectionSnapshotStream(
        Stream.make(false, false),
        snapshots,
      ).pipe(Stream.runCollect);
      const idleSubscriptions = yield* Ref.get(subscriptions);
      const activatedOnce = yield* resourceProtectionSnapshotStream(
        Stream.make(true),
        snapshots,
      ).pipe(Stream.runCollect);
      const activeSubscriptions = yield* Ref.get(subscriptions);

      expect(Array.from(idle)).toEqual([]);
      expect(idleSubscriptions).toBe(0);
      expect(Array.from(activatedOnce)).toEqual([1]);
      expect(activeSubscriptions).toBe(1);
    }),
  );
});
