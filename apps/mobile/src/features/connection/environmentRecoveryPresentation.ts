import type {
  EnvironmentConnectionPresentation,
  EnvironmentConnectionRetry,
} from "@t3tools/client-runtime/connection";

export type ConnectionNoticePresentation = Pick<
  EnvironmentConnectionPresentation,
  "phase" | "error"
> &
  Partial<Pick<EnvironmentConnectionPresentation, "failure" | "retry">>;

export function connectionNoticeDetail(
  connection: ConnectionNoticePresentation,
  resourceName: string,
  now = Date.now(),
): string {
  if (connection.retry?.mode === "automatic") {
    const timing =
      connection.retry.at === null
        ? "The app is retrying automatically."
        : `The app will retry automatically in ${Math.max(
            1,
            Math.ceil((connection.retry.at - now) / 1_000),
          )}s.`;
    return connection.failure ? `${timing} ${connection.failure.detail}` : timing;
  }
  if (connection.retry?.mode === "manual" && connection.failure) {
    switch (connection.failure.reason) {
      case "authentication":
        return `Open Environments to sign in or pair again before loading the ${resourceName}. ${connection.failure.detail}`;
      case "configuration":
        return `Open Environments and check the saved connection before loading the ${resourceName}. ${connection.failure.detail}`;
      case "permission":
      case "unsupported":
        return `This connection needs attention before the ${resourceName} can load. ${connection.failure.detail}`;
      default:
        return connection.failure.detail;
    }
  }
  if (connection.error) {
    return `Reconnect the environment to load the ${resourceName}. ${connection.error}`;
  }

  switch (connection.phase) {
    case "offline":
      return `Cached data remains available, and offline task submissions stay queued. The ${resourceName} will load when your connection returns.`;
    case "connecting":
    case "reconnecting":
      return `The ${resourceName} will load as soon as the environment is ready.`;
    case "available":
    case "error":
      return `Reconnect the environment to load the ${resourceName}.`;
    case "connected":
      return "";
  }
}

export function connectionNoticeSupportsRetryNow(connection: {
  readonly phase: EnvironmentConnectionPresentation["phase"];
  readonly retry?: EnvironmentConnectionRetry;
}): boolean {
  if (connection.phase === "offline" || connection.phase === "connected") return false;
  if (connection.retry?.mode === "automatic") return connection.retry.at !== null;
  if (connection.retry?.mode === "manual") return false;
  return connection.phase !== "connecting" && connection.phase !== "reconnecting";
}
