import { use } from "react";
import * as DateTime from "effect/DateTime";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import { TimelineRowCtx } from "./timelineRowContext";
import { WorkingReasoningLog } from "./WorkingReasoningDialog";
import { ChatReasoningDisclosure } from "./ChatReasoningDisclosure";

export function TimelineReasoningGroup({
  row,
  anchorKey,
}: {
  row: Extract<MessagesTimelineRow, { kind: "activity-group" }>;
  anchorKey?: string;
}) {
  const resolvedAnchorKey = anchorKey === undefined ? row.id : anchorKey;
  const ctx = use(TimelineRowCtx);
  const traces = row.entries.map(({ entry }) => ({
    id: entry.id,
    detail: entry.detail ?? entry.label,
    createdAt: entry.createdAt,
    updatedAt: entry.projectedItem
      ? DateTime.formatIso(entry.projectedItem.item.updatedAt)
      : entry.createdAt,
    runId: entry.runId ?? null,
    streaming: row.active && entry.toolLifecycleStatus === "inProgress",
  }));
  if (ctx.showWorkingReasoning)
    return <WorkingReasoningLog traces={traces} chatVisualMode={ctx.chatVisualMode ?? "current"} />;
  const expanded = ctx.expandedWorkGroupIds?.has(row.groupId) ?? false;
  return (
    <ChatReasoningDisclosure
      traces={traces}
      expanded={expanded}
      onExpandedChange={(next) => {
        if (next !== expanded) ctx.onToggleWorkGroup(row.groupId, resolvedAnchorKey);
      }}
      motion={ctx.presentationMotion === true}
      markdown={{
        cwd: ctx.markdownCwd,
        threadRef: ctx.threadRef ?? undefined,
        environmentId: ctx.activeThreadEnvironmentId,
        skills: ctx.skills,
        streamId: `${ctx.routeThreadKey}:${row.id}`,
        onImageExpand: ctx.onImageExpand,
        onUseArtifactTemplate: ctx.onUseArtifactTemplate,
        ...(ctx.onSendAppMessage
          ? { onVisualizationAction: (prompt: string) => void ctx.onSendAppMessage?.(prompt) }
          : {}),
      }}
    />
  );
}
