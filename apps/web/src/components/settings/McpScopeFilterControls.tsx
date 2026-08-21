import type { McpServerScope } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

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
  const selectedProject =
    props.projects.find((project) => project.key === props.projectKey) ?? props.projects[0] ?? null;

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-mcp-scope-controls="true">
      <div className="grid gap-1.5">
        <span className="font-medium text-muted-foreground text-xs">Scope</span>
        <Select
          value={props.scope}
          onValueChange={(value) => {
            if (value === "global" || value === "project") props.onScopeChange(value);
          }}
        >
          <SelectTrigger aria-label="Scope">
            <SelectValue>{props.scope === "global" ? "Global" : "Project"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="global">Global</SelectItem>
            <SelectItem value="project">Project</SelectItem>
          </SelectPopup>
        </Select>
      </div>
      {props.scope === "project" ? (
        <div className="grid gap-1.5">
          <span className="font-medium text-muted-foreground text-xs">Project</span>
          <Select
            value={selectedProject?.key}
            disabled={props.projects.length === 0}
            onValueChange={(value) => props.onProjectKeyChange(value ?? "")}
          >
            <SelectTrigger aria-label="Project">
              <SelectValue>{selectedProject?.name ?? "No project"}</SelectValue>
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
