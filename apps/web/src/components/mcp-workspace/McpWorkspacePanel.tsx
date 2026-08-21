import type { CSSProperties, ReactNode } from "react";

import { cn } from "~/lib/utils";

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

const SECTIONS: readonly { readonly id: McpWorkspaceSection; readonly label: string }[] = [
  { id: "servers", label: "Servers" },
  { id: "runtime", label: "Runtime" },
];

export function McpWorkspacePanel(props: McpWorkspacePanelProps) {
  const selectedContext = props.contexts?.find((context) => context.id === props.selectedContextId);
  const missingSelectedContext =
    props.selectedContextId !== null &&
    props.selectedContextId !== undefined &&
    selectedContext === undefined;
  const contextOptions = missingSelectedContext
    ? [
        { id: props.selectedContextId, label: "Ended or unavailable session" },
        ...(props.contexts ?? []),
      ]
    : (props.contexts ?? []);
  const selectedContextLabel =
    selectedContext?.label ??
    (missingSelectedContext ? "Ended or unavailable session" : "No active session");
  const showSelectors =
    (props.providers !== undefined && props.providers.length > 0) || props.contexts !== undefined;

  return (
    <div className={cn("mcp-workspace-panel", props.className)} data-mcp-workspace-panel="true">
      {showSelectors ? (
        <div className="mcp-workspace-panel__selectors" data-mcp-workspace-selectors="true">
          {props.providers && props.providers.length > 0 ? (
            <div
              className="mcp-workspace-panel__providers"
              role="tablist"
              aria-label="MCP providers"
            >
              {props.providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  role="tab"
                  aria-selected={props.selectedProviderId === provider.id}
                  data-active={props.selectedProviderId === provider.id ? "true" : undefined}
                  style={
                    provider.accentColor
                      ? ({ "--mcp-provider-accent": provider.accentColor } as CSSProperties)
                      : undefined
                  }
                  onClick={() => props.onProviderChange?.(provider.id)}
                >
                  {provider.label}
                </button>
              ))}
            </div>
          ) : null}
          {props.contexts ? (
            <label
              className="mcp-workspace-panel__context-selector"
              data-mcp-runtime-session-selector="true"
            >
              <span>Runtime session</span>
              <Select
                value={props.selectedContextId ?? undefined}
                disabled={contextOptions.length === 0}
                onValueChange={(contextId) => props.onContextChange?.(contextId ?? null)}
              >
                <SelectTrigger
                  className="mcp-workspace-panel__context-trigger"
                  size="sm"
                  aria-label="Runtime session"
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
      <nav className="mcp-workspace-panel__tabs" role="tablist" aria-label="MCP workspace views">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={props.activeSection === section.id}
            data-active={props.activeSection === section.id ? "true" : undefined}
            onClick={() => props.onActiveSectionChange(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>
      <div className="mcp-workspace-panel__content" role="tabpanel">
        {props.activeSection === "servers" ? props.servers : props.runtime}
      </div>
    </div>
  );
}
