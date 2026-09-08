import type { ProviderDriverKind } from "@t3tools/contracts";
import { ArrowUpIcon, ServerIcon } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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

export function McpWorkspaceCard({
  expandButtonRef,
  expanded,
  expansionBlocked,
  onExpand,
  providerAccentColor,
  providerDisplayName,
  providerDriver,
  summary,
  workbench,
}: McpWorkspaceCardProps) {
  const translate = useInterfaceTranslator().message;
  const live = summary.state === "live";
  return (
    <article
      className={cn("mcp-workspace-card", !expanded && "h-full")}
      data-expanded={expanded ? "true" : undefined}
      data-mcp-workspace-card="true"
      data-mcp-workspace-state={summary.state}
      data-workspace-card-compact-surface="true"
      aria-label={
        expanded
          ? translate("settings.mcp.workspace.title")
          : translate("settings.mcp.workspace.overview")
      }
    >
      <div
        className="workspace-card-deck__card-content mcp-workspace-card__content"
        data-workspace-card-compact-content="true"
        hidden={expanded}
      >
        <header className="mcp-workspace-card__header">
          <div className="mcp-workspace-card__provider">
            {providerDriver ? (
              <ProviderInstanceIcon
                accentColor={providerAccentColor}
                displayName={providerDisplayName}
                driverKind={providerDriver}
                className="size-5"
                iconClassName="size-4"
                showBadge
              />
            ) : (
              <ServerIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <strong className="block truncate font-medium text-sm">{providerDisplayName}</strong>
              <span className="block truncate text-muted-foreground text-[11px]">
                {summary.freshnessLabel}
              </span>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  ref={expandButtonRef}
                  type="button"
                  className="mcp-workspace-card__expand"
                  aria-label={translate("settings.mcp.workspace.expand")}
                  disabled={expansionBlocked}
                  onClick={onExpand}
                />
              }
            >
              <ArrowUpIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup side="top">{translate("settings.mcp.workspace.expand")}</TooltipPopup>
          </Tooltip>
        </header>

        <section
          className="mcp-workspace-card__status"
          aria-label={translate("settings.mcp.workspace.serverStatus")}
        >
          <strong>
            {live
              ? translate("settings.mcp.workspace.connected", {
                  connected: summary.connectedCount,
                  expected: summary.expectedCount,
                })
              : summary.statusLabel}
          </strong>
          <span>{live ? summary.statusLabel : summary.freshnessLabel}</span>
        </section>

        <footer className="mcp-workspace-card__metrics">
          <span>
            {translate("settings.mcp.workspace.configuredServerCount", {
              count: summary.configuredCount,
            })}
          </span>
          <span>
            {summary.attentionCount > 0
              ? translate("settings.mcp.workspace.needsAttention", {
                  count: summary.attentionCount,
                })
              : translate("settings.mcp.workspace.noIssues")}
          </span>
          <span>
            {summary.toolCount === null
              ? translate("settings.mcp.workspace.toolsUnknown")
              : translate("settings.mcp.workspace.knownToolCount", {
                  count: summary.toolCount,
                })}
          </span>
        </footer>
      </div>
      {expanded ? workbench : null}
    </article>
  );
}
