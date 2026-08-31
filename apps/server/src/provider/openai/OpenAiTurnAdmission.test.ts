import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import type { InProcessWorkAdmissionRequest } from "../../resourceProtection/InProcessWorkAdmission.ts";
import { makeOpenAiTurnAdmission } from "./OpenAiTurnAdmission.ts";

const input = {
  threadId: ThreadId.make("openai-admission"),
  turnId: TurnId.make("11111111-1111-4111-8111-111111111111"),
  providerInstanceId: ProviderInstanceId.make("openai"),
  serializedHistoryBytes: 100,
  attachmentBytes: 200,
  toolBufferBytes: 300,
};

describe("OpenAiTurnAdmission", () => {
  it.effect("acquires and releases an in-process OpenAI lease", () =>
    Effect.gen(function* () {
      const requests: Array<InProcessWorkAdmissionRequest> = [];
      let releases = 0;
      const admission = makeOpenAiTurnAdmission({
        acquireInProcessLease: (request) =>
          Effect.sync(() => {
            requests.push(request);
            return {
              workId: request.workId,
              reservedBytes: 600,
              release: Effect.sync(() => void (releases += 1)),
            };
          }),
      });

      expect(yield* admission.withLease(input, Effect.succeed("done"))).toBe("done");
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        workId: "openai:openai-admission:11111111-1111-4111-8111-111111111111",
        provider: "openai",
        providerInstanceId: "openai",
        reservation: {
          serializedHistoryBytes: 100,
          attachmentBytes: 200,
          toolBufferBytes: 300,
        },
      });
      expect(releases).toBe(1);
    }),
  );

  it.effect("fails the active turn on critical pressure and still releases the lease", () =>
    Effect.gen(function* () {
      const blocked = yield* Deferred.make<void>();
      let pressure: InProcessWorkAdmissionRequest["onCriticalPressure"] | undefined;
      let releases = 0;
      const admission = makeOpenAiTurnAdmission({
        acquireInProcessLease: (request) =>
          Effect.sync(() => {
            pressure = request.onCriticalPressure;
            return {
              workId: request.workId,
              reservedBytes: 600,
              release: Effect.sync(() => void (releases += 1)),
            };
          }),
      });
      const fiber = yield* admission
        .withLease(input, Deferred.await(blocked))
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* pressure!({
        reason: "critical-memory-pressure",
        workId: "openai:openai-admission:11111111-1111-4111-8111-111111111111",
        reservedBytes: 600,
        sampledAtMs: 1,
        availableMemoryBytes: 2,
        coreReserveBytes: 3,
      });

      const exit = yield* Fiber.await(fiber);
      expect(exit._tag).toBe("Failure");
      expect(String(exit)).toContain("resource/protection");
      expect(releases).toBe(1);
    }),
  );
});
