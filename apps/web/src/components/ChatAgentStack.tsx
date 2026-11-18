import type { ServerProvider, SubagentId } from "@t3tools/contracts";
import type { OrchestrationSubagentSummary } from "@t3tools/contracts/legacy";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { ArchiveIcon, PlusIcon } from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useState,
  type AnimationEvent as ReactAnimationEvent,
} from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "../hooks/useInterfaceTranslator";

import { useChatCanvas } from "./chat/ChatCanvasContext";
import { ThreadDetailsControl } from "./chat/ThreadDetailsControl";
import { ThreadLineageGroupToggle } from "./chat/ThreadLineageGroupToggle";
import {
  ThreadRelationshipIcon,
  threadRelationshipStatusLabel,
} from "./chat/ThreadRelationshipIcon";
import { ThreadHoverCardPopup } from "./ThreadHoverCard";
import {
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
} from "./subagents/subagentPresentation";
import { compareArchivedAgents } from "./subagents/subagentLifecycle";
import {
  useSubagentLifecycleStack,
  type SubagentPresenceEntry,
} from "./subagents/useSubagentLifecycleStack";
import { Tooltip, TooltipTrigger } from "./ui/tooltip";

export interface ChatAgentStackProps {
  readonly subagents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly providersBySubagent: ReadonlyMap<SubagentId, ServerProvider>;
  readonly hasActiveAgents: boolean;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
}

const ARCHIVED_AGENT_RENDER_PAGE_SIZE = 12;

function selectArchivedAgentsForRender(
  agents: ReadonlyArray<OrchestrationSubagentSummary>,
  renderLimit: number,
  selectedSubagentId: SubagentId | null,
): ReadonlyArray<OrchestrationSubagentSummary> {
  const limited = agents.slice(0, Math.max(0, renderLimit));
  if (selectedSubagentId === null || limited.some((agent) => agent.id === selectedSubagentId)) {
    return limited;
  }
  const selected = agents.find((agent) => agent.id === selectedSubagentId);
  return selected ? [selected, ...limited] : limited;
}

export const ChatAgentStack = memo(function ChatAgentStack({
  subagents,
  providersBySubagent,
  hasActiveAgents,
  selectedSubagentId,
  onSelectSubagent,
}: ChatAgentStackProps) {
  const translate = useInterfaceTranslator().message;
  const lifecycle = useSubagentLifecycleStack(subagents);
  const contentId = useId();
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const expanded = !hasActiveAgents || agentsExpanded;
  const heading = translate(hasActiveAgents ? "chat.agent.heading" : "chat.agent.history");
  const archivedAgents = hasActiveAgents
    ? lifecycle.archived
    : subagents.toSorted(compareArchivedAgents);

  if (subagents.length === 0) return null;

  return (
    <section
      aria-label={heading}
      className={cn(
        "absolute start-3 top-3 z-30 flex max-h-[min(16rem,40%)] max-w-[min(15rem,45%)] flex-col overflow-hidden rounded-xl border border-border/65 bg-popover p-1 shadow-md/10 supports-backdrop-filter:bg-popover/90 backdrop-blur-xs sm:start-5 sm:top-5",
        expanded ? "w-[min(15rem,45%)]" : "w-fit",
      )}
    >
      {hasActiveAgents ? (
        <ThreadLineageGroupToggle
          label={heading}
          count={subagents.length}
          controls={contentId}
          expanded={agentsExpanded}
          onToggle={() => setAgentsExpanded(!agentsExpanded)}
        />
      ) : null}
      <div
        id={contentId}
        hidden={!expanded}
        className="@container/agent-stack min-h-0 overflow-y-auto overscroll-contain"
      >
        {hasActiveAgents ? (
          <ul className="m-0 list-none p-0" aria-label={translate("chat.agent.activeRecentAria")}>
            {lifecycle.visible.map((entry) => (
              <PresenceAgentItem
                key={entry.agent.id}
                entry={entry}
                provider={providersBySubagent.get(entry.agent.id)}
                selected={entry.agent.id === selectedSubagentId}
                onSelectSubagent={onSelectSubagent}
                onCompletePhase={lifecycle.completePhase}
              />
            ))}
          </ul>
        ) : null}
        <ArchivedAgentSection
          agents={archivedAgents}
          providersBySubagent={providersBySubagent}
          separated={hasActiveAgents}
          selectedSubagentId={selectedSubagentId}
          onSelectSubagent={onSelectSubagent}
        />
      </div>
    </section>
  );
});

function PresenceAgentItem({
  entry,
  provider,
  selected,
  onSelectSubagent,
  onCompletePhase,
}: {
  readonly entry: SubagentPresenceEntry;
  readonly provider: ServerProvider | undefined;
  readonly selected: boolean;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
  readonly onCompletePhase: (subagentId: SubagentId, phase: SubagentPresenceEntry["phase"]) => void;
}) {
  const completeCollapsingPhase = (event: ReactAnimationEvent<HTMLLIElement>) => {
    if (event.currentTarget !== event.target || entry.phase !== "collapsing") {
      return;
    }
    onCompletePhase(entry.agent.id, "collapsing");
  };

  const completeRowPhase = (event: ReactAnimationEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) {
      return;
    }
    if (entry.phase === "entering" || entry.phase === "exiting") {
      onCompletePhase(entry.agent.id, entry.phase);
    }
  };

  return (
    <li
      className="subagent-stack-slot"
      data-subagent-presence={entry.phase}
      onAnimationEnd={completeCollapsingPhase}
    >
      <ChatAgentRow
        agent={entry.agent}
        provider={provider}
        selected={selected}
        presence={entry.phase}
        onSelectSubagent={onSelectSubagent}
        onAnimationEnd={completeRowPhase}
      />
    </li>
  );
}

function ChatAgentRow({
  agent,
  provider,
  selected,
  presence,
  onSelectSubagent,
  onAnimationEnd,
}: {
  readonly agent: OrchestrationSubagentSummary;
  readonly provider: ServerProvider | undefined;
  readonly selected: boolean;
  readonly presence?: SubagentPresenceEntry["phase"];
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
  readonly onAnimationEnd?: (event: ReactAnimationEvent<HTMLDivElement>) => void;
}) {
  const name = resolveSubagentDisplayName(agent);
  const displayName = formatSubagentDisplayTitle(name);
  const status = resolveSubagentStatusPresentation(agent);
  const statusLabel =
    agent.status === "unavailable" ? status.label : threadRelationshipStatusLabel(agent.status);
  const tooltip = [
    status.label,
    status.activity !== status.label ? status.activity : null,
    status.detail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="subagent-stack-row rounded-lg data-selected:bg-accent"
      data-selected={selected ? "" : undefined}
      data-subagent-presence={presence}
      onAnimationEnd={onAnimationEnd}
    >
      <Tooltip>
        <TooltipTrigger
          delay={200}
          render={
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              aria-label={`${name}, ${status.label}: ${status.activity}`}
              aria-pressed={selected}
              data-subagent-id={agent.id}
              onClick={() => onSelectSubagent(agent.id)}
            />
          }
        >
          <ThreadRelationshipIcon
            driver={agent.providerDriver ?? undefined}
            provider={provider}
            status={agent.status === "starting" ? "pending" : agent.status}
          />
          <span className="min-w-0 flex-1 truncate text-sm leading-4 font-medium text-foreground/85">
            {displayName}
          </span>
          <span
            aria-hidden
            className={cn(
              "hidden shrink-0 text-2xs @min-[12rem]/agent-stack:inline",
              status.tone === "danger" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {statusLabel}
          </span>
        </TooltipTrigger>
        <ThreadHoverCardPopup side="right">
          <span className="block break-words font-medium">{name}</span>
          <span className="block text-muted-foreground">{tooltip}</span>
        </ThreadHoverCardPopup>
      </Tooltip>
    </div>
  );
}

function ArchivedAgentSection({
  agents,
  providersBySubagent,
  separated,
  selectedSubagentId,
  onSelectSubagent,
}: {
  readonly agents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly providersBySubagent: ReadonlyMap<SubagentId, ServerProvider>;
  readonly separated: boolean;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const historyId = useId();
  const timelineElement = useChatCanvas()?.timelineElement;
  const selectedAgentIsArchived = agents.some((agent) => agent.id === selectedSubagentId);
  const [open, setOpen] = useState(false);
  const [renderLimit, setRenderLimit] = useState(ARCHIVED_AGENT_RENDER_PAGE_SIZE);
  const archiveBoundaryKey = `${agents.length}:${agents[0]?.id ?? ""}:${agents.at(-1)?.id ?? ""}`;
  const renderedAgents = selectArchivedAgentsForRender(agents, renderLimit, selectedSubagentId);
  const remainingAgentCount = Math.max(0, agents.length - renderLimit);

  const [observedArchivedSelection, setObservedArchivedSelection] =
    useState(selectedAgentIsArchived);
  if (observedArchivedSelection !== selectedAgentIsArchived) {
    setObservedArchivedSelection(selectedAgentIsArchived);
    if (selectedAgentIsArchived) setOpen(true);
  }
  const [observedBoundary, setObservedBoundary] = useState(archiveBoundaryKey);
  if (observedBoundary !== archiveBoundaryKey) {
    setObservedBoundary(archiveBoundaryKey);
    setRenderLimit(ARCHIVED_AGENT_RENDER_PAGE_SIZE);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for scrolling in the timeline while History is open
  useEffect(() => {
    if (!open || !timelineElement) return;
    const collapseHistory = () => setOpen(false);
    timelineElement.addEventListener("scroll", collapseHistory, { passive: true });
    return () => timelineElement.removeEventListener("scroll", collapseHistory);
  }, [open, timelineElement]);

  if (agents.length === 0) {
    return null;
  }

  return (
    <div className={separated ? "border-t border-border/65" : undefined}>
      <ThreadLineageGroupToggle
        label={translate("chat.agent.history")}
        icon={ArchiveIcon}
        count={agents.length}
        controls={historyId}
        expanded={open}
        onToggle={() => setOpen(!open)}
      />
      <div id={historyId} hidden={!open}>
        {open ? (
          <>
            <ul className="m-0 list-none p-0" aria-label={translate("chat.agent.archivedAria")}>
              {renderedAgents.map((agent) => (
                <li key={agent.id}>
                  <ChatAgentRow
                    agent={agent}
                    provider={providersBySubagent.get(agent.id)}
                    selected={agent.id === selectedSubagentId}
                    onSelectSubagent={onSelectSubagent}
                  />
                </li>
              ))}
            </ul>
            {remainingAgentCount > 0 ? (
              <ThreadDetailsControl
                tone="muted"
                onClick={() =>
                  setRenderLimit((current) => current + ARCHIVED_AGENT_RENDER_PAGE_SIZE)
                }
              >
                <PlusIcon aria-hidden className="size-4" />
                {translate("chat.agent.showMore", {
                  count: Math.min(ARCHIVED_AGENT_RENDER_PAGE_SIZE, remainingAgentCount),
                })}
              </ThreadDetailsControl>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
