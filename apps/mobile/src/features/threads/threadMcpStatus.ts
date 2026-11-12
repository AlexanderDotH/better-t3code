import type { McpRuntimeContext, McpRuntimeServer, ThreadId } from "@t3tools/contracts";

export function selectThreadMcpContext(
  contexts: ReadonlyArray<McpRuntimeContext>,
  threadId: ThreadId,
) {
  return (
    contexts
      .filter((context) => context.threadId === threadId)
      .sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.updatedAt.localeCompare(left.updatedAt),
      )[0] ?? null
  );
}

export function threadMcpStatus(
  servers: ReadonlyArray<Pick<McpRuntimeServer, "state" | "authState" | "toolCount">>,
) {
  return {
    connected: servers.filter((server) => server.state === "connected").length,
    attention: servers.filter(
      (server) =>
        server.state === "failed" ||
        server.state === "auth-required" ||
        server.state === "setup-required" ||
        server.authState === "required",
    ).length,
    tools: servers.some((server) => server.toolCount === undefined)
      ? null
      : servers.reduce((count, server) => count + (server.toolCount ?? 0), 0),
  };
}
