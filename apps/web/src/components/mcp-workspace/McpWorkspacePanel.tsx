import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useInterfaceTranslator } from "~/hooks/useInterfaceTranslator";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export type McpWorkspaceSection = "store" | "servers" | "skills" | "runtime";

export interface McpWorkspacePanelProps {
  readonly activeSection: McpWorkspaceSection;
  readonly servers: ReactNode;
  readonly store: ReactNode;
  readonly skills: ReactNode;
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

const SECTIONS = [
  { id: "installed", label: "settings.mcp.store.installed" },
  { id: "store", label: "settings.mcp.store.browse" },
  { id: "runtime", label: "settings.mcp.store.diagnostics" },
] as const;

export function McpWorkspacePanel(props: McpWorkspacePanelProps) {
  const translate = useInterfaceTranslator().message;
  const sectionId = useId();
  const installed = props.activeSection === "servers" || props.activeSection === "skills";
  const activeTab = installed ? "installed" : props.activeSection;
  const [installedSection, setInstalledSection] = useState<"servers" | "skills">("servers");
  if (installed && installedSection !== props.activeSection)
    setInstalledSection(props.activeSection);
  const selectTab = (tab: (typeof SECTIONS)[number]["id"]) =>
    props.onActiveSectionChange(tab === "installed" ? installedSection : tab);
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
    (props.activeSection === "servers" || props.activeSection === "runtime") &&
    ((props.providers !== undefined && props.providers.length > 0) || props.contexts !== undefined);

  return (
    <div className={cn("mcp-workspace-panel", props.className)} data-mcp-workspace-panel="true">
      <nav
        className="mcp-workspace-panel__tabs"
        role="tablist"
        aria-label={translate("settings.mcp.workspace.views")}
      >
        {SECTIONS.map(({ id: section, label }, index) => (
          <button
            key={section}
            type="button"
            role="tab"
            id={`${sectionId}-${section}`}
            aria-controls={`${sectionId}-panel`}
            aria-selected={activeTab === section}
            tabIndex={activeTab === section ? 0 : -1}
            data-active={activeTab === section ? "true" : undefined}
            onClick={() => selectTab(section)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % SECTIONS.length
                  : event.key === "ArrowLeft"
                    ? (index + SECTIONS.length - 1) % SECTIONS.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? SECTIONS.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              selectTab(SECTIONS[next]!.id);
              const tabs =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              tabs?.[next]?.focus();
            }}
          >
            {translate(label)}
          </button>
        ))}
      </nav>
      <div
        id={`${sectionId}-panel`}
        className="mcp-workspace-panel__content"
        role="tabpanel"
        aria-labelledby={`${sectionId}-${activeTab}`}
      >
        {installed ? (
          <div className="mcp-workspace-panel__installed-intro">
            <div>
              <h2>{translate("settings.mcp.store.installed")}</h2>
              <p>{translate("settings.mcp.store.installedDescription")}</p>
            </div>
            <div
              className="extension-store__filters"
              role="group"
              aria-label={translate("settings.mcp.store.kind")}
            >
              {(["servers", "skills"] as const).map((section) => (
                <Button
                  key={section}
                  size="sm"
                  variant={props.activeSection === section ? "secondary" : "ghost"}
                  aria-pressed={props.activeSection === section}
                  onClick={() => props.onActiveSectionChange(section)}
                >
                  {translate(
                    section === "servers"
                      ? "settings.mcp.store.servers"
                      : "settings.mcp.store.skills",
                  )}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
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
            {props.contexts && props.activeSection === "runtime" ? (
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
        {props[props.activeSection]}
      </div>
    </div>
  );
}
