import { ThreadId, type DiscoveredLocalServer } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { threadPanelServers } from "./threadPanelServers";

it("filters servers by either terminal or agent ownership without exposing unrelated ports", () => {
  const threadId = ThreadId.make("selected");
  const other = ThreadId.make("other");
  const server: DiscoveredLocalServer = {
    host: "localhost",
    port: 3000,
    url: "http://localhost:3000",
    pid: 123,
    processName: "node",
    terminal: null,
  };
  const servers = [
    server,
    { ...server, port: 3001, terminal: { threadId, terminalId: "terminal" } },
    { ...server, port: 3002, agent: { threadId } },
    { ...server, port: 3003, terminal: { threadId: other, terminalId: "terminal" } },
    {
      ...server,
      port: 3004,
      terminal: { threadId: other, terminalId: "terminal" },
      agent: { threadId },
    },
  ];
  expect(threadPanelServers(servers, threadId).map((entry) => entry.port)).toEqual([
    3001, 3002, 3004,
  ]);
});
