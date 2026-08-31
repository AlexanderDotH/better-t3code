import type { McpRuntimeAction, ProviderDriverKind } from "@t3tools/contracts";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDownIcon,
  BracesIcon,
  FileTextIcon,
  Globe2Icon,
  LockKeyholeIcon,
  ServerIcon,
  WrenchIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import type { McpManagementSummary } from "../mcp-management/mcpManagementSummary";
import {
  McpServerRowControls,
  type McpRuntimeActionPending,
} from "../mcp-management/McpServerRowControls";
import type {
  McpConfiguredServerView,
  McpRuntimeContextView,
  McpRuntimeResourceTemplateView,
  McpRuntimeResourceView,
  McpRuntimeServerView,
  McpRuntimeToolView,
} from "../mcp-management/mcpManagementView";
import type { McpProviderTab, McpRuntimeTone } from "./McpServersSettings.logic";
import { runtimeStatePresentation } from "./McpServersSettings.logic";

export type {
  McpConfiguredServerView,
  McpRuntimeContextView,
  McpRuntimeServerView,
  McpRuntimeToolView,
};

export interface McpProviderWorkspaceProps {
  readonly providers: ReadonlyArray<McpProviderTab>;
  readonly selectedProviderId: string | null;
  readonly contexts: ReadonlyArray<McpRuntimeContextView>;
  readonly selectedContextId: string | null;
  readonly configuredServers: ReadonlyArray<McpConfiguredServerView>;
  readonly runtimeServers: ReadonlyArray<McpRuntimeServerView>;
  readonly runtimeSummary?: McpManagementSummary;
  readonly runtimeSupported: boolean;
  readonly runtimeError?: string;
  readonly providerAssignmentsSupported: boolean;
  readonly embedded?: boolean;
  readonly showProviderTabs?: boolean;
  readonly showRuntimeSelector?: boolean;
  readonly readOnly?: boolean;
  readonly isLoadingRuntime: boolean;
  readonly focusedServerKey?: string;
  readonly pendingProviderServerIds: ReadonlySet<string>;
  readonly pendingRuntimeAction?: McpRuntimeActionPending | null;
  readonly onSelectProvider: (providerId: string) => void;
  readonly onSelectContext: (contextId: string) => void;
  readonly onToggleProviderServer: (serverId: string, enabled: boolean) => void;
  readonly onEditServer: (serverId: string) => void;
  readonly onDuplicateServer: (serverId: string) => void;
  readonly onDeleteServer: (serverId: string) => void;
  readonly onRuntimeAction: (serverKey: string, action: McpRuntimeAction) => void;
  readonly onLoadServerDetails: (serverKey: string) => void;
}

const TONE_BADGE: Readonly<Record<McpRuntimeTone, "success" | "warning" | "error" | "outline">> = {
  success: "success",
  warning: "warning",
  danger: "error",
  neutral: "outline",
};

const PROVIDER_STATUS_DOT: Readonly<Record<McpProviderTab["statusTone"], string>> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  neutral: "bg-muted-foreground/45",
};

function runtimeCountLabel(
  server: McpRuntimeServerView,
  translate: ReturnType<typeof useInterfaceTranslator>["message"],
): string | null {
  if (server.toolCount !== undefined) {
    return translate("settings.mcp.runtime.toolCount", { count: server.toolCount });
  }
  if (server.capabilities.reportsTools) return translate("settings.mcp.provider.toolsAvailable");
  return null;
}

function availableRuntimeActions(server: McpRuntimeServerView): ReadonlyArray<McpRuntimeAction> {
  return [
    server.capabilities.authorize ? ("authorize" as const) : null,
    server.capabilities.reconnect ? ("reconnect" as const) : null,
    server.capabilities.refresh ? ("refresh" as const) : null,
  ].filter((action): action is McpRuntimeAction => action !== null);
}

function RuntimeDetails({ server }: { readonly server: McpRuntimeServerView }) {
  const translate = useInterfaceTranslator().message;
  return (
    <div className="grid gap-3 border-t border-border/50 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {server.version ? (
          <span>{translate("settings.mcp.runtime.version", { version: server.version })}</span>
        ) : null}
        {server.resourceCount !== undefined ? (
          <span>
            {translate("settings.mcp.runtime.resourceCount", { count: server.resourceCount })}
          </span>
        ) : null}
        {server.templateCount !== undefined ? (
          <span>
            {translate("settings.mcp.runtime.templateCount", { count: server.templateCount })}
          </span>
        ) : null}
      </div>
      {server.error ? (
        <p className="rounded-md bg-destructive/8 px-3 py-2 text-destructive text-xs">
          {server.error}
        </p>
      ) : null}
      {server.detailsLoading ? (
        <p className="text-muted-foreground text-xs">
          {translate("settings.mcp.runtime.loadingInventory")}
        </p>
      ) : server.tools && server.tools.length > 0 ? (
        <div className="grid gap-2">
          {server.tools.map((tool) => (
            <div
              key={tool.name}
              className="rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <WrenchIcon className="size-3.5 text-muted-foreground" />
                <span className="font-mono text-xs font-medium">{tool.title ?? tool.name}</span>
                {tool.readOnly ? (
                  <Badge size="sm" variant="success">
                    {translate("settings.mcp.runtime.annotation.readOnly")}
                  </Badge>
                ) : null}
                {tool.destructive ? (
                  <Badge size="sm" variant="warning">
                    {translate("settings.mcp.runtime.annotation.destructive")}
                  </Badge>
                ) : null}
                {tool.openWorld ? (
                  <Badge size="sm" variant="outline">
                    {translate("settings.mcp.provider.externalAccess")}
                  </Badge>
                ) : null}
              </div>
              {tool.description ? (
                <p className="mt-1.5 text-muted-foreground text-xs">{tool.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : server.capabilities.reportsTools ? (
        <p className="text-muted-foreground text-xs">{translate("settings.mcp.runtime.noTools")}</p>
      ) : null}
      {server.resources && server.resources.length > 0 ? (
        <RuntimeResourceList resources={server.resources} />
      ) : null}
      {server.templates && server.templates.length > 0 ? (
        <RuntimeResourceTemplateList templates={server.templates} />
      ) : null}
    </div>
  );
}

function RuntimeResourceList({
  resources,
}: {
  readonly resources: ReadonlyArray<McpRuntimeResourceView>;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <section className="grid gap-2" aria-label={translate("settings.mcp.workspace.resourcesAria")}>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {translate("settings.mcp.runtime.resources")}
      </h4>
      {resources.slice(0, 100).map((resource) => (
        <div key={resource.uri} className="min-w-0 rounded-lg border border-border/60 p-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
            <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{resource.title ?? resource.name}</span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {resource.uri}
          </p>
          {resource.description ? (
            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
              {resource.description}
            </p>
          ) : null}
        </div>
      ))}
      {resources.length > 100 ? (
        <p className="text-muted-foreground text-xs">
          {translate("settings.mcp.provider.additionalResources", {
            count: resources.length - 100,
          })}
        </p>
      ) : null}
    </section>
  );
}

function RuntimeResourceTemplateList({
  templates,
}: {
  readonly templates: ReadonlyArray<McpRuntimeResourceTemplateView>;
}) {
  const translate = useInterfaceTranslator().message;
  return (
    <section
      className="grid gap-2"
      aria-label={translate("settings.mcp.workspace.resourceTemplatesAria")}
    >
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {translate("settings.mcp.runtime.resourceTemplates")}
      </h4>
      {templates.slice(0, 100).map((template) => (
        <div key={template.uriTemplate} className="min-w-0 rounded-lg border border-border/60 p-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
            <BracesIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{template.title ?? template.name}</span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {template.uriTemplate}
          </p>
          {template.description ? (
            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
              {template.description}
            </p>
          ) : null}
        </div>
      ))}
      {templates.length > 100 ? (
        <p className="text-muted-foreground text-xs">
          {translate("settings.mcp.provider.additionalTemplates", {
            count: templates.length - 100,
          })}
        </p>
      ) : null}
    </section>
  );
}

function RuntimeServerRow(props: {
  readonly server: McpRuntimeServerView;
  readonly initiallyOpen: boolean;
  readonly locked?: boolean;
  readonly readOnly?: boolean;
  readonly pendingRuntimeAction: McpRuntimeActionPending | null;
  readonly onAction: (action: McpRuntimeAction) => void;
  readonly onLoadDetails: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const [open, setOpen] = useState(props.initiallyOpen);
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);
  const presentation = runtimeStatePresentation(props.server.state);
  const countLabel = runtimeCountLabel(props.server, translate);
  const hasDetails =
    props.server.capabilities.reportsTools ||
    Boolean(props.server.error || props.server.version) ||
    props.server.resourceCount !== undefined ||
    props.server.templateCount !== undefined;

  useEffect(() => {
    if (props.initiallyOpen) setOpen(true);
  }, [props.initiallyOpen]);

  useEffect(() => {
    if (
      !props.initiallyOpen ||
      autoLoadAttempted ||
      !hasDetails ||
      props.server.tools ||
      props.server.detailsLoading
    ) {
      return;
    }
    setAutoLoadAttempted(true);
    props.onLoadDetails();
  }, [
    autoLoadAttempted,
    hasDetails,
    props.initiallyOpen,
    props.onLoadDetails,
    props.server.detailsLoading,
    props.server.tools,
  ]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && hasDetails && !props.server.tools) props.onLoadDetails();
      }}
      className="border-b border-border/50 last:border-b-0"
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {props.locked ? (
              <LockKeyholeIcon className="size-4 text-muted-foreground" />
            ) : (
              <ServerIcon className="size-4 text-muted-foreground" />
            )}
            <span className="truncate text-sm font-medium">{props.server.name}</span>
            <Badge size="sm" variant={TONE_BADGE[presentation.tone]}>
              {translate(`settings.mcp.runtime.state.${props.server.state}`)}
            </Badge>
            {countLabel ? (
              <Badge size="sm" variant="secondary">
                {countLabel}
              </Badge>
            ) : null}
            {props.server.transport ? (
              <Badge size="sm" variant="outline">
                {props.server.transport}
              </Badge>
            ) : null}
            {props.server.drift ? (
              <Badge size="sm" variant="warning">
                {props.server.drift === "pending-enable"
                  ? translate("settings.mcp.provider.enableNext")
                  : translate("settings.mcp.provider.disableNext")}
              </Badge>
            ) : null}
          </div>
          {props.server.authLabel ? (
            <p className="text-warning-foreground text-xs">{props.server.authLabel}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!props.locked ? (
            <McpServerRowControls
              serverKey={props.server.serverKey}
              serverName={props.server.name}
              state={props.server.state}
              availableRuntimeActions={availableRuntimeActions(props.server)}
              pendingAction={props.pendingRuntimeAction}
              readOnly={props.readOnly === true}
              onRuntimeAction={props.onAction}
            />
          ) : null}
          {hasDetails ? (
            <CollapsibleTrigger
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={translate("settings.mcp.provider.detailsAria", {
                action: translate(
                  open ? "settings.mcp.provider.hide" : "settings.mcp.provider.show",
                ),
                server: props.server.name,
              })}
            >
              <ChevronDownIcon
                className={cn("size-4 transition-transform", open && "rotate-180")}
              />
            </CollapsibleTrigger>
          ) : null}
        </div>
      </div>
      {hasDetails ? (
        <CollapsiblePanel>
          <RuntimeDetails server={props.server} />
        </CollapsiblePanel>
      ) : null}
    </Collapsible>
  );
}

function ProviderTabs(props: {
  readonly providers: ReadonlyArray<McpProviderTab>;
  readonly selectedProviderId: string | null;
  readonly selectedRuntimeSummary?: {
    readonly connected: number;
    readonly total: number;
    readonly tone: "success" | "warning" | "danger";
  };
  readonly onSelectProvider: (providerId: string) => void;
}) {
  const translate = useInterfaceTranslator().message;
  if (props.providers.length === 0) {
    return (
      <div className="p-5 text-muted-foreground text-sm">
        {translate("settings.mcp.provider.noneConfiguredPrefix")}{" "}
        <a
          className="font-medium text-foreground underline underline-offset-4"
          href="/settings/providers"
        >
          {translate("settings.mcp.provider.settings")}
        </a>
        .
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto border-b border-border/60 p-2"
      role="tablist"
      aria-label={translate("settings.mcp.provider.accounts")}
    >
      <div className="flex min-w-max gap-1">
        {props.providers.map((provider) => {
          const selected = provider.instanceId === props.selectedProviderId;
          const accentStyle = provider.accentColor
            ? ({ "--mcp-provider-accent": provider.accentColor } as CSSProperties)
            : undefined;
          return (
            <Tooltip key={provider.instanceId}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    style={accentStyle}
                    className={cn(
                      "relative flex h-9 max-w-64 items-center gap-2 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-[var(--mcp-provider-accent,var(--border))] bg-[color-mix(in_oklab,var(--mcp-provider-accent,var(--muted))_10%,transparent)] text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/50 hover:text-foreground",
                      provider.disabled && "opacity-55",
                    )}
                    onClick={() => props.onSelectProvider(provider.instanceId)}
                  >
                    <ProviderInstanceIcon
                      driverKind={provider.driver as ProviderDriverKind}
                      displayName={provider.displayName}
                      accentColor={provider.accentColor}
                      showBadge={Boolean(provider.accentColor)}
                      className="size-5"
                      iconClassName="size-4"
                      indicatorBackground="var(--card)"
                    />
                    <span className="truncate">{provider.label}</span>
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        PROVIDER_STATUS_DOT[provider.statusTone],
                      )}
                      aria-label={translate("settings.mcp.provider.statusAria", {
                        status: provider.statusLabel,
                      })}
                    />
                    {selected && props.selectedRuntimeSummary ? (
                      <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            props.selectedRuntimeSummary.tone === "success" && "bg-success",
                            props.selectedRuntimeSummary.tone === "warning" && "bg-warning",
                            props.selectedRuntimeSummary.tone === "danger" && "bg-destructive",
                          )}
                          aria-hidden
                        />
                        {props.selectedRuntimeSummary.connected}/
                        {props.selectedRuntimeSummary.total}
                      </span>
                    ) : null}
                  </button>
                }
              />
              <TooltipPopup side="bottom" variant="glass" className="max-w-80">
                <div className="grid gap-1">
                  <span>{provider.tooltip}</span>
                  <span className="text-muted-foreground">{provider.statusLabel}</span>
                  {provider.account ? (
                    <RedactedSensitiveText
                      value={provider.account}
                      ariaLabel={translate("settings.mcp.provider.toggleAccount")}
                      revealTooltip={translate("settings.mcp.provider.revealAccount")}
                      hideTooltip={translate("settings.mcp.provider.hideAccount")}
                    />
                  ) : null}
                </div>
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function ConfiguredServerRow(props: {
  readonly server: McpConfiguredServerView;
  readonly runtime?: McpRuntimeServerView;
  readonly hasLiveContext: boolean;
  readonly pending: boolean;
  readonly pendingRuntimeAction: McpRuntimeActionPending | null;
  readonly providerAssignmentsSupported: boolean;
  readonly readOnly: boolean;
  readonly focused: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onRuntimeAction: (action: McpRuntimeAction) => void;
  readonly onLoadDetails: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const runtimePresentation = props.runtime ? runtimeStatePresentation(props.runtime.state) : null;
  const [open, setOpen] = useState(props.focused);
  const [autoLoadAttempted, setAutoLoadAttempted] = useState(false);
  const hasDetails = Boolean(
    props.runtime &&
    (props.runtime.error ||
      props.runtime.version ||
      props.runtime.capabilities.reportsTools ||
      props.runtime.resourceCount !== undefined ||
      props.runtime.templateCount !== undefined),
  );

  useEffect(() => {
    if (props.focused) setOpen(true);
  }, [props.focused]);

  useEffect(() => {
    if (
      !props.focused ||
      autoLoadAttempted ||
      !hasDetails ||
      !props.runtime ||
      props.runtime.tools ||
      props.runtime.detailsLoading
    ) {
      return;
    }
    setAutoLoadAttempted(true);
    props.onLoadDetails();
  }, [autoLoadAttempted, hasDetails, props.focused, props.onLoadDetails, props.runtime]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && props.runtime && !props.runtime.tools) props.onLoadDetails();
      }}
      className={cn("border-b border-border/50 last:border-b-0", props.focused && "bg-accent/25")}
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {props.server.globalScope ? (
              <Globe2Icon className="size-4 text-muted-foreground" />
            ) : (
              <ServerIcon className="size-4 text-muted-foreground" />
            )}
            <span
              className={cn(
                "truncate text-sm font-medium",
                !props.server.enabledForProvider && "text-muted-foreground",
              )}
            >
              {props.server.name}
            </span>
            <Badge size="sm" variant="outline">
              {props.server.transport}
            </Badge>
            {runtimePresentation && props.server.enabledForProvider ? (
              <Badge size="sm" variant={TONE_BADGE[runtimePresentation.tone]}>
                {translate(`settings.mcp.runtime.state.${props.runtime!.state}`)}
              </Badge>
            ) : (
              <Badge size="sm" variant={props.server.enabledForProvider ? "secondary" : "outline"}>
                {props.server.enabledForProvider
                  ? translate("settings.mcp.provider.configured")
                  : translate("settings.mcp.provider.off")}
              </Badge>
            )}
            {props.runtime?.toolCount !== undefined ? (
              <Badge size="sm" variant="secondary">
                {translate("settings.mcp.runtime.toolCount", {
                  count: props.runtime.toolCount,
                })}
              </Badge>
            ) : null}
            {props.server.secretCount > 0 ? (
              <Badge size="sm" variant="secondary">
                {translate("settings.mcp.provider.valueCount", {
                  count: props.server.secretCount,
                })}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-muted-foreground text-xs">{props.server.summary}</p>
          <p className="text-[11px] text-muted-foreground/70">
            {props.server.scopeLabel} · {translate("settings.mcp.provider.t3Managed")}
            {!props.hasLiveContext && props.server.enabledForProvider
              ? ` · ${translate("settings.mcp.provider.configuredNewSessions")}`
              : ""}
          </p>
          {props.runtime?.authLabel ? (
            <p className="text-warning-foreground text-xs">{props.runtime.authLabel}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <McpServerRowControls
            serverKey={props.runtime?.serverKey ?? props.server.id}
            serverName={props.server.name}
            state={props.runtime?.state ?? "disabled"}
            availableRuntimeActions={props.runtime ? availableRuntimeActions(props.runtime) : []}
            pendingAction={props.pendingRuntimeAction}
            readOnly={props.readOnly}
            providerAssignment={{
              enabled: props.server.enabledForProvider,
              disabled: !props.server.globallyEnabled || !props.providerAssignmentsSupported,
              pending: props.pending,
              onChange: props.onToggle,
            }}
            onRuntimeAction={props.onRuntimeAction}
            onEdit={props.onEdit}
            onDuplicate={props.onDuplicate}
            onDelete={props.onDelete}
          />
          {hasDetails ? (
            <CollapsibleTrigger
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={translate("settings.mcp.provider.detailsAria", {
                action: translate(
                  open ? "settings.mcp.provider.hide" : "settings.mcp.provider.show",
                ),
                server: props.server.name,
              })}
            >
              <ChevronDownIcon
                className={cn("size-4 transition-transform", open && "rotate-180")}
              />
            </CollapsibleTrigger>
          ) : null}
        </div>
      </div>
      {hasDetails && props.runtime ? (
        <CollapsiblePanel>
          <RuntimeDetails server={props.runtime} />
        </CollapsiblePanel>
      ) : null}
    </Collapsible>
  );
}

export function McpProviderWorkspace(props: McpProviderWorkspaceProps) {
  const translate = useInterfaceTranslator().message;
  const selectedProvider = props.providers.find(
    (provider) => provider.instanceId === props.selectedProviderId,
  );
  const selectedContext = props.contexts.find((context) => context.id === props.selectedContextId);
  const managedRuntimeById = useMemo(
    () =>
      new Map(
        props.runtimeServers
          .filter((server) => server.source === "t3-managed")
          .map((server) => [server.definitionId ?? server.serverKey, server]),
      ),
    [props.runtimeServers],
  );
  const configuredServerIds = useMemo(
    () => new Set(props.configuredServers.map((server) => server.id)),
    [props.configuredServers],
  );
  const unmatchedManagedServers = props.runtimeServers.filter(
    (server) =>
      server.source === "t3-managed" &&
      !configuredServerIds.has(server.definitionId ?? server.serverKey),
  );
  const nativeServers = props.runtimeServers.filter(
    (server) => server.source === "provider-native",
  );
  const systemServers = props.runtimeServers.filter((server) => server.source === "t3-built-in");
  const selectedRuntimeSummary =
    props.runtimeSummary?.mode === "live" && props.runtimeSummary.expectedCount > 0
      ? {
          connected: props.runtimeSummary.connectedCount,
          total: props.runtimeSummary.expectedCount,
          tone:
            props.runtimeSummary.attentionCount > 0
              ? ("danger" as const)
              : props.runtimeSummary.connectedCount === props.runtimeSummary.expectedCount
                ? ("success" as const)
                : ("warning" as const),
        }
      : undefined;

  return (
    <div
      data-mcp-provider-workspace={props.embedded ? "embedded" : "standalone"}
      className={cn(
        "overflow-hidden",
        props.embedded
          ? "border-y border-border/60 bg-transparent"
          : "rounded-xl border border-[var(--mcp-provider-accent,var(--border))] bg-card/35 shadow-sm",
      )}
      style={
        selectedProvider?.accentColor
          ? ({ "--mcp-provider-accent": selectedProvider.accentColor } as CSSProperties)
          : undefined
      }
    >
      {props.showProviderTabs !== false ? (
        <ProviderTabs
          providers={props.providers}
          selectedProviderId={props.selectedProviderId}
          {...(selectedRuntimeSummary ? { selectedRuntimeSummary } : {})}
          onSelectProvider={props.onSelectProvider}
        />
      ) : null}

      {selectedProvider ? (
        <>
          {props.showRuntimeSelector !== false ? (
            <div className="grid gap-3 border-b border-border/60 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {translate("settings.mcp.workspace.runtimeSession")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {translate("settings.mcp.provider.runtimeDescription")}
                </p>
              </div>
              <Select
                value={selectedContext?.id}
                disabled={props.contexts.length === 0}
                onValueChange={(value) => {
                  if (value) props.onSelectContext(value);
                }}
              >
                <SelectTrigger
                  className="min-w-56"
                  aria-label={translate("settings.mcp.workspace.runtimeSession")}
                >
                  <SelectValue>
                    {selectedContext?.label ??
                      translate("settings.mcp.provider.configuredNewSessions")}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {props.contexts.map((context) => (
                    <SelectItem key={context.id} value={context.id}>
                      {context.label}
                      {context.live
                        ? ` · ${translate("settings.mcp.provider.live")}`
                        : ` · ${translate("settings.mcp.provider.lastKnown")}`}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}

          {!props.runtimeSupported ? (
            <div className="border-b border-border/60 bg-muted/30 px-4 py-3 text-muted-foreground text-xs sm:px-5">
              {translate("settings.mcp.provider.runtimeUnsupported")}
            </div>
          ) : !selectedProvider.supportsUserMcp ? (
            <div className="border-b border-border/60 bg-muted/30 px-4 py-3 text-muted-foreground text-xs sm:px-5">
              {translate("settings.mcp.provider.userMcpUnsupported", {
                provider: selectedProvider.displayName,
              })}
            </div>
          ) : props.runtimeError ? (
            <div className="border-b border-border/60 bg-destructive/6 px-4 py-3 text-destructive text-xs sm:px-5">
              {props.runtimeError}
            </div>
          ) : props.isLoadingRuntime ? (
            <div className="border-b border-border/60 px-5 py-3 text-muted-foreground text-xs">
              {translate("settings.mcp.provider.loadingStatus")}
            </div>
          ) : null}

          {props.readOnly ? (
            <div className="border-b border-border/60 bg-muted/30 px-4 py-3 text-muted-foreground text-xs sm:px-5">
              {translate("settings.mcp.provider.readOnly")}
            </div>
          ) : null}

          <div>
            <div className="border-b border-border/60 px-4 py-2.5 sm:px-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {translate("settings.mcp.runtime.source.t3Managed")}
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                {translate("settings.mcp.provider.managedDescription")}
              </p>
            </div>
            {props.configuredServers.length === 0 && unmatchedManagedServers.length === 0 ? (
              <div className="p-5 text-muted-foreground text-sm">
                {translate("settings.mcp.provider.noServers")}
              </div>
            ) : (
              props.configuredServers.map((server) => {
                const runtime = managedRuntimeById.get(server.id);
                return (
                  <ConfiguredServerRow
                    key={server.id}
                    server={server}
                    {...(runtime ? { runtime } : {})}
                    hasLiveContext={Boolean(selectedContext)}
                    pending={props.pendingProviderServerIds.has(server.id)}
                    pendingRuntimeAction={props.pendingRuntimeAction ?? null}
                    providerAssignmentsSupported={
                      props.providerAssignmentsSupported && selectedProvider.supportsUserMcp
                    }
                    readOnly={props.readOnly === true}
                    focused={
                      props.focusedServerKey === server.id ||
                      props.focusedServerKey === runtime?.serverKey
                    }
                    onToggle={(enabled) => props.onToggleProviderServer(server.id, enabled)}
                    onEdit={() => props.onEditServer(server.id)}
                    onDuplicate={() => props.onDuplicateServer(server.id)}
                    onDelete={() => props.onDeleteServer(server.id)}
                    onRuntimeAction={(action) => {
                      if (runtime) props.onRuntimeAction(runtime.serverKey, action);
                    }}
                    onLoadDetails={() => {
                      if (runtime) props.onLoadServerDetails(runtime.serverKey);
                    }}
                  />
                );
              })
            )}
            {unmatchedManagedServers.map((server) => (
              <RuntimeServerRow
                key={server.serverKey}
                server={server}
                initiallyOpen={props.focusedServerKey === server.serverKey}
                pendingRuntimeAction={props.pendingRuntimeAction ?? null}
                {...(props.readOnly === undefined ? {} : { readOnly: props.readOnly })}
                onAction={(action) => props.onRuntimeAction(server.serverKey, action)}
                onLoadDetails={() => props.onLoadServerDetails(server.serverKey)}
              />
            ))}
          </div>

          {nativeServers.length > 0 ? (
            <section>
              <div className="border-y border-border/60 bg-muted/20 px-4 py-2.5 sm:px-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {translate("settings.mcp.workspace.providerManaged")}
                </h3>
              </div>
              {nativeServers.map((server) => (
                <RuntimeServerRow
                  key={server.serverKey}
                  server={server}
                  initiallyOpen={props.focusedServerKey === server.serverKey}
                  pendingRuntimeAction={props.pendingRuntimeAction ?? null}
                  {...(props.readOnly === undefined ? {} : { readOnly: props.readOnly })}
                  onAction={(action) => props.onRuntimeAction(server.serverKey, action)}
                  onLoadDetails={() => props.onLoadServerDetails(server.serverKey)}
                />
              ))}
            </section>
          ) : null}

          {systemServers.length > 0 ? (
            <section>
              <div className="border-y border-border/60 bg-muted/20 px-4 py-2.5 sm:px-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {translate("settings.mcp.workspace.systemServer")}
                </h3>
              </div>
              {systemServers.map((server) => (
                <RuntimeServerRow
                  key={server.serverKey}
                  server={server}
                  locked
                  initiallyOpen={props.focusedServerKey === server.serverKey}
                  pendingRuntimeAction={null}
                  onAction={() => {}}
                  onLoadDetails={() => props.onLoadServerDetails(server.serverKey)}
                />
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
