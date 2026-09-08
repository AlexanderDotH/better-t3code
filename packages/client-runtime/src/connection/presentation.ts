import type { ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import type {
  ConnectionAttemptError,
  ConnectionAttemptStage,
  ConnectionBlockedReason,
  ConnectionTransientReason,
  NetworkStatus,
  SupervisorConnectionState,
} from "./model.ts";

export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";

export type EnvironmentConnectionFailure =
  | {
      readonly kind: "transient";
      readonly reason: ConnectionTransientReason;
      readonly detail: string;
      readonly traceId: string | null;
    }
  | {
      readonly kind: "blocked";
      readonly reason: ConnectionBlockedReason;
      readonly detail: string;
      readonly traceId: string | null;
    };

export type EnvironmentConnectionRetry =
  | {
      readonly mode: "none" | "manual";
      readonly at: null;
    }
  | {
      readonly mode: "automatic";
      readonly at: number | null;
    };

export interface EnvironmentConnectionPresentation {
  readonly phase: EnvironmentConnectionPhase;
  readonly network: NetworkStatus;
  readonly stage: ConnectionAttemptStage | null;
  readonly attempt: number;
  readonly failure: EnvironmentConnectionFailure | null;
  readonly retry: EnvironmentConnectionRetry;
  readonly error: string | null;
  readonly traceId: string | null;
}

export interface EnvironmentPresentation {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverConfig: ServerConfig | null;
}

function presentConnectionFailure(
  failure: ConnectionAttemptError | null,
): EnvironmentConnectionFailure | null {
  if (failure === null) return null;
  switch (failure._tag) {
    case "ConnectionTransientError":
      return {
        kind: "transient",
        reason: failure.reason,
        detail: failure.detail,
        traceId: failure.traceId ?? null,
      };
    case "ConnectionBlockedError":
      return {
        kind: "blocked",
        reason: failure.reason,
        detail: failure.detail,
        traceId: failure.traceId ?? null,
      };
  }
}

function presentConnectionRetry(state: SupervisorConnectionState): EnvironmentConnectionRetry {
  if (state.phase === "backoff") {
    return { mode: "automatic", at: state.retryAt };
  }
  if (state.phase === "connecting" && state.lastFailure?._tag === "ConnectionTransientError") {
    return { mode: "automatic", at: null };
  }
  if (state.phase === "blocked") {
    return { mode: "manual", at: null };
  }
  return { mode: "none", at: null };
}

export function presentConnectionState(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  const failure = presentConnectionFailure(state.lastFailure);
  const shared = {
    network: state.network,
    stage: state.stage,
    attempt: state.attempt,
    failure,
    retry: presentConnectionRetry(state),
    error: failure?.detail ?? null,
    traceId: failure?.traceId ?? null,
  };
  switch (state.phase) {
    case "available":
      return { phase: "available", ...shared, error: null, traceId: null };
    case "offline":
      return { phase: "offline", ...shared, error: null, traceId: null };
    case "connecting":
      return {
        phase: state.attempt <= 1 && state.lastFailure === null ? "connecting" : "reconnecting",
        ...shared,
      };
    case "connected":
      return { phase: "connected", ...shared, error: null, traceId: null };
    case "backoff":
      return {
        phase: "reconnecting",
        ...shared,
      };
    case "blocked":
      return {
        phase: "error",
        ...shared,
      };
  }
}

type EnvironmentConnectionStatus = Pick<EnvironmentConnectionPresentation, "phase" | "error">;

export function connectionStatusText(connection: EnvironmentConnectionStatus): string {
  switch (connection.phase) {
    case "available":
      return "Available";
    case "offline":
      return "Offline";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return connection.error
        ? `Failed to connect. Reconnecting... Reason: ${connection.error}`
        : "Reconnecting...";
    case "connected":
      return "Connected";
    case "error":
      return connection.error
        ? `Connection failed. Reason: ${connection.error}`
        : "Connection failed";
  }
}

export function connectionStatusTitle(connection: EnvironmentConnectionStatus): string {
  if (connection.phase === "reconnecting" && connection.error) {
    return "Failed to connect. Reconnecting...";
  }
  return connectionStatusText({ ...connection, error: null });
}

export function presentEnvironmentConnection(
  state: SupervisorConnectionState,
): EnvironmentConnectionPresentation {
  return presentConnectionState(state);
}

export function connectionCatalogDisplayUrl(entry: ConnectionCatalogEntry): string | null {
  switch (entry.target._tag) {
    case "PrimaryConnectionTarget":
      return entry.target.httpBaseUrl;
    case "RelayConnectionTarget":
      return null;
    case "BearerConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "BearerConnectionProfile"
        ? entry.profile.value.httpBaseUrl
        : null;
    case "SshConnectionTarget":
      return Option.isSome(entry.profile) && entry.profile.value._tag === "SshConnectionProfile"
        ? `${entry.profile.value.target.username}@${entry.profile.value.target.hostname}`
        : null;
  }
}

export function connectionPhaseMessage(
  phase: EnvironmentConnectionPhase,
  label: string,
  networkStatus: NetworkStatus,
): string {
  if (networkStatus === "offline" || phase === "offline") {
    return "You are offline";
  }
  switch (phase) {
    case "available":
      return "Available";
    case "connecting":
      return `Connecting to ${label}...`;
    case "reconnecting":
      return `Reconnecting to ${label}...`;
    case "connected":
      return "Connected";
    case "error":
      return "Connection failed";
  }
}
