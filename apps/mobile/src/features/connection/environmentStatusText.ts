import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

export function environmentStatusText(
  connection: Pick<EnvironmentConnectionPresentation, "phase" | "error" | "traceId">,
): string {
  return connection.phase === "unsupported" && connection.error !== null
    ? connection.error
    : connectionStatusText(connection);
}
