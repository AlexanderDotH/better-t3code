import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export type McpWorkspaceSection = "servers" | "runtime";

export interface McpWorkspacePanelProps {
  readonly activeSection: McpWorkspaceSection;
  readonly servers: ReactNode;
  readonly runtime: ReactNode;
  readonly className?: string;
  readonly contexts?: readonly { readonly id: string; readonly label: string }[];
  readonly providers?: readonly { readonly id: string; readonly label: string }[];
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
  return (
    <div className={cn("mcp-workspace-panel", props.className)} data-mcp-workspace-panel="true">
      {props.providers && props.providers.length > 0 ? (
        <div className="mcp-workspace-panel__selectors">
          <div className="mcp-workspace-panel__providers" role="tablist" aria-label="MCP providers">
            {props.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                role="tab"
                aria-selected={props.selectedProviderId === provider.id}
                data-active={props.selectedProviderId === provider.id ? "true" : undefined}
                onClick={() => props.onProviderChange?.(provider.id)}
              >
                {provider.label}
              </button>
            ))}
          </div>
          {props.activeSection === "runtime" && props.contexts ? (
            <label className="mcp-workspace-panel__context-selector">
              <span>Runtime session</span>
              <select
                value={props.selectedContextId ?? ""}
                onChange={(event) => props.onContextChange?.(event.currentTarget.value || null)}
              >
                {props.selectedContextId &&
                !props.contexts.some((context) => context.id === props.selectedContextId) ? (
                  <option value={props.selectedContextId}>Ended or unavailable session</option>
                ) : null}
                {props.contexts.length === 0 ? <option value="">No active session</option> : null}
                {props.contexts.map((context) => (
                  <option key={context.id} value={context.id}>
                    {context.label}
                  </option>
                ))}
              </select>
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
