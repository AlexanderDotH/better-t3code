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

export function McpWorkspaceCard(props: McpWorkspaceCardProps) {
  const translate = useInterfaceTranslator().message;
  const live = props.summary.state === "live";
  return (
    <article
      className={cn("mcp-workspace-card", !props.expanded && "h-full")}
      data-expanded={props.expanded ? "true" : undefined}
      data-mcp-workspace-card="true"
      data-mcp-workspace-state={props.summary.state}
      data-workspace-card-compact-surface="true"
      aria-label={
        props.expanded
          ? translate("settings.mcp.workspace.title")
          : translate("settings.mcp.workspace.overview")
      }
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
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  ref={props.expandButtonRef}
                  type="button"
                  className="mcp-workspace-card__expand"
                  aria-label={translate("settings.mcp.workspace.expand")}
                  disabled={props.expansionBlocked}
                  onClick={props.onExpand}
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
                  connected: props.summary.connectedCount,
                  expected: props.summary.expectedCount,
                })
              : props.summary.statusLabel}
          </strong>
          <span>{live ? props.summary.statusLabel : props.summary.freshnessLabel}</span>
        </section>

        <footer className="mcp-workspace-card__metrics">
          <span>
            {translate("settings.mcp.workspace.configuredServerCount", {
              count: props.summary.configuredCount,
            })}
          </span>
          <span>
            {props.summary.attentionCount > 0
              ? translate("settings.mcp.workspace.needsAttention", {
                  count: props.summary.attentionCount,
                })
              : translate("settings.mcp.workspace.noIssues")}
          </span>
          <span>
            {props.summary.toolCount === null
              ? translate("settings.mcp.workspace.toolsUnknown")
              : translate("settings.mcp.workspace.knownToolCount", {
                  count: props.summary.toolCount,
                })}
          </span>
        </footer>
      </div>
      {props.expanded ? props.workbench : null}
    </article>
  );
}
