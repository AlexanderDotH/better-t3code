import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "./runtime";

const onboardingScheduler = createAtomCommandScheduler();

type PairingStageReporter = NonNullable<
  NonNullable<Parameters<ConnectionOnboarding["Service"]["registerPairing"]>[1]>["reportProgress"]
>;
export type PairingOnboardingStage = Parameters<PairingStageReporter>[0];

export interface MobilePairingProgress {
  readonly stage: PairingOnboardingStage;
}

export const pairingOnboardingProgressAtom = Atom.make<MobilePairingProgress | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:pairing-onboarding-progress"),
);

export const connectPairingUrl = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-pairing-url",
  scheduler: onboardingScheduler,
  concurrency: { mode: "singleFlight", key: (pairingUrl: string) => pairingUrl },
  execute: (pairingUrl: string, registry) =>
    Effect.gen(function* () {
      registry.set(pairingOnboardingProgressAtom, null);
      const onboarding = yield* ConnectionOnboarding;
      return yield* onboarding.registerPairing(
        { pairingUrl },
        {
          reportProgress: (stage) =>
            Effect.sync(() => {
              registry.set(pairingOnboardingProgressAtom, { stage });
            }),
        },
      );
    }),
});

export const updateBearerConnection = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:update-bearer",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "serial",
    key: (input: { readonly environmentId: EnvironmentId }) => input.environmentId,
  },
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly httpBaseUrl: string;
  }) => ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.updateBearer(input))),
});
