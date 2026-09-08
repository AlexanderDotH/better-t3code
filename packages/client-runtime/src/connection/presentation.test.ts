import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { BearerConnectionProfile, type ConnectionCatalogEntry } from "./catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
  type SupervisorConnectionState,
} from "./model.ts";
import {
  connectionCatalogDisplayUrl,
  connectionPhaseMessage,
  connectionStatusText,
  connectionStatusTitle,
  presentEnvironmentConnection,
  presentConnectionState,
} from "./presentation.ts";

const TARGET = new BearerConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  connectionId: "connection-1",
});

const ENTRY: ConnectionCatalogEntry = {
  target: TARGET,
  profile: Option.some(
    new BearerConnectionProfile({
      connectionId: TARGET.connectionId,
      environmentId: TARGET.environmentId,
      label: TARGET.label,
      httpBaseUrl: "https://environment.example.test",
      wsBaseUrl: "wss://environment.example.test",
    }),
  ),
};

function supervisorState(overrides: Partial<SupervisorConnectionState>): SupervisorConnectionState {
  return {
    desired: true,
    network: "online",
    phase: "connecting",
    stage: "preparing",
    attempt: 1,
    generation: 0,
    lastFailure: null,
    retryAt: null,
    ...overrides,
  };
}

describe("connection presentation", () => {
  it("preserves profile display information without exposing credentials", () => {
    expect(connectionCatalogDisplayUrl(ENTRY)).toBe("https://environment.example.test");
  });

  it("distinguishes initial connection, reconnect, and retry errors", () => {
    expect(presentConnectionState(supervisorState({ phase: "connecting", attempt: 1 }))).toEqual({
      phase: "connecting",
      network: "online",
      stage: "preparing",
      attempt: 1,
      failure: null,
      retry: { mode: "none", at: null },
      error: null,
      traceId: null,
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "connecting",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Socket closed.",
            traceId: "trace-previous",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      network: "online",
      stage: "preparing",
      attempt: 2,
      failure: {
        kind: "transient",
        reason: "transport",
        detail: "Socket closed.",
        traceId: "trace-previous",
      },
      retry: { mode: "automatic", at: null },
      error: "Socket closed.",
      traceId: "trace-previous",
    });
    expect(
      presentConnectionState(
        supervisorState({
          phase: "backoff",
          stage: null,
          attempt: 2,
          retryAt: 1,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Disconnected.",
            traceId: "trace-1",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      network: "online",
      stage: null,
      attempt: 2,
      failure: {
        kind: "transient",
        reason: "transport",
        detail: "Disconnected.",
        traceId: "trace-1",
      },
      retry: { mode: "automatic", at: 1 },
      error: "Disconnected.",
      traceId: "trace-1",
    });
  });

  it("preserves the latest failure while the next attempt is active", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connecting",
          stage: "opening",
          attempt: 2,
          lastFailure: new ConnectionTransientError({
            reason: "transport",
            detail: "Relay connection timed out.",
            traceId: "trace-retry",
          }),
        }),
      ),
    ).toEqual({
      phase: "reconnecting",
      network: "online",
      stage: "opening",
      attempt: 2,
      failure: {
        kind: "transient",
        reason: "transport",
        detail: "Relay connection timed out.",
        traceId: "trace-retry",
      },
      retry: { mode: "automatic", at: null },
      error: "Relay connection timed out.",
      traceId: "trace-retry",
    });
  });

  it("preserves transient retry state for clients without creating a client-side timer", () => {
    expect(
      presentConnectionState(
        supervisorState({
          network: "online",
          phase: "backoff",
          stage: null,
          attempt: 3,
          retryAt: 12_345,
          lastFailure: new ConnectionTransientError({
            reason: "endpoint-unavailable",
            detail: "The environment endpoint is unavailable.",
            traceId: "trace-transient",
          }),
        }),
      ),
    ).toMatchObject({
      network: "online",
      stage: null,
      attempt: 3,
      failure: {
        kind: "transient",
        reason: "endpoint-unavailable",
        detail: "The environment endpoint is unavailable.",
        traceId: "trace-transient",
      },
      retry: {
        mode: "automatic",
        at: 12_345,
      },
    });
  });

  it("presents blocked failures as manual recovery and ignores stale retry timestamps", () => {
    expect(
      presentConnectionState(
        supervisorState({
          phase: "blocked",
          stage: null,
          attempt: 1,
          retryAt: 99_999,
          lastFailure: new ConnectionBlockedError({
            reason: "authentication",
            detail: "Pair this environment again.",
            traceId: "trace-blocked",
          }),
        }),
      ),
    ).toMatchObject({
      network: "online",
      stage: null,
      attempt: 1,
      failure: {
        kind: "blocked",
        reason: "authentication",
        detail: "Pair this environment again.",
        traceId: "trace-blocked",
      },
      retry: {
        mode: "manual",
        at: null,
      },
    });
  });

  it("gives offline status precedence in global messaging", () => {
    expect(connectionPhaseMessage("connected", TARGET.label, "offline")).toBe("You are offline");
  });

  it("combines reconnect progress with the latest failure", () => {
    const connection = {
      phase: "reconnecting",
      error: "Relay request timed out.",
      traceId: "trace-retry",
    } as const;
    expect(connectionStatusText(connection)).toBe(
      "Failed to connect. Reconnecting... Reason: Relay request timed out.",
    );
    expect(connectionStatusTitle(connection)).toBe("Failed to connect. Reconnecting...");
  });

  it("presents the supervisor's offline state without consulting shell state", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          network: "offline",
          phase: "offline",
          stage: null,
        }),
      ),
    ).toEqual({
      phase: "offline",
      network: "offline",
      stage: null,
      attempt: 1,
      failure: null,
      retry: { mode: "none", at: null },
      error: null,
      traceId: null,
    });
  });

  it("keeps offline failure details structured while preserving legacy status fields", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          network: "offline",
          phase: "offline",
          stage: null,
          lastFailure: new ConnectionTransientError({
            reason: "network",
            detail: "The previous network request failed.",
            traceId: "trace-offline",
          }),
        }),
      ),
    ).toEqual({
      phase: "offline",
      network: "offline",
      stage: null,
      attempt: 1,
      failure: {
        kind: "transient",
        reason: "network",
        detail: "The previous network request failed.",
        traceId: "trace-offline",
      },
      retry: { mode: "none", at: null },
      error: null,
      traceId: null,
    });
  });

  it("presents a connected supervisor snapshot as connected", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          phase: "connected",
          stage: null,
          generation: 1,
        }),
      ),
    ).toEqual({
      phase: "connected",
      network: "online",
      stage: null,
      attempt: 1,
      failure: null,
      retry: { mode: "none", at: null },
      error: null,
      traceId: null,
    });
  });

  it("preserves an explicitly available environment while offline", () => {
    expect(
      presentEnvironmentConnection(
        supervisorState({
          desired: false,
          network: "offline",
          phase: "available",
          stage: null,
          attempt: 0,
        }),
      ),
    ).toEqual({
      phase: "available",
      network: "offline",
      stage: null,
      attempt: 0,
      failure: null,
      retry: { mode: "none", at: null },
      error: null,
      traceId: null,
    });
  });
});
