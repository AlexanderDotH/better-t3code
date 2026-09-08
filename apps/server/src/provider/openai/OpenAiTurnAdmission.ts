import { ProviderDriverKind } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import type { InProcessCriticalPressureNotice } from "../../resourceProtection/InProcessWorkAdmission.ts";
import type { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import type { NativeProviderTurnAdmission } from "../nativeHarness/NativeProviderTypes.ts";

const PROVIDER = ProviderDriverKind.make("openai");

export function makeOpenAiTurnAdmission(
  governor: Pick<SubagentResourceGovernor["Service"], "acquireInProcessLease">,
): NativeProviderTurnAdmission {
  return {
    withLease: (input, effect) =>
      Effect.gen(function* () {
        const pressure = yield* Deferred.make<InProcessCriticalPressureNotice>();
        const workId = `${input.providerInstanceId}:${input.threadId}:${input.turnId}`;
        const lease = yield* governor.acquireInProcessLease({
          workId,
          threadId: input.threadId,
          provider: PROVIDER,
          providerInstanceId: input.providerInstanceId,
          reservation: {
            serializedHistoryBytes: input.serializedHistoryBytes,
            attachmentBytes: input.attachmentBytes,
            toolBufferBytes: input.toolBufferBytes,
          },
          onCriticalPressure: (notice) => Deferred.succeed(pressure, notice).pipe(Effect.asVoid),
        });
        if (!lease) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "resource/admission",
            detail: "OpenAI turn admission was cancelled while the server was shutting down.",
          });
        }
        const pressured = Deferred.await(pressure).pipe(
          Effect.flatMap(
            (notice) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "resource/protection",
                detail: `OpenAI turn '${notice.workId}' was stopped to protect server memory.`,
              }),
          ),
        );
        return yield* Effect.raceFirst(effect, pressured).pipe(Effect.ensuring(lease.release));
      }),
  };
}
