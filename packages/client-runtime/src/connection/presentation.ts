import type { ServerConfig } from "@t3tools/contracts";
import * as Option from "effect/Option";

import type { ConnectionCatalogEntry } from "./catalog.ts";
import type {
  ConnectionAttemptError,
  ConnectionTarget,
  ConnectionAttemptStage,
  ConnectionBlockedReason,
  ConnectionTransientReason,
  NetworkStatus,
  SupervisorConnectionState,
} from "./model.ts";
import { connectionRouteId, connectionRoutes, routeHttpBaseUrl } from "./routes.ts";

export type EnvironmentConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error"
  | "unsupported";

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

/**
 * Provider statuses are pushed every few minutes with fresh `checkedAt` stamps, and every root
 * coordinator reads environment presentations. Leaving them out keeps a presentation stable
 * across those pushes; provider readers subscribe to the server's providers atom instead.
 */
export type EnvironmentServerConfig = Omit<ServerConfig, "providers">;

export interface EnvironmentPresentation {
  readonly entry: ConnectionCatalogEntry;
  readonly connection: EnvironmentConnectionPresentation;
  readonly serverConfig: EnvironmentServerConfig | null;
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
        phase: state.lastFailure?.reason === "unsupported" ? "unsupported" : "error",
        ...shared,
      };
  }
}

type EnvironmentConnectionStatus = Pick<EnvironmentConnectionPresentation, "phase" | "error"> &
  Partial<Pick<EnvironmentConnectionPresentation, "traceId">>;

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
    case "unsupported":
      return "Client not supported";
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

/**
 * SSH connections ride a local forward that disappears with the client, so they have no stable
 * address.
 */
export function environmentMcpUrl(input: {
  readonly entry: ConnectionCatalogEntry;
  readonly relayHttpBaseUrl?: string | undefined;
  readonly connectedTarget?: ConnectionTarget | null | undefined;
}): string | null {
  const connectedRouteId = input.connectedTarget ? connectionRouteId(input.connectedTarget) : null;
  const routes = connectionRoutes(input.entry);
  const connectedRoute = routes.find(
    (route) => connectionRouteId(route.target) === connectedRouteId,
  );
  for (const route of connectedRoute ? [connectedRoute, ...routes] : routes) {
    const httpBaseUrl =
      route.target._tag === "RelayConnectionTarget"
        ? (input.relayHttpBaseUrl ?? null)
        : routeHttpBaseUrl(route);
    const mcpUrl = httpBaseUrl === null ? null : mcpUrlFromBase(httpBaseUrl);
    if (mcpUrl !== null) return mcpUrl;
  }
  return null;
}

function mcpUrlFromBase(httpBaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(httpBaseUrl);
  } catch {
    return null;
  }
  url.pathname = "/mcp";
  url.search = "";
  url.hash = "";
  return url.toString();
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
