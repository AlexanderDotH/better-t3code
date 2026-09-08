import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ProjectMemoryPolicy, layer } from "./ProjectMemoryPolicy.ts";

it.effect("classifies only the authenticated root session as a memory writer", () =>
  Effect.gen(function* () {
    const policy = yield* ProjectMemoryPolicy;
    const rootThreadId = ThreadId.make("root-thread");
    const base = {
      threadId: rootThreadId,
      providerSessionId: "provider-session",
      providerInstanceId: ProviderInstanceId.make("codex"),
    };

    expect(yield* policy.resolve({ ...base, ownerThreadId: rootThreadId })).toEqual({
      actor: "root",
    });
    expect(
      yield* policy.resolve({ ...base, ownerThreadId: ThreadId.make("child-thread") }),
    ).toEqual({ actor: "child" });
  }).pipe(Effect.provide(layer)),
);
