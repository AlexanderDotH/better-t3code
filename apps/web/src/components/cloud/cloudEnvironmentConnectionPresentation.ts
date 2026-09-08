import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

export interface SavedCloudEnvironmentConnectionPresentation {
  readonly buttonLabel: string;
  readonly statusText: string;
  readonly tone: "connected" | "connecting" | "error" | "idle";
}

/**
 * Present the live supervisor state for an environment that is already in the
 * connection catalog. Catalog membership only means the environment is saved;
 * it does not mean the connection attempt succeeded.
 */
export function presentSavedCloudEnvironmentConnection(
  connection: EnvironmentConnectionPresentation,
  translator: InterfaceTranslator,
): SavedCloudEnvironmentConnectionPresentation {
  switch (connection.phase) {
    case "connected":
      return {
        buttonLabel: translator.message("cloud.connection.connected"),
        statusText: translator.message("cloud.connection.connected"),
        tone: "connected",
      };
    case "connecting":
      return {
        buttonLabel: translator.message("cloud.connection.connecting"),
        statusText: translator.message("cloud.connection.connecting"),
        tone: "connecting",
      };
    case "reconnecting":
      return {
        buttonLabel: translator.message("cloud.connection.reconnecting"),
        statusText:
          connection.error === null
            ? translator.message("cloud.connection.reconnecting")
            : translator.message("cloud.connection.reconnectingReason", {
                error: connection.error,
              }),
        tone: "connecting",
      };
    case "error":
      return {
        buttonLabel: translator.message("cloud.connection.failed"),
        statusText:
          connection.error === null
            ? translator.message("cloud.connection.failed")
            : translator.message("cloud.connection.failedReason", { error: connection.error }),
        tone: "error",
      };
    case "offline":
      return {
        buttonLabel: translator.message("cloud.connection.offline"),
        statusText: translator.message("cloud.connection.offline"),
        tone: "idle",
      };
    case "available":
      return {
        buttonLabel: translator.message("cloud.connection.notConnected"),
        statusText: translator.message("cloud.connection.available"),
        tone: "idle",
      };
  }
}
