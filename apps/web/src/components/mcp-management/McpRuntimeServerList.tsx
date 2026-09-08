import type {
  McpRuntimeAction,
  McpRuntimeServer,
  McpRuntimeServerDetailsResult,
  McpRuntimeTool,
} from "@t3tools/contracts";
import {
  BracesIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LockKeyholeIcon,
  WrenchIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import { Button } from "../ui/button";
import { McpServerRowControls, type McpRuntimeActionPending } from "./McpServerRowControls";
import { aggregateMcpRuntimeStatus, type McpAggregateTone } from "./mcpRuntimePresentation";

export type { McpRuntimeActionPending } from "./McpServerRowControls";

type McpRuntimeDetailsView = Pick<
  McpRuntimeServerDetailsResult,
  "resources" | "templates" | "tools"
>;

const STATUS_DOT_CLASS: Record<McpAggregateTone, string> = {
  green:
    "bg-emerald-500 shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-emerald-500)_18%,transparent)]",
  orange:
    "bg-amber-500 shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-amber-500)_18%,transparent)]",
  red: "bg-red-500 shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-red-500)_18%,transparent)]",
  gray: "bg-muted-foreground/50",
};

const SERVER_STATE_DOT_CLASS: Record<McpRuntimeServer["state"], string> = {
  "not-started": "bg-muted-foreground/45",
  starting: "bg-amber-500",
  connected: "bg-emerald-500",
  "auth-required": "bg-red-500",
  "setup-required": "bg-red-500",
  failed: "bg-red-500",
  disabled: "bg-muted-foreground/35",
  unsupported: "bg-muted-foreground/35",
  unknown: "bg-muted-foreground/45",
  stale: "bg-amber-500",
};

const SERVER_SOURCE_ORDER: Record<McpRuntimeServer["source"], number> = {
  "t3-managed": 0,
  "provider-native": 1,
  "t3-built-in": 2,
};

export interface McpRuntimeServerListProps {
  readonly providerDisplayName: string;
  readonly authorizationAvailable: boolean;
  readonly readOnly?: boolean;
  readonly servers: ReadonlyArray<McpRuntimeServer>;
  readonly pendingAction: McpRuntimeActionPending | null;
  readonly detailsByProviderKey: Readonly<Record<string, McpRuntimeDetailsView | undefined>>;
  readonly detailsLoadingKeys: ReadonlySet<string>;
  readonly detailsErrorByProviderKey: Readonly<Record<string, string | undefined>>;
  readonly actionErrorByProviderKey: Readonly<Record<string, string | undefined>>;
  readonly onToggleDetails: (server: McpRuntimeServer, expanded: boolean) => void;
  readonly onAction: (server: McpRuntimeServer, action: McpRuntimeAction) => void;
  readonly onOpenSettings: (providerKey?: string) => void;
  readonly emptyMessage?: string;
}

export function McpRuntimeServerList({
  providerDisplayName,
  authorizationAvailable,
  readOnly = false,
  servers,
  pendingAction,
  detailsByProviderKey,
  detailsLoadingKeys,
  detailsErrorByProviderKey,
  actionErrorByProviderKey,
  onToggleDetails,
  onAction,
  onOpenSettings,
  emptyMessage,
}: McpRuntimeServerListProps) {
  const translate = useInterfaceTranslator().message;
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const aggregate = aggregateMcpRuntimeStatus(servers);
  const aggregateLabel =
    aggregate.expectedCount === 0
      ? translate("settings.mcp.runtime.aggregateUnavailable")
      : aggregate.connectedCount === aggregate.expectedCount
        ? translate("settings.mcp.runtime.aggregateAll", { count: aggregate.expectedCount })
        : translate("settings.mcp.runtime.aggregateConnected", {
            connected: aggregate.connectedCount,
            expected: aggregate.expectedCount,
          });
  const orderedServers = useMemo(
    () =>
      [...servers].sort((left, right) => {
        const sourceOrder = SERVER_SOURCE_ORDER[left.source] - SERVER_SOURCE_ORDER[right.source];
        if (sourceOrder !== 0) return sourceOrder;
        return left.name.localeCompare(right.name);
      }),
    [servers],
  );

  const toggleServer = (server: McpRuntimeServer) => {
    const nextExpanded = !expandedKeys.has(server.providerKey);
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (nextExpanded) {
        next.add(server.providerKey);
      } else {
        next.delete(server.providerKey);
      }
      return next;
    });
    onToggleDetails(server, nextExpanded);
  };

  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border/55 px-3.5 py-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-sm">{providerDisplayName}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{aggregateLabel}</div>
        </div>
        <span
          aria-hidden="true"
          className={cn("mt-1.5 size-2 shrink-0 rounded-full", STATUS_DOT_CLASS[aggregate.tone])}
        />
      </div>

      <section aria-label={translate("settings.mcp.runtime.servers")} className="min-h-0">
        {orderedServers.length === 0 ? (
          <div className="px-3.5 py-5 text-center text-muted-foreground text-xs">
            {emptyMessage ?? translate("settings.mcp.runtime.empty")}
          </div>
        ) : (
          <ul
            role="list"
            aria-label={translate("settings.mcp.runtime.status")}
            className="divide-y divide-border/45"
          >
            {orderedServers.map((server, index) => {
              const expanded = expandedKeys.has(server.providerKey);
              const isBuiltIn = server.source === "t3-built-in";
              const details = detailsByProviderKey[server.providerKey];
              return (
                <Fragment key={server.providerKey}>
                  {orderedServers[index - 1]?.source !== server.source ? (
                    <li className="bg-muted/20 px-3.5 py-1.5">
                      <h3 className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                        {translate(
                          server.source === "t3-managed"
                            ? "settings.mcp.runtime.source.t3Managed"
                            : server.source === "provider-native"
                              ? "settings.mcp.runtime.source.providerManaged"
                              : "settings.mcp.runtime.source.system",
                        )}
                      </h3>
                    </li>
                  ) : null}
                  <li key={server.providerKey} className="px-3.5 py-2.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      className="group flex w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggleServer(server)}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          SERVER_STATE_DOT_CLASS[server.state],
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {isBuiltIn ? (
                            <LockKeyholeIcon
                              aria-hidden="true"
                              className="size-3 shrink-0 text-muted-foreground/70"
                            />
                          ) : null}
                          <span className="truncate font-medium text-xs">
                            {isBuiltIn
                              ? translate("settings.mcp.runtime.source.system")
                              : server.name}
                          </span>
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                          <span>{translate(`settings.mcp.runtime.state.${server.state}`)}</span>
                          {server.toolCount !== undefined ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {translate("settings.mcp.runtime.toolCount", {
                                  count: server.toolCount,
                                })}
                              </span>
                            </>
                          ) : null}
                          {server.transport ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="uppercase">{server.transport}</span>
                            </>
                          ) : null}
                          {server.configDrift !== "none" ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{translate("settings.mcp.runtime.appliesNextSession")}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <ChevronDownIcon
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                          expanded && "rotate-180",
                        )}
                      />
                    </button>

                    {!isBuiltIn ? (
                      <div className="mt-2 pl-3.5">
                        <McpServerRowControls
                          serverKey={server.providerKey}
                          serverName={server.name}
                          state={server.state}
                          availableRuntimeActions={server.availableActions}
                          disabledRuntimeActions={authorizationAvailable ? [] : ["authorize"]}
                          pendingAction={pendingAction}
                          readOnly={readOnly}
                          onRuntimeAction={(action) => onAction(server, action)}
                          onEdit={() => onOpenSettings(server.providerKey)}
                        />
                      </div>
                    ) : null}
                    {readOnly && !isBuiltIn && server.availableActions.length > 0 ? (
                      <p className="mt-2 pl-3.5 text-muted-foreground text-[11px]">
                        {translate("settings.mcp.runtime.operateRequired")}
                      </p>
                    ) : null}
                    {!authorizationAvailable &&
                    !isBuiltIn &&
                    server.state === "auth-required" &&
                    server.availableActions.includes("authorize") ? (
                      <p className="mt-2 pl-3.5 text-warning-foreground text-[11px]">
                        {translate("settings.mcp.runtime.authorizeOnHost")}
                      </p>
                    ) : null}

                    {expanded ? (
                      <div className="mt-2.5 rounded-md border border-border/50 bg-muted/25 p-2.5 text-[11px]">
                        {server.serverInfo?.version ||
                        server.resourceCount !== undefined ||
                        server.templateCount !== undefined ? (
                          <div className="mb-2 flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
                            {server.serverInfo?.version ? (
                              <span>
                                {translate("settings.mcp.runtime.version", {
                                  version: server.serverInfo.version,
                                })}
                              </span>
                            ) : null}
                            {server.resourceCount !== undefined ? (
                              <span>
                                {translate("settings.mcp.runtime.resourceCount", {
                                  count: server.resourceCount,
                                })}
                              </span>
                            ) : null}
                            {server.templateCount !== undefined ? (
                              <span>
                                {translate("settings.mcp.runtime.templateCount", {
                                  count: server.templateCount,
                                })}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {detailsLoadingKeys.has(server.providerKey) ? (
                          <div className="text-muted-foreground">
                            {translate("settings.mcp.runtime.loadingInventory")}
                          </div>
                        ) : detailsErrorByProviderKey[server.providerKey] ? (
                          <div className="text-destructive">
                            {detailsErrorByProviderKey[server.providerKey]}
                          </div>
                        ) : details ? (
                          <McpRuntimeInventoryDetails
                            details={details}
                            reportsTools={server.reportsTools}
                            serverName={server.name}
                          />
                        ) : (
                          <div className="text-muted-foreground">
                            {server.reportsTools
                              ? translate("settings.mcp.runtime.noTools")
                              : translate("settings.mcp.runtime.noToolDetails")}
                          </div>
                        )}
                        {server.issue?.message ? (
                          <p className="mt-2 text-destructive">{server.issue.message}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {actionErrorByProviderKey[server.providerKey] ? (
                      <p role="alert" className="mt-2 pl-3.5 text-destructive text-[11px]">
                        {actionErrorByProviderKey[server.providerKey]}
                      </p>
                    ) : null}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}
      </section>

      <div className="border-t border-border/55 p-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs"
          onClick={() => onOpenSettings()}
        >
          <span>{translate("settings.mcp.runtime.manage")}</span>
          <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function McpRuntimeInventoryDetails({
  details,
  reportsTools,
  serverName,
}: {
  readonly details: McpRuntimeDetailsView;
  readonly reportsTools: boolean;
  readonly serverName: string;
}) {
  const translate = useInterfaceTranslator().message;
  const hasInventory =
    details.tools.length > 0 || details.resources.length > 0 || details.templates.length > 0;
  if (!hasInventory) {
    return (
      <div className="text-muted-foreground">
        {reportsTools
          ? translate("settings.mcp.runtime.noInventory")
          : translate("settings.mcp.runtime.noInventoryDetails")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {details.tools.length > 0 ? (
        <InventorySection
          ariaLabel={translate("settings.mcp.runtime.inventoryAria", {
            server: serverName,
            section: translate("settings.mcp.runtime.tools"),
          })}
          overflowCount={Math.max(0, details.tools.length - 100)}
          overflowLabel={translate("settings.mcp.runtime.tools").toLocaleLowerCase()}
          title={translate("settings.mcp.runtime.tools")}
        >
          {details.tools.slice(0, 100).map((tool) => (
            <li key={tool.name} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 font-medium">
                <WrenchIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{tool.title ?? tool.name}</span>
              </div>
              {tool.description ? (
                <p className="mt-0.5 line-clamp-2 text-muted-foreground">{tool.description}</p>
              ) : null}
              <ToolAnnotations tool={tool} />
            </li>
          ))}
        </InventorySection>
      ) : null}

      {details.resources.length > 0 ? (
        <InventorySection
          ariaLabel={translate("settings.mcp.runtime.inventoryAria", {
            server: serverName,
            section: translate("settings.mcp.runtime.resources"),
          })}
          overflowCount={Math.max(0, details.resources.length - 100)}
          overflowLabel={translate("settings.mcp.runtime.resources").toLocaleLowerCase()}
          title={translate("settings.mcp.runtime.resources")}
        >
          {details.resources.slice(0, 100).map((resource) => (
            <li key={resource.uri} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 font-medium">
                <FileTextIcon
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground"
                />
                <span className="truncate">{resource.title ?? resource.name}</span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {resource.uri}
              </p>
              {resource.description ? (
                <p className="mt-0.5 line-clamp-2 text-muted-foreground">{resource.description}</p>
              ) : null}
              {resource.mimeType ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">{resource.mimeType}</p>
              ) : null}
            </li>
          ))}
        </InventorySection>
      ) : null}

      {details.templates.length > 0 ? (
        <InventorySection
          ariaLabel={translate("settings.mcp.runtime.inventoryAria", {
            server: serverName,
            section: translate("settings.mcp.runtime.resourceTemplates"),
          })}
          overflowCount={Math.max(0, details.templates.length - 100)}
          overflowLabel={translate("settings.mcp.runtime.resourceTemplates").toLocaleLowerCase()}
          title={translate("settings.mcp.runtime.resourceTemplates")}
        >
          {details.templates.slice(0, 100).map((template) => (
            <li key={template.uriTemplate} className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5 font-medium">
                <BracesIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{template.title ?? template.name}</span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {template.uriTemplate}
              </p>
              {template.description ? (
                <p className="mt-0.5 line-clamp-2 text-muted-foreground">{template.description}</p>
              ) : null}
              {template.mimeType ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">{template.mimeType}</p>
              ) : null}
            </li>
          ))}
        </InventorySection>
      ) : null}
    </div>
  );
}

function InventorySection({
  ariaLabel,
  children,
  overflowCount,
  overflowLabel,
  title,
}: {
  readonly ariaLabel: string;
  readonly children: React.ReactNode;
  readonly overflowCount: number;
  readonly overflowLabel: string;
  readonly title: string;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <section>
      <h4 className="mb-1.5 font-medium text-muted-foreground text-[10px] uppercase tracking-wide">
        {title}
      </h4>
      <ul className="space-y-2" aria-label={ariaLabel}>
        {children}
        {overflowCount > 0 ? (
          <li className="text-muted-foreground">
            {translate("settings.mcp.runtime.additional", {
              count: overflowCount,
              section: overflowLabel,
            })}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function ToolAnnotations({ tool }: { readonly tool: McpRuntimeTool }) {
  const translate = useInterfaceTranslator().message;
  const labels = [
    tool.readOnly ? translate("settings.mcp.runtime.annotation.readOnly") : null,
    tool.destructive ? translate("settings.mcp.runtime.annotation.destructive") : null,
    tool.openWorld ? translate("settings.mcp.runtime.annotation.openWorld") : null,
  ].filter((label): label is string => label !== null);
  if (labels.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
