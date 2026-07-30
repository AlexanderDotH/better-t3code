import type { OrchestrationSubagentSummary, SubagentId } from "@t3tools/contracts";
import { ArchiveIcon, BotIcon, ChevronRightIcon } from "lucide-react";
import { memo, useEffect, useState, type AnimationEvent as ReactAnimationEvent } from "react";

import { cn } from "~/lib/utils";

import {
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
} from "./subagents/subagentPresentation";
import {
  SubagentStatusDot,
  subagentIndicatorIconClassName,
  type SubagentIndicatorTone,
} from "./subagents/SubagentStatusDot";
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
}: ChatAgentStackProps) {
  const lifecycle = useSubagentLifecycleStack(subagents);

  return (
    <div
      data-chat-agent-stack="true"
      className={cn("pointer-events-none w-52 max-w-[calc(100dvw-1.5rem)]", className)}
    >
      <ScrollArea
        className="h-auto max-h-[min(20rem,calc(100dvh-6rem))] w-full"
        hideScrollbars
        scrollFade
      >
        <div className="flex w-full flex-col items-start py-0.5">
          <ul className="w-full" role="list" aria-label="Active and recent agents">
            {lifecycle.visible.map((entry) => (
              <PresenceAgentItem
                key={entry.agent.id}
                entry={entry}
                selected={entry.agent.id === selectedSubagentId}
                onSelectSubagent={onSelectSubagent}
                onCompletePhase={lifecycle.completePhase}
              />
            ))}
          </ul>
          <ArchivedAgentSection
            agents={lifecycle.archived}
            selectedSubagentId={selectedSubagentId}
            onSelectSubagent={onSelectSubagent}
          />
        </div>
      </ScrollArea>
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

  const completePillPhase = (event: ReactAnimationEvent<HTMLButtonElement>) => {
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
      style={{ paddingInlineStart: `${Math.min(entry.agent.depth, 3) * 6}px` }}
      onAnimationEnd={completeCollapsingPhase}
    >
      <ChatAgentPill
        agent={entry.agent}
        tone={indicatorToneForPresence(entry)}
        selected={selected}
        presence={entry.phase}
        onSelectSubagent={onSelectSubagent}
        onAnimationEnd={completePillPhase}
      />
    </li>
  );
}

function ChatAgentPill({
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
  const status = resolveSubagentStatusPresentation(agent);
  const tooltip = status.detail
    ? `${status.label} · ${status.activity} · ${status.detail}`
    : `${status.label} · ${status.activity}`;

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
              "subagent-stack-pill group pointer-events-auto flex h-7 w-fit max-w-52 items-center gap-1.5 rounded-full border border-border/65 bg-background/88 px-2.5 text-xs font-medium text-foreground shadow-md/8 outline-none backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-200",
              "hover:border-border hover:bg-background/96 hover:shadow-md/12 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              selected && "border-ring/45 bg-accent/90 shadow-md/12",
            )}
            onAnimationEnd={onAnimationEnd}
            onClick={() => onSelectSubagent(agent.id)}
          />
        }
      >
        <SubagentStatusDot presentation={status} tone={tone} className="size-1.5" />
        <BotIcon
          aria-hidden="true"
          data-subagent-tone-target={tone}
          className={cn(
            "size-3.5 shrink-0 transition-colors duration-300 ease-out",
            subagentIndicatorIconClassName(tone),
          )}
        />
        <span className="min-w-0 truncate">{name}</span>
      </TooltipTrigger>
      <TooltipPopup side="right">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function ArchivedAgentSection({
  agents,
  selectedSubagentId,
  onSelectSubagent,
}: {
  readonly agents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
}) {
  const selectedAgentIsArchived = agents.some((agent) => agent.id === selectedSubagentId);
  const [open, setOpen] = useState(selectedAgentIsArchived);

  useEffect(() => {
    if (selectedAgentIsArchived) {
      setOpen(true);
    }
  }, [selectedAgentIsArchived]);

  if (agents.length === 0) {
    return null;
  }

  const archivedLabel = `${agents.length} archived ${agents.length === 1 ? "agent" : "agents"}`;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger
        type="button"
        aria-label={archivedLabel}
        className="pointer-events-auto group flex h-7 w-fit max-w-52 items-center gap-1.5 rounded-full border border-border/55 bg-background/78 px-2.5 text-xs font-medium text-muted-foreground/70 shadow-sm/5 outline-none backdrop-blur-xl transition-[background-color,border-color,color] hover:border-border/80 hover:bg-background/92 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArchiveIcon aria-hidden="true" className="size-3.5" />
        <span>History</span>
        <span className="tabular-nums">{agents.length}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3 transition-transform duration-200 group-data-panel-open:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="mt-1 w-full transition-[height,opacity] data-starting-style:opacity-0 data-ending-style:opacity-0">
        <ul className="w-full" role="list" aria-label="Archived agents">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="mb-1 h-7"
              style={{ paddingInlineStart: `${Math.min(agent.depth, 3) * 6}px` }}
            >
              <ChatAgentPill
                agent={agent}
                tone="archived"
                selected={agent.id === selectedSubagentId}
                onSelectSubagent={onSelectSubagent}
              />
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
