import type { ProviderDriverKind } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import type { InProcessCriticalPressureNotice } from "../../resourceProtection/InProcessWorkAdmission.ts";
import type { SubagentResourceGovernor } from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ProviderAdapterRequestError } from "../Errors.ts";
import type { NativeProviderTurnAdmission } from "./NativeProviderTypes.ts";

export function makeSharedNativeProviderTurnAdmission(input: {
  readonly provider: ProviderDriverKind;
  readonly governor: Pick<SubagentResourceGovernor["Service"], "acquireInProcessLease">;
}): NativeProviderTurnAdmission {
  return {
    withLease: (turn, effect) =>
      Effect.gen(function* () {
        const pressure = yield* Deferred.make<InProcessCriticalPressureNotice>();
        const workId = `${turn.providerInstanceId}:${turn.threadId}:${turn.turnId}`;
        const lease = yield* input.governor.acquireInProcessLease({
          workId,
          threadId: turn.threadId,
          provider: input.provider,
          providerInstanceId: turn.providerInstanceId,
          reservation: {
            serializedHistoryBytes: turn.serializedHistoryBytes,
            attachmentBytes: turn.attachmentBytes,
            toolBufferBytes: turn.toolBufferBytes,
          },
          onCriticalPressure: (notice) => Deferred.succeed(pressure, notice).pipe(Effect.asVoid),
        });
        if (!lease) {
          return yield* new ProviderAdapterRequestError({
            provider: input.provider,
            method: "resource/admission",
            detail: `${input.provider} turn admission was cancelled while the server was shutting down.`,
          });
        }
        const pressured = Deferred.await(pressure).pipe(
          Effect.flatMap(
            (notice) =>
              new ProviderAdapterRequestError({
                provider: input.provider,
                method: "resource/protection",
                detail: `${input.provider} turn '${notice.workId}' was stopped to protect server memory.`,
              }),
          ),
        );
        return yield* Effect.raceFirst(effect, pressured).pipe(Effect.ensuring(lease.release));
      }),
  };
}
