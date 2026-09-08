import { useId, type CSSProperties, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export type McpWorkspaceSection = "servers" | "runtime";

export interface McpWorkspacePanelProps {
  readonly activeSection: McpWorkspaceSection;
  readonly servers: ReactNode;
  readonly runtime: ReactNode;
  readonly className?: string;
  readonly contexts?: readonly { readonly id: string; readonly label: string }[];
  readonly providers?: readonly {
    readonly id: string;
    readonly label: string;
    readonly accentColor?: string;
  }[];
  readonly selectedContextId?: string | null;
  readonly selectedProviderId?: string | null;
  readonly onActiveSectionChange: (section: McpWorkspaceSection) => void;
  readonly onContextChange?: (contextId: string | null) => void;
  readonly onProviderChange?: (providerId: string) => void;
}

const SECTIONS: readonly McpWorkspaceSection[] = ["servers", "runtime"];

export function McpWorkspacePanel(props: McpWorkspacePanelProps) {
  const translate = useInterfaceTranslator().message;
  const sectionId = useId();
  const selectedProvider = props.providers?.find(
    (provider) => provider.id === props.selectedProviderId,
  );
  const selectedContext = props.contexts?.find((context) => context.id === props.selectedContextId);
  const missingSelectedContext =
    props.selectedContextId !== null &&
    props.selectedContextId !== undefined &&
    selectedContext === undefined;
  const contextOptions = missingSelectedContext
    ? [
        { id: props.selectedContextId, label: translate("settings.mcp.workspace.endedSession") },
        ...(props.contexts ?? []),
      ]
    : (props.contexts ?? []);
  const selectedContextLabel =
    selectedContext?.label ??
    (missingSelectedContext
      ? translate("settings.mcp.workspace.endedSession")
      : translate("settings.mcp.workspace.noActiveSession"));
  const showSelectors =
    (props.providers !== undefined && props.providers.length > 0) || props.contexts !== undefined;

  return (
    <div className={cn("mcp-workspace-panel", props.className)} data-mcp-workspace-panel="true">
      {showSelectors ? (
        <div className="mcp-workspace-panel__selectors" data-mcp-workspace-selectors="true">
          {props.providers && props.providers.length > 0 ? (
            <label className="mcp-workspace-panel__provider-selector">
              <span>{translate("settings.mcp.workspace.providers")}</span>
              <Select
                value={props.selectedProviderId ?? undefined}
                onValueChange={(providerId) => {
                  if (providerId) props.onProviderChange?.(providerId);
                }}
              >
                <SelectTrigger
                  className="mcp-workspace-panel__context-trigger"
                  aria-label={translate("settings.mcp.workspace.providers")}
                >
                  <SelectValue>{selectedProvider?.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  {props.providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full bg-(--mcp-provider-accent)"
                          style={
                            {
                              "--mcp-provider-accent":
                                provider.accentColor ?? "var(--muted-foreground)",
                            } as CSSProperties
                          }
                        />
                        {provider.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          ) : null}
          {props.contexts ? (
            <label
              className="mcp-workspace-panel__context-selector"
              data-mcp-runtime-session-selector="true"
            >
              <span>{translate("settings.mcp.workspace.runtimeSession")}</span>
              <Select
                value={props.selectedContextId ?? undefined}
                disabled={contextOptions.length === 0}
                onValueChange={(contextId) => props.onContextChange?.(contextId ?? null)}
              >
                <SelectTrigger
                  className="mcp-workspace-panel__context-trigger"
                  aria-label={translate("settings.mcp.workspace.runtimeSession")}
                >
                  <SelectValue>{selectedContextLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {contextOptions.map((context) => (
                    <SelectItem key={context.id} value={context.id}>
                      {context.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          ) : null}
        </div>
      ) : null}
      <nav
        className="mcp-workspace-panel__tabs"
        role="tablist"
        aria-label={translate("settings.mcp.workspace.views")}
      >
        {SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            role="tab"
            id={`${sectionId}-${section}`}
            aria-controls={`${sectionId}-panel`}
            aria-selected={props.activeSection === section}
            data-active={props.activeSection === section ? "true" : undefined}
            onClick={() => props.onActiveSectionChange(section)}
          >
            {translate(
              section === "servers"
                ? "settings.mcp.workspace.servers"
                : "settings.mcp.workspace.runtime",
            )}
          </button>
        ))}
      </nav>
      <div
        id={`${sectionId}-panel`}
        className="mcp-workspace-panel__content"
        role="tabpanel"
        aria-labelledby={`${sectionId}-${props.activeSection}`}
      >
        {props.activeSection === "servers" ? props.servers : props.runtime}
      </div>
    </div>
  );
}
