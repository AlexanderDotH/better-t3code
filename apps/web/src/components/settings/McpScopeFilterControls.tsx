import type { McpServerScope } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";

export interface McpScopeFilterProject {
  readonly key: string;
  readonly name: string;
}

export interface McpScopeFilterControlsProps {
  readonly scope: McpServerScope;
  readonly projectKey: string;
  readonly projects: ReadonlyArray<McpScopeFilterProject>;
  readonly onScopeChange: (scope: McpServerScope) => void;
  readonly onProjectKeyChange: (projectKey: string) => void;
}

export function McpScopeFilterControls(props: McpScopeFilterControlsProps) {
  const translate = useInterfaceTranslator().message;
  const selectedProject =
    props.projects.find((project) => project.key === props.projectKey) ?? props.projects[0] ?? null;

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-mcp-scope-controls="true">
      <div className="grid gap-1.5">
        <span className="font-medium text-muted-foreground text-xs">
          {translate("settings.mcp.scope.label")}
        </span>
        <Select
          value={props.scope}
          onValueChange={(value) => {
            if (value === "global" || value === "project") props.onScopeChange(value);
          }}
        >
          <SelectTrigger aria-label={translate("settings.mcp.scope.label")}>
            <SelectValue>
              {translate(
                props.scope === "global"
                  ? "settings.mcp.scope.global"
                  : "settings.mcp.scope.project",
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="global">{translate("settings.mcp.scope.global")}</SelectItem>
            <SelectItem value="project">{translate("settings.mcp.scope.project")}</SelectItem>
          </SelectPopup>
        </Select>
      </div>
      {props.scope === "project" ? (
        <div className="grid gap-1.5">
          <span className="font-medium text-muted-foreground text-xs">
            {translate("settings.mcp.scope.project")}
          </span>
          <Select
            value={selectedProject?.key}
            disabled={props.projects.length === 0}
            onValueChange={(value) => props.onProjectKeyChange(value ?? "")}
          >
            <SelectTrigger aria-label={translate("settings.mcp.scope.project")}>
              <SelectValue>
                {selectedProject?.name ?? translate("settings.mcp.scope.noProject")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {props.projects.map((project) => (
                <SelectItem key={project.key} value={project.key}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
