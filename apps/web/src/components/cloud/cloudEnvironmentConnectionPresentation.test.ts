import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import { presentSavedCloudEnvironmentConnection } from "./cloudEnvironmentConnectionPresentation";

const english = createInterfaceTranslator({ language: "en", locale: "en-US" });
const german = createInterfaceTranslator({ language: "de", locale: "de-DE" });

function connection(
  phase: EnvironmentConnectionPresentation["phase"],
  error: string | null = null,
): EnvironmentConnectionPresentation {
  return {
    phase,
    network: "online",
    stage: null,
    attempt: 0,
    failure: null,
    retry: { mode: "none", at: null },
    error,
    traceId: null,
  };
}

describe("saved cloud environment connection presentation", () => {
  it("only labels a live connection as connected", () => {
    expect(presentSavedCloudEnvironmentConnection(connection("connected"), english)).toEqual({
      buttonLabel: "Connected",
      statusText: "Connected",
      tone: "connected",
    });

    expect(presentSavedCloudEnvironmentConnection(connection("connecting"), english)).toEqual({
      buttonLabel: "Connecting…",
      statusText: "Connecting…",
      tone: "connecting",
    });
  });

  it("surfaces a failed attempt while the supervisor reconnects", () => {
    expect(
      presentSavedCloudEnvironmentConnection(
        connection("reconnecting", "Relay environment endpoint is unavailable."),
        english,
      ),
    ).toEqual({
      buttonLabel: "Reconnecting…",
      statusText:
        "Failed to connect. Reconnecting… Reason: Relay environment endpoint is unavailable.",
      tone: "connecting",
    });
  });

  it.each([
    ["error", "Connection failed", "Connection failed. Reason: Access denied.", "error"],
    ["offline", "Offline", "Offline", "idle"],
    ["available", "Not connected", "Available", "idle"],
  ] as const)(
    "presents %s without claiming the environment is connected",
    (phase, buttonLabel, statusText, tone) => {
      expect(
        presentSavedCloudEnvironmentConnection(
          connection(phase, phase === "error" ? "Access denied." : null),
          english,
        ),
      ).toEqual({ buttonLabel, statusText, tone });
    },
  );

  it("localizes product copy while preserving the server failure verbatim", () => {
    expect(
      presentSavedCloudEnvironmentConnection(
        connection("reconnecting", "relay handshake 431"),
        german,
      ),
    ).toEqual({
      buttonLabel: "Erneute Verbindung…",
      statusText:
        "Verbindung fehlgeschlagen. Erneuter Verbindungsversuch… Grund: relay handshake 431",
      tone: "connecting",
    });
  });
});
