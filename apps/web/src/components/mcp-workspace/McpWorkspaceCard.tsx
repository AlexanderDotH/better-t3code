import type { ProviderDriverKind } from "@t3tools/contracts";
import { ArrowUpIcon, ServerIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { cn } from "~/lib/utils";

import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import type { McpWorkspaceSummary } from "./mcpWorkspace.logic";

import "./McpWorkspaceCard.css";

export interface McpWorkspaceCardProps {
  readonly providerDisplayName: string;
  readonly providerDriver: ProviderDriverKind | null;
  readonly providerAccentColor?: string;
  readonly summary: McpWorkspaceSummary;
  readonly expanded?: boolean;
  readonly expansionBlocked?: boolean;
  readonly expandButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly workbench?: ReactNode;
  readonly onExpand: () => void;
}

function countLabel(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function McpWorkspaceCard(props: McpWorkspaceCardProps) {
  const live = props.summary.state === "live";
  return (
    <article
      className={cn("mcp-workspace-card", !props.expanded && "h-full")}
      data-expanded={props.expanded ? "true" : undefined}
      data-mcp-workspace-card="true"
      data-mcp-workspace-state={props.summary.state}
      data-workspace-card-compact-surface="true"
      aria-label={props.expanded ? "MCP workspace" : "MCP overview"}
    >
      <div
        className="workspace-card-deck__card-content mcp-workspace-card__content"
        data-workspace-card-compact-content="true"
        hidden={props.expanded}
      >
        <header className="mcp-workspace-card__header">
          <div className="mcp-workspace-card__provider">
            {props.providerDriver ? (
              <ProviderInstanceIcon
                accentColor={props.providerAccentColor}
                displayName={props.providerDisplayName}
                driverKind={props.providerDriver}
                className="size-5"
                iconClassName="size-4"
                showBadge
              />
            ) : (
              <ServerIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <strong className="block truncate font-medium text-sm">
                {props.providerDisplayName}
              </strong>
              <span className="block truncate text-muted-foreground text-[11px]">
                {props.summary.freshnessLabel}
              </span>
            </div>
          </div>
          <button
            ref={props.expandButtonRef}
            type="button"
            className="mcp-workspace-card__expand"
            aria-label="Expand MCP workspace"
            title="Expand MCP workspace"
            disabled={props.expansionBlocked}
            onClick={props.onExpand}
          >
            <ArrowUpIcon aria-hidden />
          </button>
        </header>

        <section className="mcp-workspace-card__status" aria-label="MCP server status">
          <strong>
            {live
              ? `${props.summary.connectedCount} / ${props.summary.expectedCount} connected`
              : props.summary.statusLabel}
          </strong>
          <span>{live ? props.summary.statusLabel : props.summary.freshnessLabel}</span>
        </section>

        <footer className="mcp-workspace-card__metrics">
          <span>
            {countLabel(props.summary.configuredCount, "configured server", "configured servers")}
          </span>
          <span>
            {props.summary.attentionCount > 0
              ? `${props.summary.attentionCount} needs attention`
              : "No known issues"}
          </span>
          <span>
            {props.summary.toolCount === null
              ? "Tools unknown"
              : countLabel(props.summary.toolCount, "known tool", "known tools")}
          </span>
        </footer>
      </div>
      {props.expanded ? props.workbench : null}
    </article>
  );
}
