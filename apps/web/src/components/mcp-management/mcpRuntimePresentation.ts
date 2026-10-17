import type { McpRuntimeServer, McpRuntimeState } from "@t3tools/contracts";

export type McpAggregateTone = "green" | "orange" | "red" | "gray";

export interface McpRuntimeAggregatePresentation {
  readonly tone: McpAggregateTone;
  readonly connectedCount: number;
  readonly expectedCount: number;
  readonly compactLabel: string;
  readonly label: string;
}

const TERMINAL_PROBLEM_STATES = new Set<McpRuntimeState>([
  "auth-required",
  "setup-required",
  "failed",
]);

const UNOBSERVED_STATES = new Set<McpRuntimeState>(["not-started", "unknown", "unsupported"]);

const SERVER_SOURCE_ORDER: Record<McpRuntimeServer["source"], number> = {
  "t3-managed": 0,
  "provider-native": 1,
  "t3-built-in": 2,
};

export function mcpRuntimeServerNeedsAttention(server: McpRuntimeServer): boolean {
  if (server.state === "disabled" || server.state === "unsupported") return false;
  return (
    TERMINAL_PROBLEM_STATES.has(server.state) ||
    server.state === "stale" ||
    server.configDrift !== "none"
  );
}

export function orderMcpRuntimeServers(
  servers: ReadonlyArray<McpRuntimeServer>,
): McpRuntimeServer[] {
  return [...servers].sort((left, right) => {
    const sourceOrder = SERVER_SOURCE_ORDER[left.source] - SERVER_SOURCE_ORDER[right.source];
    if (sourceOrder !== 0) return sourceOrder;
    const attentionOrder =
      Number(mcpRuntimeServerNeedsAttention(right)) - Number(mcpRuntimeServerNeedsAttention(left));
    const problemOrder =
      Number(TERMINAL_PROBLEM_STATES.has(right.state)) -
      Number(TERMINAL_PROBLEM_STATES.has(left.state));
    return problemOrder || attentionOrder || left.name.localeCompare(right.name);
  });
}

function isExpectedUserServer(server: McpRuntimeServer): boolean {
  return (
    server.source !== "t3-built-in" && server.state !== "disabled" && server.state !== "unsupported"
  );
}

function aggregateLabel(connectedCount: number, expectedCount: number): string {
  if (expectedCount === 0) {
    return "MCP status unavailable";
  }
  if (connectedCount === expectedCount) {
    return expectedCount === 1
      ? "All MCP servers connected"
      : `All ${expectedCount} MCP servers connected`;
  }
  return `${connectedCount} of ${expectedCount} MCP servers connected`;
}

export function aggregateMcpRuntimeStatus(
  servers: ReadonlyArray<McpRuntimeServer>,
): McpRuntimeAggregatePresentation {
  const expected = servers.filter(isExpectedUserServer);
  const expectedCount = expected.length;
  const connectedCount = expected.filter((server) => server.state === "connected").length;
  const hasConfigDrift = expected.some((server) => server.configDrift !== "none");
  const compactLabel = `MCP ${connectedCount}/${expectedCount}`;
  const label = aggregateLabel(connectedCount, expectedCount);

  if (expectedCount === 0) {
    return { tone: "gray", connectedCount, expectedCount, compactLabel, label };
  }

  if (connectedCount === expectedCount && !hasConfigDrift) {
    return { tone: "green", connectedCount, expectedCount, compactLabel, label };
  }

  const allTerminalProblems = expected.every((server) => TERMINAL_PROBLEM_STATES.has(server.state));
  if (connectedCount === 0 && allTerminalProblems) {
    return { tone: "red", connectedCount, expectedCount, compactLabel, label };
  }

  const allUnobserved = expected.every((server) => UNOBSERVED_STATES.has(server.state));
  if (allUnobserved && !hasConfigDrift) {
    return { tone: "gray", connectedCount, expectedCount, compactLabel, label };
  }

  return { tone: "orange", connectedCount, expectedCount, compactLabel, label };
}

export function mcpRuntimeStateLabel(state: McpRuntimeState): string {
  switch (state) {
    case "not-started":
      return "Not started";
    case "starting":
      return "Starting";
    case "connected":
      return "Connected";
    case "auth-required":
      return "Authorization required";
    case "setup-required":
      return "Setup required";
    case "failed":
      return "Failed";
    case "disabled":
      return "Disabled";
    case "unsupported":
      return "Status unavailable";
    case "unknown":
      return "Unknown";
    case "stale":
      return "Status may be outdated";
  }
}
