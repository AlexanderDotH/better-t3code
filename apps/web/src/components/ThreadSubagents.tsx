import type { OrchestrationSubagentSummary, ScopedThreadRef, SubagentId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { requestOlderSubagentActivities } from "@t3tools/client-runtime/state/threads";
import * as Option from "effect/Option";
import { useState } from "react";
import { useEnvironmentSubagent } from "../state/threads";
import { ChatAgentStack } from "./ChatAgentStack";
import { SubagentTranscriptDialog } from "./SubagentTranscriptDialog";

export function ThreadSubagents({
  threadRef,
  subagents,
  markdownCwd,
  timestampFormat,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly subagents: readonly OrchestrationSubagentSummary[];
  readonly markdownCwd?: string;
  readonly timestampFormat: TimestampFormat;
}) {
  const [selectedId, setSelectedId] = useState<SubagentId | null>(null);
  const state = useEnvironmentSubagent(threadRef.environmentId, threadRef.threadId, selectedId);
  const detail = Option.getOrNull(state.data);
  const page = Option.getOrNull(state.page);
  const error =
    Option.getOrNull(state.error) ??
    (state.status === "deleted" ? "This agent transcript is no longer available." : null);
  return (
    <>
      <ChatAgentStack
        subagents={subagents}
        selectedSubagentId={selectedId}
        onSelectSubagent={setSelectedId}
        className="chat-agent-floating-layer"
      />
      <SubagentTranscriptDialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        subagent={detail}
        isLoading={selectedId !== null && detail === null && error === null}
        errorMessage={error}
        threadRef={threadRef}
        timestampFormat={timestampFormat}
        {...(markdownCwd ? { markdownCwd } : {})}
        hasOlderActivities={page?.hasMore ?? false}
        isLoadingOlderActivities={page?.loadingOlder ?? false}
        onLoadOlderActivities={() => {
          if (selectedId !== null)
            requestOlderSubagentActivities(threadRef.environmentId, threadRef.threadId, selectedId);
        }}
      />
    </>
  );
}
