import { MessageAudioAttachments } from "./MessageAudioAttachments";
import { ChatSizeMotion } from "./ChatSizeMotion";
import { shouldAutoExpandChangedFiles } from "./changedFilesPresentation";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { isAudioAttachment } from "../../types";
import { TimelineReasoningGroup } from "./TimelineReasoningGroup";
import { ResponseMetricsDetails } from "./ResponseMetricsDetails";
import {
  EditMessageButton,
  ForkMessageButton,
  MessageActionsOverlay,
  ReplyMessageButton,
  timelineMessageCanReply,
} from "./TimelineMessageActions";
import { TimelineMessageQuote } from "./TimelineMessageQuote";
import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import { type RunId } from "@t3tools/contracts";
import { canForkProjectedAssistantItem } from "@t3tools/client-runtime/state/thread-workflows";
import { memo, use, useState } from "react";
import { type ChatMessage, type TurnDiffSummary } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { GitForkIcon } from "lucide-react";
import { Button } from "../ui/button";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { HtmlRenderFrame } from "./HtmlRenderFrame";
import { McpAppFrame } from "./McpAppFrame";
import { checkpointFileTotals } from "@t3tools/client-runtime/state/thread-checkpoints";
import { ChangedFilesCard } from "./ChangedFilesTree";
import { useFileContextMenuHandler } from "../../fileContextMenu";
import { useAssistantMessageText, useProject, useThreadShell } from "../../state/entities";
import { MessageCopyButton } from "./MessageCopyButton";
import { AssistantCitationSource } from "./AssistantCitationSource";
import { resolveAssistantMessageCopyState } from "./MessagesTimeline.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { formatChatTimestampTooltip } from "../../timestampFormat";
import { useV2ItemSupport } from "../../state/v2ItemSupport";
import { TimelineRowCtx, TimelineRowActivityCtx, type TimelineRow } from "./timelineRowContext";
import {
  formatTimelineTimestamp,
  MESSAGE_HEADING_LEVEL,
  MessageAuthorHeading,
} from "./TimelineRowParts";

export function AssistantTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "message" }> }) {
  const ctx = use(TimelineRowCtx);
  const better = ctx.chatVisualMode === "better-t3";
  const translate = useInterfaceTranslator().message;
  const editor =
    ctx.editingMessage?.messageId === row.message.id ? ctx.editingMessage.content : null;
  // The timeline holds a streaming message's row while only its text grows.
  const liveText = useAssistantMessageText(
    row.message.streaming ? ctx.threadRef : null,
    row.projectedItem?.item.id,
  );
  const text = liveText ?? row.message.text;
  const isStreaming = Boolean(row.message.streaming);
  const audioAttachments = (row.message.attachments ?? []).filter(isAudioAttachment);
  const messageText =
    text ||
    (row.message.streaming || audioAttachments.length > 0 ? "" : translate("chat.timeline.empty"));
  const liveMetrics = Boolean(
    row.message.streaming && row.message.runId && ctx.responseMetrics?.has(row.message.runId),
  );
  const meta =
    row.showAssistantMeta || liveMetrics ? (
      <AssistantMessageMeta
        className={better ? "better-chat-meta" : "mt-1.5"}
        projectedItem={row.projectedItem}
        message={liveText === null ? row.message : { ...row.message, text }}
        showCopyButton={row.showAssistantCopyButton}
        copyStreaming={row.assistantCopyStreaming}
        revealOnHover
      />
    ) : row.showAssistantTimestamp ? (
      <AssistantMessageMeta
        className={better ? "better-chat-meta" : "mt-1.5"}
        message={row.message}
        showCopyButton={false}
        copyStreaming={row.assistantCopyStreaming}
        revealOnHover
      />
    ) : null;

  const bubble = (
    <div
      data-presentation-bubble={better ? "assistant" : undefined}
      className={cn(
        "relative min-w-0 px-1 py-0.5",
        better && "better-chat-bubble isolate text-message-foreground",
      )}
    >
      {better ? (
        <div
          aria-hidden
          data-presentation-surface
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        />
      ) : null}
      <MessageAuthorHeading>T3 Code</MessageAuthorHeading>
      {better && (!isStreaming || timelineMessageCanReply(ctx, row.message)) ? (
        <MessageActionsOverlay>
          <EditMessageButton
            message={row.message}
            editable={row.projectedItem?.visibility !== "inherited"}
          />
          <AssistantForkAction message={row.message} projectedItem={row.projectedItem} />
          <AssistantCopyButton
            message={row.message}
            showCopyButton={!isStreaming}
            streaming={isStreaming}
          />
          <ReplyMessageButton message={row.message} />
        </MessageActionsOverlay>
      ) : null}
      {row.message.replyTo ? <TimelineMessageQuote replyTo={row.message.replyTo} /> : null}
      {row.reasoningGroup ? (
        <div className="mb-3" data-message-reasoning>
          <TimelineReasoningGroup row={row.reasoningGroup} anchorKey={row.id} />
        </div>
      ) : null}
      <ChatSizeMotion enabled={!isStreaming}>
        {editor ?? (
          <div data-thread-find-text="true">
            <AssistantCitationSource
              messageId={row.message.id}
              {...(ctx.threadRef ? { threadRef: ctx.threadRef } : {})}
              itemKey={row.id}
              request={ctx.citationRequest}
              listRef={ctx.listRef}
            >
              <ChatMarkdown
                text={messageText}
                className={better ? "text-message-foreground" : ""}
                cwd={ctx.markdownCwd}
                threadRef={ctx.threadRef ?? undefined}
                isStreaming={isStreaming}
                streamId={`${ctx.routeThreadKey}:${row.id}`}
                animateInitialStreamChunk={
                  better ? ctx.canAnimateInitialText?.(row.id) === true : isStreaming
                }
                streamingMotionEnabled={ctx.streamingMotionEnabled !== false}
                streamingBlockMotionEnabled={!better}
                lineBreaks={shouldPreserveAssistantLineBreaks(messageText)}
                skills={ctx.skills}
                headingLevelOffset={MESSAGE_HEADING_LEVEL}
                onVisualizationAction={ctx.onVisualizationAction}
                onUseArtifactTemplate={ctx.onUseArtifactTemplate}
                onRunShellCommand={ctx.onRunShellCommand}
                onImageExpand={ctx.onImageExpand}
              />
            </AssistantCitationSource>
          </div>
        )}
      </ChatSizeMotion>
      <MessageAudioAttachments
        environmentId={ctx.activeThreadEnvironmentId}
        attachments={audioAttachments}
        className="mt-2"
      />
      {ctx.onOpenTurnDiff ? (
        <AssistantChangedFilesSection
          turnSummary={row.assistantTurnDiffSummary}
          routeThreadKey={ctx.routeThreadKey}
          resolvedTheme={ctx.resolvedTheme}
          onOpenTurnDiff={ctx.onOpenTurnDiff}
        />
      ) : null}
      {better ? null : meta}
    </div>
  );

  return better ? (
    <div className="better-chat-message">
      {bubble}
      {meta}
    </div>
  ) : (
    bubble
  );
}

function AssistantForkAction({
  message,
  projectedItem,
}: {
  readonly message: ChatMessage;
  readonly projectedItem: Extract<TimelineRow, { kind: "message" }>["projectedItem"];
}) {
  const ctx = use(TimelineRowCtx);
  if (ctx.onForkBoundary)
    return <ForkMessageButton message={message} projectedItem={projectedItem} />;
  return projectedItem?.item.type === "assistant_message" ? (
    <AssistantForkButton projectedItem={projectedItem} />
  ) : null;
}

function AssistantForkButton({
  projectedItem,
}: {
  readonly projectedItem: NonNullable<Extract<TimelineRow, { kind: "message" }>["projectedItem"]>;
}) {
  const ctx = use(TimelineRowCtx);
  const [busy, setBusy] = useState(false);
  const support = useV2ItemSupport({
    environmentId: ctx.activeThreadEnvironmentId,
    sourceThreadId: projectedItem.sourceThreadId,
    sourceItemId: projectedItem.sourceItemId,
  });
  const canFork = canForkProjectedAssistantItem({
    projectedItem,
    capabilities: support.providerSession?.capabilities,
  });

  const onForkFromRun = ctx.onForkFromRun;
  if (!canFork || onForkFromRun === undefined || projectedItem.item.runId === null) return null;
  const runId = projectedItem.item.runId;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onForkFromRun({ sourceThreadId: projectedItem.sourceThreadId, runId }).finally(
                () => setBusy(false),
              );
            }}
            aria-label="Fork from this response"
          />
        }
      >
        <GitForkIcon className={cn(busy && "animate-pulse")} />
      </TooltipTrigger>
      <TooltipPopup side="top">Fork from this response</TooltipPopup>
    </Tooltip>
  );
}

export function AssistantMetaTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "assistant-meta" }>;
}) {
  return (
    <div className="px-1">
      <AssistantMessageMeta
        className="mt-0.5"
        projectedItem={row.projectedItem}
        message={row.message}
        showCopyButton={row.showAssistantCopyButton}
        copyStreaming={row.assistantCopyStreaming}
      />
    </div>
  );
}

function AssistantMessageMeta({
  className,
  projectedItem,
  message,
  showCopyButton,
  copyStreaming,
  revealOnHover = false,
}: {
  className?: string;
  projectedItem?: Extract<TimelineRow, { kind: "message" }>["projectedItem"];
  message: ChatMessage;
  showCopyButton: boolean;
  copyStreaming: boolean;
  revealOnHover?: boolean;
}) {
  const ctx = use(TimelineRowCtx);
  const live = message.runId
    ? ctx.responseMetrics?.get(message.runId)?.liveStartedAt !== undefined
    : false;

  return (
    <div
      data-response-metrics-live={live || undefined}
      data-message-hover-details={revealOnHover || undefined}
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums transition-opacity duration-200",
        className,
      )}
    >
      {projectedItem && projectedItem.item.status !== "completed" ? (
        <span className="rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">
          {projectedItem.item.status}
        </span>
      ) : null}
      {/* Better T3 shows these in the bubble's overlay instead. */}
      {ctx.chatVisualMode !== "better-t3" && !message.streaming ? (
        <div className="flex shrink-0 items-center gap-0.5 empty:hidden">
          <AssistantForkAction message={message} projectedItem={projectedItem} />
          <AssistantCopyButton
            message={message}
            showCopyButton={showCopyButton}
            streaming={copyStreaming}
          />
          <EditMessageButton
            message={message}
            editable={projectedItem?.visibility !== "inherited"}
          />
        </div>
      ) : null}
      {!message.streaming && (
        <Tooltip>
          <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>
            {formatTimelineTimestamp(message.updatedAt, ctx.timestampFormat, ctx.chatVisualMode)}
          </TooltipTrigger>
          <TooltipPopup>
            {formatChatTimestampTooltip(message.updatedAt, ctx.timestampFormat)}
          </TooltipPopup>
        </Tooltip>
      )}
      {message.runId && ctx.responseMetrics ? (
        <ResponseMetricsDetails
          snapshot={ctx.responseMetrics.get(message.runId) ?? null}
          message={message}
        />
      ) : null}
    </div>
  );
}

function AssistantCopyButton({
  message,
  showCopyButton,
  streaming,
}: {
  message: ChatMessage;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: message.text ?? null,
    showCopyButton,
    streaming,
  });

  if (!assistantCopyState.visible) {
    return null;
  }

  return <MessageCopyButton text={assistantCopyState.text ?? ""} variant="ghost" size="icon-xs" />;
}

export function ProposedPlanTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "proposed-plan" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const forkFromPlan = useInterfaceTranslator().message("chat.fork.fromPlan");
  const deepPlanReview = ctx.deepPlanReview;
  const reviewedPlan =
    deepPlanReview &&
    row.proposedPlan.deepPlan?.runId === deepPlanReview.reference.runId &&
    row.proposedPlan.deepPlan.planVersion === deepPlanReview.reference.planVersion;

  return (
    <div className="min-w-0 px-1 py-0.5">
      {reviewedPlan ? (
        deepPlanReview.content
      ) : (
        <ProposedPlanCard
          actions={
            ctx.onForkBoundary ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={forkFromPlan}
                      disabled={ctx.forkAvailable === false || ctx.forkPendingBoundary != null}
                      onClick={() =>
                        ctx.onForkBoundary?.({ kind: "proposed-plan", planId: row.proposedPlan.id })
                      }
                    />
                  }
                >
                  <GitForkIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">{forkFromPlan}</TooltipPopup>
              </Tooltip>
            ) : undefined
          }
          variant={row.proposedPlan.deepPlan ? "deep-plan" : "plan"}
          planMarkdown={row.proposedPlan.planMarkdown}
          environmentId={ctx.activeThreadEnvironmentId}
          threadRef={ctx.threadRef ?? undefined}
          cwd={ctx.markdownCwd}
          workspaceRoot={ctx.workspaceRoot}
          findActive={ctx.findActive}
        />
      )}
    </div>
  );
}

export function HtmlRenderTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "html-render" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const { onAppFullscreenChange } = ctx;
  const onFullscreenChange = (fullscreen: boolean) => onAppFullscreenChange(row.id, fullscreen);

  if (ctx.renderHtmlRender) {
    return <div className="min-w-0 px-1">{ctx.renderHtmlRender(row)}</div>;
  }
  return (
    <div className="min-w-0 px-1">
      <HtmlRenderFrame
        key={row.htmlRender.attachmentId}
        environmentId={ctx.activeThreadEnvironmentId}
        htmlRender={row.htmlRender}
        threadRef={ctx.threadRef ?? undefined}
        onFullscreenChange={onFullscreenChange}
      />
    </div>
  );
}

export function McpAppTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "mcp-app" }> }) {
  const ctx = use(TimelineRowCtx);
  const { awaitingUser } = use(TimelineRowActivityCtx);

  return (
    <div className="min-w-0 px-1">
      <McpAppFrame
        key={row.mcpApp.attachmentId}
        environmentId={ctx.activeThreadEnvironmentId}
        threadId={row.sourceThreadId}
        conversationThreadId={ctx.threadRef?.threadId ?? row.sourceThreadId}
        itemId={row.itemId}
        revision={row.revision}
        app={row.mcpApp}
        onSendMessage={ctx.onSendAppMessage}
        awaitingUser={awaitingUser}
        onFullscreenChange={(fullscreen) => ctx.onAppFullscreenChange(row.id, fullscreen)}
      />
    </div>
  );
}

/** Subscribes directly to the UI state store for expand/collapse state,
 *  so toggling re-renders only this component — not the entire list. */
const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary | undefined;
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  displayThreadKey?: string;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  if (!turnSummary) return null;
  const checkpointFiles = turnSummary.files;
  if (checkpointFiles.length === 0) return null;

  return (
    <AssistantChangedFilesSectionInner
      turnSummary={turnSummary}
      checkpointFiles={checkpointFiles}
      routeThreadKey={routeThreadKey}
      resolvedTheme={resolvedTheme}
      onOpenTurnDiff={onOpenTurnDiff}
    />
  );
});

function AssistantChangedFilesSectionInner({
  turnSummary,
  checkpointFiles,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary;
  checkpointFiles: TurnDiffSummary["files"];
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  displayThreadKey?: string;
  onOpenTurnDiff: (runId: RunId, filePath?: string) => void;
}) {
  const ctx = use(TimelineRowCtx);
  const persistedExpanded = useUiStateStore(
    (store) => store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.runId],
  );
  const setExpanded = useUiStateStore((store) => store.setThreadChangedFilesExpanded);
  const { latestRunId } = use(TimelineRowActivityCtx);
  const isLatestRun = latestRunId === turnSummary.runId;
  const [autoExpanded] = useState(() => shouldAutoExpandChangedFiles(checkpointFiles, isLatestRun));
  const [classicDirectoriesExpanded, setClassicDirectoriesExpanded] = useState(autoExpanded);
  const classic = ctx.chatVisualMode === "classic";
  const allDirectoriesExpanded = classic
    ? classicDirectoriesExpanded
    : (persistedExpanded ?? false);

  const thread = useThreadShell(ctx.threadRef);
  const activeProject = useProject(
    thread && thread.projectId
      ? { environmentId: thread.environmentId, projectId: thread.projectId }
      : null,
  );
  const onFileContextMenu = useFileContextMenuHandler(ctx.activeThreadEnvironmentId);

  return (
    <ChangedFilesCard
      runId={turnSummary.runId}
      files={checkpointFiles}
      totals={checkpointFileTotals(turnSummary)}
      {...(ctx.chatVisualMode === "better-t3"
        ? {
            compactPresentation: {
              expanded: allDirectoriesExpanded,
              motionEnabled: ctx.presentationMotion === true,
              onExpandedChange: (expanded: boolean) =>
                setExpanded(routeThreadKey, turnSummary.runId, expanded),
            },
          }
        : ctx.chatVisualMode === "classic"
          ? {
              classicPresentation: {
                expanded: persistedExpanded ?? (isLatestRun && autoExpanded),
                showCompactPreview: isLatestRun,
                onExpandedChange: (expanded: boolean) =>
                  setExpanded(routeThreadKey, turnSummary.runId, expanded),
              },
            }
          : {})}
      allDirectoriesExpanded={allDirectoriesExpanded}
      resolvedTheme={resolvedTheme}
      onToggleAllDirectories={() =>
        classic
          ? setClassicDirectoriesExpanded(!allDirectoriesExpanded)
          : setExpanded(routeThreadKey, turnSummary.runId, !allDirectoriesExpanded)
      }
      onOpenTurnDiff={onOpenTurnDiff}
      onFileContextMenu={(filePath, event) =>
        onFileContextMenu(
          {
            environmentId: ctx.activeThreadEnvironmentId,
            filePath,
            workspaceRoot: ctx.workspaceRoot,
            repositoryRoot:
              thread?.worktreePath == null
                ? activeProject?.repositoryIdentity?.rootPath
                : undefined,
          },
          event,
        )
      }
    />
  );
}
