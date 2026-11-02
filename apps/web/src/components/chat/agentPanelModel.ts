import {
  deriveWorkflowGroups,
  isActiveSubagentStatus,
  isTerminalSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";

export function deriveAgentPanelModel(agents: ReadonlyArray<RuntimeSubagent>) {
  const workflows = deriveWorkflowGroups(agents);
  const directAgents = agents.filter(
    (agent) => agent.kind !== "workflow" && agent.kind !== "workflow_agent",
  );
  const counted = agents.filter((agent) => agent.kind !== "workflow");
  return {
    hasAgents: agents.length > 0,
    workflows,
    directAgents,
    runningCount: counted.filter(
      (agent) => isActiveSubagentStatus(agent.status) && agent.status !== "waiting",
    ).length,
    waitingCount: counted.filter((agent) => agent.status === "waiting").length,
    idleCount: counted.filter((agent) => agent.status === "idle").length,
    settledCount: counted.filter((agent) => isTerminalSubagentStatus(agent.status)).length,
    totalTokens: counted.reduce((total, agent) => total + (agent.usage?.totalTokens ?? 0), 0),
  };
}
export type AgentPanelModel = ReturnType<typeof deriveAgentPanelModel>;
