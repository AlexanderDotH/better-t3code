import {
  ThreadId,
  type EnvironmentId,
  type OrchestrationV2Subagent,
  type ScopedThreadRef,
  type ServerProvider,
  type SubagentId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  isActiveSubagentStatus,
  projectedSubagentsToRuntime,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { useState } from "react";
import {
  runtimeSubagentSummary,
  runtimeSubagentTranscript,
} from "./subagents/subagentPresentation";
import { ChatAgentStack } from "./ChatAgentStack";
import { SubagentTranscriptDialog } from "./SubagentTranscriptDialog";

export function ThreadSubagents({
  threadRef,
  subagents,
  providersByEnvironment,
  markdownCwd,
  timestampFormat,
  streamingMotionEnabled = true,
  onOpenThread,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent>;
  readonly providersByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyArray<ServerProvider>>;
  readonly onOpenThread?: (threadId: ThreadId) => void;
  readonly markdownCwd?: string | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly streamingMotionEnabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<SubagentId | null>(null);
  const runtimeAgents = projectedSubagentsToRuntime(subagents);
  const sourcesById = new Map<string, OrchestrationV2Subagent>(
    subagents.map((agent) => [agent.id, agent]),
  );
  const providersBySubagent = new Map<SubagentId, ServerProvider>();
  const agents = runtimeAgents.map((agent) => {
    const summary = runtimeSubagentSummary(agent);
    const sourceId = agent.kind === "workflow_agent" ? (agent.parentAgentId ?? agent.id) : agent.id;
    const source = sourcesById.get(sourceId);
    if (!source) return summary;

    const providerEnvironment = source.remoteChild?.environmentId ?? threadRef.environmentId;
    const provider = providersByEnvironment
      .get(providerEnvironment)
      ?.find((entry) => entry.instanceId === source.providerInstanceId);
    const driver = source.remoteChild === undefined ? source.driver : (provider?.driver ?? null);
    if (provider && provider.driver === driver) providersBySubagent.set(summary.id, provider);
    return {
      ...summary,
      providerInstanceId: source.providerInstanceId,
      providerDriver: driver,
    };
  });
  const selected = runtimeAgents.find((agent) => agent.id === selectedId);
  const detail = selected ? runtimeSubagentTranscript(selected) : null;

  return (
    <>
      <ChatAgentStack
        subagents={agents}
        providersBySubagent={providersBySubagent}
        hasActiveAgents={runtimeAgents.some((agent) => isActiveSubagentStatus(agent.status))}
        selectedSubagentId={selectedId}
        onSelectSubagent={(id) => {
          const agent = runtimeAgents.find((candidate) => candidate.id === id);
          if (agent?.childThreadId && onOpenThread)
            onOpenThread(ThreadId.make(agent.childThreadId));
          else setSelectedId(id);
        }}
      />
      <SubagentTranscriptDialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        subagent={detail}
        isLoading={selectedId !== null && detail === null}
        errorMessage={null}
        threadRef={threadRef}
        timestampFormat={timestampFormat}
        streamingMotionEnabled={streamingMotionEnabled}
        {...(markdownCwd ? { markdownCwd } : {})}
      />
    </>
  );
}
