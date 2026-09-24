import type { OrchestrationSubagentSummary, ScopedThreadRef, SubagentId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { requestOlderSubagentActivities } from "@t3tools/client-runtime/state/threads";
import * as Option from "effect/Option";
import { useLayoutEffect, useRef, useState } from "react";
import { useEnvironmentSubagent } from "../state/threads";
import { ChatAgentStack } from "./ChatAgentStack";
import { SubagentTranscriptDialog } from "./SubagentTranscriptDialog";

const MIN_AGENT_CHAT_GAP_PX = 12;

export function ThreadSubagents({
  threadRef,
  subagents,
  markdownCwd,
  timestampFormat,
  streamingMotionEnabled = false,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly subagents: readonly OrchestrationSubagentSummary[];
  readonly markdownCwd?: string;
  readonly timestampFormat: TimestampFormat;
  readonly streamingMotionEnabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<SubagentId | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const chatWidthProbeRef = useRef<HTMLDivElement>(null);
  const state = useEnvironmentSubagent(threadRef.environmentId, threadRef.threadId, selectedId);
  const detail = Option.getOrNull(state.data);
  const page = Option.getOrNull(state.page);
  const error =
    Option.getOrNull(state.error) ??
    (state.status === "deleted" ? "This agent transcript is no longer available." : null);

  useLayoutEffect(() => {
    const stack = stackRef.current;
    const chatWidthProbe = chatWidthProbeRef.current;
    const chatColumn = stack?.closest<HTMLElement>("[data-chat-column]");
    if (!stack || !chatWidthProbe || !chatColumn) return;

    let frame: number | null = null;
    const updateLayout = () => {
      frame = null;
      const renderedChatRect = chatColumn
        .querySelector<HTMLElement>("[data-timeline-root]")
        ?.getBoundingClientRect();
      const chatLeft =
        renderedChatRect && renderedChatRect.width > 0
          ? renderedChatRect.left
          : chatWidthProbe.getBoundingClientRect().left;
      const availableGap = chatLeft - stack.getBoundingClientRect().right;
      const layout = availableGap >= MIN_AGENT_CHAT_GAP_PX ? "expanded" : "compact";
      if (stack.dataset.agentLayout !== layout) stack.dataset.agentLayout = layout;
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updateLayout);
    };

    updateLayout();
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(chatColumn);
    resizeObserver.observe(chatWidthProbe);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      {/* Timeline rows are virtualized, so this keeps their width measurable while no row is mounted. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 top-0 sm:inset-x-5">
        <div
          ref={chatWidthProbeRef}
          data-chat-width-probe=""
          className="mx-auto h-0 w-full max-w-full sm:max-w-[var(--chat-content-width,48rem)]"
        />
      </div>
      <ChatAgentStack
        subagents={subagents}
        selectedSubagentId={selectedId}
        onSelectSubagent={setSelectedId}
        className="chat-agent-floating-layer"
        stackRef={stackRef}
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
        streamingMotionEnabled={streamingMotionEnabled}
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
