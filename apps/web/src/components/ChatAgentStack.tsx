import type { SubagentId } from "@t3tools/contracts";
import type { OrchestrationSubagentSummary } from "@t3tools/contracts/legacy";
import { ArchiveIcon, BotIcon, ChevronRightIcon } from "lucide-react";
import { memo, useId, useState, type AnimationEvent as ReactAnimationEvent, type Ref } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "../hooks/useInterfaceTranslator";

import {
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
} from "./subagents/subagentPresentation";
import { SubagentStatusDot, type SubagentIndicatorTone } from "./subagents/SubagentStatusDot";
import {
  useSubagentLifecycleStack,
  type SubagentPresenceEntry,
} from "./subagents/useSubagentLifecycleStack";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export interface ChatAgentStackProps {
  readonly subagents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
  readonly className?: string;
  readonly stackRef?: Ref<HTMLDivElement>;
}

const ARCHIVED_AGENT_RENDER_PAGE_SIZE = 50;

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

function indicatorToneForPresence(entry: SubagentPresenceEntry): SubagentIndicatorTone {
  if (entry.stage === "working") {
    return "working";
  }
  if (entry.stage === "success") {
    return "success";
  }
  if (entry.stage === "failure") {
    return "failure";
  }
  return "stale";
}

export const ChatAgentStack = memo(function ChatAgentStack({
  subagents,
  selectedSubagentId,
  onSelectSubagent,
  className,
  stackRef,
}: ChatAgentStackProps) {
  const translate = useInterfaceTranslator().message;
  const lifecycle = useSubagentLifecycleStack(subagents);
  const compactContentId = useId();
  const [compactOpen, setCompactOpen] = useState(false);
  const hasSubagents = subagents.length > 0;
  const selectSubagent = (subagentId: SubagentId) => {
    setCompactOpen(false);
    onSelectSubagent(subagentId);
  };

  return (
    <div
      ref={stackRef}
      data-chat-agent-stack="true"
      data-compact-open={compactOpen && hasSubagents ? "true" : "false"}
      data-has-subagents={hasSubagents ? "true" : "false"}
      className={cn("pointer-events-none w-56 max-w-[calc(100dvw-1.5rem)]", className)}
    >
      <button
        type="button"
        data-subagent-compact-trigger
        aria-label={translate("chat.agent.count", { count: subagents.length })}
        aria-expanded={compactOpen}
        aria-controls={compactContentId}
        className="subagent-stack-compact-trigger pointer-events-auto h-7 w-fit items-center gap-2 rounded-md border border-border/60 bg-background px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setCompactOpen((current) => !current)}
      >
        <BotIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{translate("chat.agent.heading")}</span>
        <span className="tabular-nums">{subagents.length}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn("size-3 transition-transform duration-200", compactOpen && "rotate-90")}
        />
      </button>
      <div
        id={compactContentId}
        className="subagent-stack-content pointer-events-auto mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-background [[data-agent-layout=expanded]_&]:mt-0"
      >
        <ScrollArea
          className="h-auto max-h-[min(20rem,calc(100dvh-6rem))] w-full"
          hideScrollbars
          scrollFade
        >
          <div className="flex w-full flex-col items-start">
            {lifecycle.visible.length > 0 ? (
              <div className="flex h-8 w-full items-center gap-2 px-2.5 text-xs text-muted-foreground">
                <BotIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="flex-1 font-medium">{translate("chat.agent.heading")}</span>
                <span className="font-mono text-2xs tabular-nums">{lifecycle.visible.length}</span>
              </div>
            ) : null}
            <ul
              className="w-full px-1"
              role="list"
              aria-label={translate("chat.agent.activeRecentAria")}
            >
              {lifecycle.visible.map((entry) => (
                <PresenceAgentItem
                  key={entry.agent.id}
                  entry={entry}
                  selected={entry.agent.id === selectedSubagentId}
                  onSelectSubagent={selectSubagent}
                  onCompletePhase={lifecycle.completePhase}
                />
              ))}
            </ul>
            <ArchivedAgentSection
              agents={lifecycle.archived}
              separated={lifecycle.visible.length > 0}
              selectedSubagentId={selectedSubagentId}
              onSelectSubagent={selectSubagent}
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
});

function PresenceAgentItem({
  entry,
  selected,
  onSelectSubagent,
  onCompletePhase,
}: {
  readonly entry: SubagentPresenceEntry;
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

  const completeRowPhase = (event: ReactAnimationEvent<HTMLButtonElement>) => {
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
        tone={indicatorToneForPresence(entry)}
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
  tone,
  selected,
  presence,
  onSelectSubagent,
  onAnimationEnd,
}: {
  readonly agent: OrchestrationSubagentSummary;
  readonly tone: SubagentIndicatorTone;
  readonly selected: boolean;
  readonly presence?: SubagentPresenceEntry["phase"];
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
  readonly onAnimationEnd?: (event: ReactAnimationEvent<HTMLButtonElement>) => void;
}) {
  const name = resolveSubagentDisplayName(agent);
  const displayName = name.startsWith("/root/") ? name.slice("/root/".length) : name;
  const status = resolveSubagentStatusPresentation(agent);
  const tooltip = [
    status.label,
    status.activity !== status.label ? status.activity : null,
    status.detail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${name}, ${status.label}: ${status.activity}`}
            aria-pressed={selected}
            data-subagent-id={agent.id}
            data-subagent-tone={tone}
            data-subagent-presence={presence}
            className={cn(
              "subagent-stack-row group flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-colors",
              "hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              tone === "archived" || tone === "stale" ? "text-muted-foreground" : "text-foreground",
              selected && "bg-accent text-foreground",
            )}
            onAnimationEnd={onAnimationEnd}
            onClick={() => onSelectSubagent(agent.id)}
          />
        }
      >
        <SubagentStatusDot presentation={status} tone={tone} className="size-1.5 shadow-none" />
        <span className="min-w-0 flex-1 truncate">{displayName}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            selected && "opacity-100",
          )}
        />
      </TooltipTrigger>
      <TooltipPopup side="right">
        <div className="max-w-72">
          <p className="break-words font-medium">{name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tooltip}</p>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

function ArchivedAgentSection({
  agents,
  separated,
  selectedSubagentId,
  onSelectSubagent,
}: {
  readonly agents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly separated: boolean;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
}) {
  const translate = useInterfaceTranslator().message;
  const selectedAgentIsArchived = agents.some((agent) => agent.id === selectedSubagentId);
  const [open, setOpen] = useState(selectedAgentIsArchived);
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

  if (agents.length === 0) {
    return null;
  }

  const archivedLabel = translate("chat.agent.archivedCount", { count: agents.length });
  return (
    <div className={cn("w-full", separated && "border-t border-border/50")}>
      <Collapsible open={open} onOpenChange={setOpen} className="w-full">
        <CollapsibleTrigger
          type="button"
          aria-label={archivedLabel}
          className="group flex h-8 w-full items-center gap-2 px-2.5 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ArchiveIcon aria-hidden="true" className="size-3.5" />
          <span className="min-w-0 flex-1 font-medium">{translate("chat.agent.history")}</span>
          <span className="font-mono text-2xs tabular-nums">{agents.length}</span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3 transition-transform duration-200 group-data-panel-open:rotate-90"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel className="w-full">
          <div className="px-1 pb-1">
            <ul className="w-full" role="list" aria-label={translate("chat.agent.archivedAria")}>
              {renderedAgents.map((agent) => (
                <li key={agent.id} className="mb-1 h-7">
                  <ChatAgentRow
                    agent={agent}
                    tone="archived"
                    selected={agent.id === selectedSubagentId}
                    onSelectSubagent={onSelectSubagent}
                  />
                </li>
              ))}
            </ul>
            {remainingAgentCount > 0 ? (
              <button
                type="button"
                className="mt-1 h-7 w-full rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() =>
                  setRenderLimit((current) => current + ARCHIVED_AGENT_RENDER_PAGE_SIZE)
                }
              >
                {translate("chat.agent.showMore", {
                  count: Math.min(ARCHIVED_AGENT_RENDER_PAGE_SIZE, remainingAgentCount),
                })}
              </button>
            ) : null}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
