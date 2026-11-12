import type { DiscoveredLocalServer, ThreadId } from "@t3tools/contracts";

export function threadPanelServers(
  servers: ReadonlyArray<DiscoveredLocalServer>,
  threadId: ThreadId,
) {
  return servers.filter(
    (server) => server.terminal?.threadId === threadId || server.agent?.threadId === threadId,
  );
}
