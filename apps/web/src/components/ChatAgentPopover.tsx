import type { OrchestrationSubagentSummary, SubagentId } from "@t3tools/contracts";
import { BotIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";

import {
  groupSubagents,
  resolveSubagentDisplayName,
  resolveSubagentStatusPresentation,
} from "./subagents/subagentPresentation";
import { SubagentStatusDot } from "./subagents/SubagentStatusDot";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";

export interface ChatAgentPopoverProps {
  readonly subagents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
  readonly className?: string;
}

export const ChatAgentPopover = memo(function ChatAgentPopover({
  subagents,
  selectedSubagentId,
  onSelectSubagent,
  className,
}: ChatAgentPopoverProps) {
  const groups = useMemo(() => groupSubagents(subagents), [subagents]);
  const [open, setOpen] = useState(false);
  const activeCount = groups.active.length;

  const selectSubagent = (subagentId: SubagentId) => {
    setOpen(false);
    onSelectSubagent(subagentId);
  };

  return (
    <div data-chat-agent-floating="true" className={cn("pointer-events-auto", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Show agents (${activeCount} active, ${subagents.length} total)`}
              className={cn(
                "group flex h-7 items-center gap-1.5 rounded-full border border-border/65 bg-background/88 px-2.5 text-xs font-medium text-foreground shadow-md/8 outline-none backdrop-blur-xl transition-[background-color,border-color,box-shadow]",
                "hover:border-border hover:bg-background/96 hover:shadow-md/12 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              )}
            />
          }
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full bg-muted-foreground/45",
              activeCount > 0 &&
                "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_14%,transparent)]",
            )}
          />
          <BotIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span>Agents</span>
          <span className="min-w-4 tabular-nums text-muted-foreground">{subagents.length}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3 text-muted-foreground/70 transition-transform group-data-popup-open:rotate-180"
          />
        </PopoverTrigger>

        <PopoverPopup
          side="bottom"
          align="start"
          sideOffset={7}
          className="w-[min(18rem,calc(100vw-1.5rem))] border-border/70 bg-popover/92 p-0 shadow-xl/10 backdrop-blur-xl [--popup-width:min(18rem,calc(100vw-1.5rem))] [--viewport-inline-padding:0]"
          viewportClassName="p-0 !overflow-hidden"
        >
          <ChatAgentPopoverContent
            subagents={subagents}
            selectedSubagentId={selectedSubagentId}
            onSelectSubagent={selectSubagent}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
});

export interface ChatAgentPopoverContentProps {
  readonly subagents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
  readonly defaultFinishedOpen?: boolean;
  readonly className?: string;
}

export const ChatAgentPopoverContent = memo(function ChatAgentPopoverContent({
  subagents,
  selectedSubagentId,
  onSelectSubagent,
  defaultFinishedOpen = false,
  className,
}: ChatAgentPopoverContentProps) {
  const groups = useMemo(() => groupSubagents(subagents), [subagents]);
  const selectedAgentIsFinished = groups.finished.some((agent) => agent.id === selectedSubagentId);
  const [finishedOpen, setFinishedOpen] = useState(
    () => defaultFinishedOpen || selectedAgentIsFinished,
  );

  useEffect(() => {
    if (selectedAgentIsFinished) {
      setFinishedOpen(true);
    }
  }, [selectedAgentIsFinished]);

  return (
    <section
      aria-label="Subagents"
      className={cn("flex min-h-0 flex-col overflow-hidden", className)}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/55 px-3">
        <BotIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">Agents</h2>
        {groups.active.length > 0 ? (
          <span className="text-[10px] font-medium tabular-nums text-success-foreground">
            {groups.active.length} active
          </span>
        ) : null}
        <Badge variant="secondary" size="sm" aria-label={`${subagents.length} agents`}>
          {subagents.length}
        </Badge>
      </div>

      <ScrollArea className="h-auto max-h-[min(26rem,calc(100vh-10rem))] min-h-0" scrollFade>
        <div className="space-y-2.5 p-2">
          <AgentSection
            label="Active"
            agents={groups.active}
            selectedSubagentId={selectedSubagentId}
            onSelectSubagent={onSelectSubagent}
            emptyLabel="No active agents"
          />

          {groups.finished.length > 0 ? (
            <Collapsible open={finishedOpen} onOpenChange={setFinishedOpen}>
              <CollapsibleTrigger
                type="button"
                className="group flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/65 outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-panel-open:[&_svg]:rotate-90"
              >
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3 shrink-0 transition-transform"
                />
                <span className="min-w-0 flex-1 truncate">Finished</span>
                <span
                  className="tabular-nums"
                  aria-label={`${groups.finished.length} finished agents`}
                >
                  {groups.finished.length}
                </span>
              </CollapsibleTrigger>
              <CollapsiblePanel className="mt-1">
                <AgentList
                  agents={groups.finished}
                  selectedSubagentId={selectedSubagentId}
                  onSelectSubagent={onSelectSubagent}
                />
              </CollapsiblePanel>
            </Collapsible>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
});

function AgentSection({
  label,
  agents,
  selectedSubagentId,
  onSelectSubagent,
  emptyLabel,
}: {
  readonly label: string;
  readonly agents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
  readonly emptyLabel: string;
}) {
  return (
    <section aria-label={`${label} agents`}>
      <div className="flex h-7 items-center gap-1.5 px-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/65">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span
          className="tabular-nums"
          aria-label={`${agents.length} ${label.toLowerCase()} agents`}
        >
          {agents.length}
        </span>
      </div>
      {agents.length > 0 ? (
        <AgentList
          agents={agents}
          selectedSubagentId={selectedSubagentId}
          onSelectSubagent={onSelectSubagent}
        />
      ) : (
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground/55">{emptyLabel}</p>
      )}
    </section>
  );
}

function AgentList({
  agents,
  selectedSubagentId,
  onSelectSubagent,
}: {
  readonly agents: ReadonlyArray<OrchestrationSubagentSummary>;
  readonly selectedSubagentId: SubagentId | null;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
}) {
  return (
    <ul className="space-y-0.5" role="list">
      {agents.map((agent) => (
        <li key={agent.id} style={{ paddingInlineStart: `${Math.min(agent.depth, 3) * 8}px` }}>
          <AgentRow
            agent={agent}
            selected={agent.id === selectedSubagentId}
            onSelectSubagent={onSelectSubagent}
          />
        </li>
      ))}
    </ul>
  );
}

function AgentRow({
  agent,
  selected,
  onSelectSubagent,
}: {
  readonly agent: OrchestrationSubagentSummary;
  readonly selected: boolean;
  readonly onSelectSubagent: (subagentId: SubagentId) => void;
}) {
  const name = resolveSubagentDisplayName(agent);
  const status = resolveSubagentStatusPresentation(agent);

  return (
    <button
      type="button"
      aria-label={`${name}, ${status.label}: ${status.activity}`}
      aria-pressed={selected}
      data-subagent-id={agent.id}
      className={cn(
        "group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left outline-none transition-colors",
        "hover:bg-accent/65 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-accent text-accent-foreground shadow-xs",
      )}
      onClick={() => onSelectSubagent(agent.id)}
    >
      <SubagentStatusDot presentation={status} className="mt-1" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {name}
          </span>
          <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/65">
            {status.label}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
          {status.activity}
        </span>
      </span>
    </button>
  );
}
