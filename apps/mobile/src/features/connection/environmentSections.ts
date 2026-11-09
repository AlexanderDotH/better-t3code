import type { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export type EnvironmentRecoveryAction =
  | { readonly kind: "retry"; readonly label: string }
  | { readonly kind: "edit"; readonly label: string }
  | { readonly kind: "pair"; readonly label: string }
  | { readonly kind: "sign-in"; readonly label: string };

interface EnvironmentRecoveryInput {
  readonly phase: EnvironmentConnectionPhase;
  readonly isRelayManaged: boolean;
  readonly retry:
    | { readonly mode: "automatic"; readonly at: number | null }
    | { readonly mode: "manual" | "none"; readonly at: null };
  readonly failureReason: string | null;
}

export function environmentRecoveryAction(
  input: EnvironmentRecoveryInput,
): EnvironmentRecoveryAction | null {
  if (input.phase === "connected" || input.phase === "offline") {
    return null;
  }
  if (input.retry.mode === "automatic") {
    return input.retry.at === null
      ? null
      : {
          kind: "retry",
          label: currentInterfaceTranslator().message("mobile.connection.retryNow"),
        };
  }
  if (input.retry.mode === "manual") {
    if (input.failureReason === "authentication") {
      return input.isRelayManaged
        ? { kind: "sign-in", label: currentInterfaceTranslator().message("mobile.ui.signInAgain") }
        : { kind: "pair", label: currentInterfaceTranslator().message("mobile.ui.pairAgain") };
    }
    if (input.failureReason === "configuration" && !input.isRelayManaged) {
      return {
        kind: "edit",
        label: currentInterfaceTranslator().message("mobile.ui.editConnection"),
      };
    }
    return null;
  }
  if (input.phase === "connecting" || input.phase === "reconnecting") {
    return null;
  }
  return {
    kind: "retry",
    label: currentInterfaceTranslator().message("mobile.connection.retryNow"),
  };
}

export function environmentSummaryRecoveryAction(
  environment: ConnectedEnvironmentSummary,
): EnvironmentRecoveryAction | null {
  if (!environment.isEnabled) return null;
  const connection = environment.connection;
  return environmentRecoveryAction({
    phase: environment.connectionState,
    isRelayManaged: environment.isRelayManaged,
    retry:
      connection?.retry ??
      (environment.connectionState === "available" || environment.connectionState === "error"
        ? { mode: "manual", at: null }
        : { mode: "none", at: null }),
    failureReason: connection?.failure?.reason ?? null,
  });
}

export function environmentPairingPrefill(
  environment: Pick<ConnectedEnvironmentSummary, "displayUrl" | "isRelayManaged">,
): string | null {
  if (environment.isRelayManaged) return null;
  const displayUrl = environment.displayUrl.trim();
  return displayUrl.length > 0 ? displayUrl : null;
}

export function environmentLastSyncedText(input: {
  readonly phase: EnvironmentConnectionPhase;
  readonly updatedAt: number | null;
  readonly now?: number;
}): string | null {
  if (
    input.phase === "connected" ||
    input.updatedAt === null ||
    !Number.isFinite(input.updatedAt)
  ) {
    return null;
  }
  const elapsedMs = Math.max(0, (input.now ?? Date.now()) - input.updatedAt);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) {
    return "Last synced just now";
  }
  if (elapsedMinutes < 60) {
    return `Last synced ${elapsedMinutes} min ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `Last synced ${elapsedHours} hr ago`;
  }
  return `Last synced ${Math.floor(elapsedHours / 24)} days ago`;
}

export interface EnvironmentSectionsInput {
  readonly connectedEnvironments: ReadonlyArray<ConnectedEnvironmentSummary>;
  readonly cloudEnvironments: ReadonlyArray<RelayClientEnvironmentRecord> | null;
}

export interface EnvironmentSections {
  readonly localEnvironments: ReadonlyArray<ConnectedEnvironmentSummary>;
  readonly connectedCloudEnvironments: ReadonlyArray<ConnectedEnvironmentSummary>;
  readonly availableCloudEnvironments: ReadonlyArray<RelayClientEnvironmentRecord>;
}

export function relayManagedEnvironmentIds(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly isRelayManaged: boolean;
  }>,
): ReadonlySet<EnvironmentId> {
  return new Set(
    environments
      .filter((environment) => environment.isRelayManaged)
      .map((environment) => environment.environmentId),
  );
}

export function splitEnvironmentSections(input: EnvironmentSectionsInput): EnvironmentSections {
  const savedEnvironmentIds = relayManagedEnvironmentIds(input.connectedEnvironments);

  return {
    localEnvironments: input.connectedEnvironments.filter(
      (environment) => !environment.isRelayManaged,
    ),
    connectedCloudEnvironments: input.connectedEnvironments.filter(
      (environment) => environment.isRelayManaged,
    ),
    availableCloudEnvironments: (input.cloudEnvironments ?? []).filter(
      (environment) => !savedEnvironmentIds.has(environment.environmentId),
    ),
  };
}
