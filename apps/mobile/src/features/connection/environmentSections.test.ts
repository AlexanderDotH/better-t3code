import { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import { describe, expect, it } from "vite-plus/test";
import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import {
  environmentPairingPrefill,
  environmentRecoveryAction,
  environmentLastSyncedText,
  relayManagedEnvironmentIds,
  splitEnvironmentSections,
} from "./environmentSections";

function connectedEnvironment(
  input: Omit<Partial<ConnectedEnvironmentSummary>, "environmentId"> & {
    readonly environmentId: string;
    readonly isRelayManaged: boolean;
  },
): ConnectedEnvironmentSummary {
  return {
    environmentId: EnvironmentId.make(input.environmentId),
    environmentLabel: input.environmentLabel ?? input.environmentId,
    displayUrl: input.displayUrl ?? `https://${input.environmentId}.example.test/`,
    isRelayManaged: input.isRelayManaged,
    connectionState: input.connectionState ?? "connected",
    connectionError: input.connectionError ?? null,
    connectionErrorTraceId: input.connectionErrorTraceId ?? null,
  };
}

function cloudEnvironment(environmentId: string): RelayClientEnvironmentRecord {
  return {
    environmentId: EnvironmentId.make(environmentId),
    label: environmentId,
    endpoint: {
      httpBaseUrl: `https://${environmentId}.cloud.example.test/`,
      wsBaseUrl: `wss://${environmentId}.cloud.example.test/ws`,
      providerKind: "cloudflare_tunnel",
    },
    linkedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("relayManagedEnvironmentIds", () => {
  it("leaves out a backend that was saved directly", () => {
    const ids = relayManagedEnvironmentIds([
      connectedEnvironment({ environmentId: "environment-local", isRelayManaged: false }),
      connectedEnvironment({ environmentId: "environment-cloud", isRelayManaged: true }),
    ]);

    expect([...ids]).toEqual([EnvironmentId.make("environment-cloud")]);
  });
});

describe("environmentRecoveryAction", () => {
  it("offers an immediate retry only while an automatic retry is waiting", () => {
    expect(
      environmentRecoveryAction({
        phase: "reconnecting",
        isRelayManaged: false,
        retry: { mode: "automatic", at: 1_787_169_600_000 },
        failureReason: "network",
      }),
    ).toEqual({ kind: "retry", label: "Retry now" });

    expect(
      environmentRecoveryAction({
        phase: "reconnecting",
        isRelayManaged: false,
        retry: { mode: "automatic", at: null },
        failureReason: "network",
      }),
    ).toBeNull();
  });

  it("routes blocked failures to the recovery that can actually resolve them", () => {
    expect(
      environmentRecoveryAction({
        phase: "error",
        isRelayManaged: false,
        retry: { mode: "manual", at: null },
        failureReason: "configuration",
      }),
    ).toEqual({ kind: "edit", label: "Edit connection" });
    expect(
      environmentRecoveryAction({
        phase: "error",
        isRelayManaged: false,
        retry: { mode: "manual", at: null },
        failureReason: "authentication",
      }),
    ).toEqual({ kind: "pair", label: "Pair again" });
    expect(
      environmentRecoveryAction({
        phase: "error",
        isRelayManaged: true,
        retry: { mode: "manual", at: null },
        failureReason: "authentication",
      }),
    ).toEqual({ kind: "sign-in", label: "Sign in again" });
    expect(
      environmentRecoveryAction({
        phase: "error",
        isRelayManaged: true,
        retry: { mode: "manual", at: null },
        failureReason: "permission",
      }),
    ).toBeNull();
  });

  it("does not suggest retrying while the phone is offline", () => {
    expect(
      environmentRecoveryAction({
        phase: "offline",
        isRelayManaged: false,
        retry: { mode: "none", at: null },
        failureReason: null,
      }),
    ).toBeNull();
  });
});

describe("environmentPairingPrefill", () => {
  it("reuses the saved direct URL without carrying an expired credential", () => {
    expect(
      environmentPairingPrefill(
        connectedEnvironment({
          environmentId: "environment-local",
          isRelayManaged: false,
          displayUrl: " https://host.example.test:3773/ ",
        }),
      ),
    ).toBe("https://host.example.test:3773/");
  });

  it("does not turn a relay registration into a direct pairing request", () => {
    expect(
      environmentPairingPrefill(
        connectedEnvironment({ environmentId: "environment-cloud", isRelayManaged: true }),
      ),
    ).toBeNull();
  });
});

describe("environmentLastSyncedText", () => {
  const now = Date.UTC(2026, 7, 23, 12, 0, 0);

  it("only presents cache freshness while an environment is disconnected", () => {
    expect(
      environmentLastSyncedText({ phase: "connected", updatedAt: now - 4 * 60_000, now }),
    ).toBeNull();
    expect(
      environmentLastSyncedText({ phase: "reconnecting", updatedAt: now - 4 * 60_000, now }),
    ).toBe("Last synced 4 min ago");
  });

  it("uses stable, compact buckets without a repainting timer", () => {
    expect(environmentLastSyncedText({ phase: "error", updatedAt: now - 15_000, now })).toBe(
      "Last synced just now",
    );
    expect(
      environmentLastSyncedText({ phase: "available", updatedAt: now - 3 * 60 * 60_000, now }),
    ).toBe("Last synced 3 hr ago");
    expect(
      environmentLastSyncedText({ phase: "offline", updatedAt: now - 3 * 24 * 60 * 60_000, now }),
    ).toBe("Last synced 3 days ago");
  });

  it("omits missing or invalid cache timestamps", () => {
    expect(environmentLastSyncedText({ phase: "error", updatedAt: null, now })).toBeNull();
    expect(environmentLastSyncedText({ phase: "error", updatedAt: Number.NaN, now })).toBeNull();
  });
});

describe("mobile environment settings sections", () => {
  it("keeps saved relay-managed connections under T3 Connect", () => {
    const local = connectedEnvironment({
      environmentId: "environment-local",
      isRelayManaged: false,
    });
    const cloud = connectedEnvironment({
      environmentId: "environment-cloud",
      isRelayManaged: true,
    });

    const sections = splitEnvironmentSections({
      connectedEnvironments: [cloud, local],
      cloudEnvironments: [
        cloudEnvironment("environment-cloud"),
        cloudEnvironment("environment-new"),
      ],
    });

    expect(sections.localEnvironments).toEqual([local]);
    expect(sections.connectedCloudEnvironments).toEqual([cloud]);
    expect(
      sections.availableCloudEnvironments.map((environment) => environment.environmentId),
    ).toEqual([EnvironmentId.make("environment-new")]);
  });

  it("keeps saved relay-managed connections visible when cloud listing is unavailable", () => {
    const cloud = connectedEnvironment({
      environmentId: "environment-cloud",
      isRelayManaged: true,
      connectionState: "reconnecting",
      connectionError: "Environment did not respond before the connection timeout.",
    });

    const sections = splitEnvironmentSections({
      connectedEnvironments: [cloud],
      cloudEnvironments: null,
    });

    expect(sections.localEnvironments).toEqual([]);
    expect(sections.connectedCloudEnvironments).toEqual([cloud]);
    expect(sections.availableCloudEnvironments).toEqual([]);
  });

  it("keeps an available saved relay environment as a fallback when listing is unavailable", () => {
    const cloud = connectedEnvironment({
      environmentId: "environment-cloud",
      isRelayManaged: true,
      connectionState: "available",
    });

    const sections = splitEnvironmentSections({
      connectedEnvironments: [cloud],
      cloudEnvironments: null,
    });

    expect(sections.connectedCloudEnvironments).toEqual([cloud]);
    expect(sections.availableCloudEnvironments).toEqual([]);
  });

  it("does not duplicate a saved relay environment in the available cloud listing", () => {
    const cloud = connectedEnvironment({
      environmentId: "environment-cloud",
      isRelayManaged: true,
      connectionState: "available",
    });
    const listedCloud = cloudEnvironment("environment-cloud");

    const sections = splitEnvironmentSections({
      connectedEnvironments: [cloud],
      cloudEnvironments: [listedCloud],
    });

    expect(sections.connectedCloudEnvironments).toEqual([cloud]);
    expect(sections.availableCloudEnvironments).toEqual([]);
  });

  it("still offers a cloud environment saved directly as a local backend", () => {
    const local = connectedEnvironment({
      environmentId: "environment-cloud",
      isRelayManaged: false,
    });

    const sections = splitEnvironmentSections({
      connectedEnvironments: [local],
      cloudEnvironments: [cloudEnvironment("environment-cloud")],
    });

    expect(sections.localEnvironments).toEqual([local]);
    expect(sections.connectedCloudEnvironments).toEqual([]);
    expect(
      sections.availableCloudEnvironments.map((environment) => environment.environmentId),
    ).toEqual([EnvironmentId.make("environment-cloud")]);
  });

  it("keeps failed relay environments in the local connection row", () => {
    const cloud = connectedEnvironment({
      environmentId: "environment-cloud",
      isRelayManaged: true,
      connectionState: "error",
      connectionError: "Connection failed.",
    });

    const sections = splitEnvironmentSections({
      connectedEnvironments: [cloud],
      cloudEnvironments: [cloudEnvironment("environment-cloud")],
    });

    expect(sections.connectedCloudEnvironments).toEqual([cloud]);
    expect(sections.availableCloudEnvironments).toEqual([]);
  });
});
