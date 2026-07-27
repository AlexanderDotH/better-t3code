import type {
  AgentImportSource,
  McpProviderStatus,
  McpSecretValue,
  McpServerDefinition,
  McpServerId,
  McpServerScope,
  McpServerTransport,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CopyIcon,
  Edit3Icon,
  FileJsonIcon,
  Globe2Icon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { primaryServerProvidersAtom } from "../../state/server";
import { useProjects } from "../../state/entities";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const MCP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MCP_ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MCP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MCP_HTTP_URL_PATTERN = /^https?:\/\/.+/i;
const EMPTY_CURSOR_JSON = '{\n  "mcpServers": {}\n}';

type ScopeFilter = McpServerScope;
type ExportScope = "all" | McpServerScope;
type EditorMode = "create" | "edit";

interface ProjectOption {
  readonly key: string;
  readonly id: EnvironmentProject["id"];
  readonly cwd: string;
  readonly name: string;
  readonly environmentId: EnvironmentProject["environmentId"];
}

interface SecretEntryDraft {
  readonly rowId: string;
  readonly key: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly valueRedacted: boolean;
}

let nextSecretEntryDraftId = 0;

function newSecretEntryDraft(input?: Partial<Omit<SecretEntryDraft, "rowId">>): SecretEntryDraft {
  nextSecretEntryDraftId += 1;
  return {
    rowId: `mcp-secret-entry-${nextSecretEntryDraftId}`,
    key: input?.key ?? "",
    value: input?.value ?? "",
    sensitive: input?.sensitive ?? false,
    valueRedacted: input?.valueRedacted ?? false,
  };
}

interface McpServerDraft {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly scope: McpServerScope;
  readonly projectKey: string;
  readonly transport: McpServerTransport;
  readonly command: string;
  readonly argsText: string;
  readonly cwd: string;
  readonly url: string;
  readonly env: ReadonlyArray<SecretEntryDraft>;
  readonly headers: ReadonlyArray<SecretEntryDraft>;
}

function projectOptionKey(project: EnvironmentProject): string {
  return `${project.environmentId}:${project.id}`;
}

function projectOptions(projects: ReadonlyArray<EnvironmentProject>): ReadonlyArray<ProjectOption> {
  return projects.map((project) => ({
    key: projectOptionKey(project),
    id: project.id,
    cwd: project.workspaceRoot,
    name: project.title,
    environmentId: project.environmentId,
  }));
}

function normalizeServerId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const prefixed = /^[a-zA-Z]/.test(normalized) ? normalized : `mcp_${normalized}`;
  return (prefixed || "mcp_server").slice(0, 96);
}

function uniqueServerId(baseName: string, existingIds: ReadonlySet<string>): string {
  const base = normalizeServerId(baseName);
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    const nextSuffix = `_${suffix}`;
    candidate = `${base.slice(0, 96 - nextSuffix.length)}${nextSuffix}`;
    suffix += 1;
  }
  return candidate;
}

function secretEntriesFromMap(
  values: Record<string, McpSecretValue>,
): ReadonlyArray<SecretEntryDraft> {
  return Object.entries(values)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) =>
      newSecretEntryDraft({
        key,
        value: value.value,
        sensitive: value.sensitive,
        valueRedacted: value.valueRedacted === true,
      }),
    );
}

function secretEntriesToMap(
  entries: ReadonlyArray<SecretEntryDraft>,
): Record<string, McpSecretValue> {
  return Object.fromEntries(
    entries
      .map((entry) => ({
        key: entry.key.trim(),
        value: entry.value,
        sensitive: entry.sensitive,
        valueRedacted: entry.valueRedacted,
      }))
      .filter((entry) => entry.key.length > 0)
      .map((entry) => [
        entry.key,
        {
          value: entry.value,
          sensitive: entry.sensitive,
          ...(entry.sensitive && entry.valueRedacted ? { valueRedacted: true } : {}),
        } satisfies McpSecretValue,
      ]),
  );
}

function clearRedactedSecretEntries(
  entries: ReadonlyArray<SecretEntryDraft>,
): ReadonlyArray<SecretEntryDraft> {
  return entries.map((entry) =>
    entry.sensitive && entry.valueRedacted ? { ...entry, value: "", valueRedacted: false } : entry,
  );
}

function findServerProjectKey(
  server: McpServerDefinition | null,
  projects: ReadonlyArray<ProjectOption>,
): string {
  if (!server) return projects[0]?.key ?? "";
  return (
    projects.find((project) => project.cwd === server.projectCwd)?.key ??
    projects.find((project) => project.id === server.projectId)?.key ??
    projects[0]?.key ??
    ""
  );
}

function emptyDraft(projects: ReadonlyArray<ProjectOption>): McpServerDraft {
  return {
    id: "",
    name: "",
    enabled: true,
    scope: "global",
    projectKey: projects[0]?.key ?? "",
    transport: "stdio",
    command: "",
    argsText: "",
    cwd: "",
    url: "",
    env: [],
    headers: [],
  };
}

function draftFromServer(
  server: McpServerDefinition,
  projects: ReadonlyArray<ProjectOption>,
): McpServerDraft {
  const base = {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    scope: server.scope,
    projectKey: findServerProjectKey(server, projects),
  };

  if (server.transport === "stdio") {
    return {
      ...base,
      transport: "stdio",
      command: server.command,
      argsText: server.args.join("\n"),
      cwd: server.cwd ?? "",
      url: "",
      env: secretEntriesFromMap(server.env),
      headers: [],
    };
  }

  return {
    ...base,
    transport: server.transport,
    command: "",
    argsText: "",
    cwd: "",
    url: server.url,
    env: [],
    headers: secretEntriesFromMap(server.headers),
  };
}

function duplicateDraftFromServer(
  server: McpServerDefinition,
  projects: ReadonlyArray<ProjectOption>,
  existingIds: ReadonlySet<string>,
): McpServerDraft {
  const draft = draftFromServer(server, projects);
  const name = `${draft.name} Copy`;
  return {
    ...draft,
    id: uniqueServerId(name, existingIds),
    name,
    env: clearRedactedSecretEntries(draft.env),
    headers: clearRedactedSecretEntries(draft.headers),
  };
}

function selectedProject(
  draft: Pick<McpServerDraft, "projectKey">,
  projects: ReadonlyArray<ProjectOption>,
): ProjectOption | null {
  return projects.find((project) => project.key === draft.projectKey) ?? projects[0] ?? null;
}

function draftToServer(
  draft: McpServerDraft,
  projects: ReadonlyArray<ProjectOption>,
): McpServerDefinition {
  const id = (draft.id.trim() || normalizeServerId(draft.name)) as McpServerId;
  const project = selectedProject(draft, projects);
  const base = {
    id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    scope: draft.scope,
    ...(draft.scope === "project" && project
      ? { projectId: project.id, projectCwd: project.cwd }
      : {}),
  };

  if (draft.transport === "stdio") {
    return {
      ...base,
      transport: "stdio",
      command: draft.command.trim(),
      args: draft.argsText
        .split("\n")
        .map((arg) => arg.trim())
        .filter((arg) => arg.length > 0),
      ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
      env: secretEntriesToMap(draft.env),
    };
  }

  return {
    ...base,
    transport: draft.transport,
    url: draft.url.trim(),
    headers: secretEntriesToMap(draft.headers),
  };
}

function validateSecretEntries(
  entries: ReadonlyArray<SecretEntryDraft>,
  pattern: RegExp,
  label: string,
): string | null {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key && !entry.value.trim()) continue;
    if (!key) return `${label} names are required.`;
    if (!pattern.test(key)) return `${key} is not a valid ${label.toLowerCase()} name.`;
    if (seen.has(key)) return `${key} is duplicated.`;
    seen.add(key);
  }
  return null;
}

function validateDraft(input: {
  readonly draft: McpServerDraft;
  readonly mode: EditorMode;
  readonly originalId: string | null;
  readonly existingIds: ReadonlySet<string>;
  readonly projects: ReadonlyArray<ProjectOption>;
}): string | null {
  const id = input.draft.id.trim() || normalizeServerId(input.draft.name);
  if (!input.draft.name.trim()) return "Name is required.";
  if (!MCP_ID_PATTERN.test(id))
    return "Identifier must start with a letter and use letters, numbers, '_' or '-'.";
  if (id.length > 96) return "Identifier must be 96 characters or less.";
  if ((input.mode === "create" || id !== input.originalId) && input.existingIds.has(id)) {
    return `MCP server '${id}' already exists.`;
  }
  if (input.draft.scope === "project" && !selectedProject(input.draft, input.projects)) {
    return "Select a project.";
  }
  if (input.draft.transport === "stdio") {
    if (!input.draft.command.trim()) return "Command is required.";
    return validateSecretEntries(input.draft.env, MCP_ENV_NAME_PATTERN, "Environment variable");
  }
  if (!MCP_HTTP_URL_PATTERN.test(input.draft.url.trim())) {
    return "URL must start with http:// or https://.";
  }
  return validateSecretEntries(input.draft.headers, MCP_HEADER_NAME_PATTERN, "Header");
}

function updateSecretEntry(
  entries: ReadonlyArray<SecretEntryDraft>,
  index: number,
  patch: Partial<SecretEntryDraft>,
): ReadonlyArray<SecretEntryDraft> {
  return entries.map((entry, currentIndex) =>
    currentIndex === index ? { ...entry, ...patch } : entry,
  );
}

function removeSecretEntry(
  entries: ReadonlyArray<SecretEntryDraft>,
  index: number,
): ReadonlyArray<SecretEntryDraft> {
  return entries.filter((_, currentIndex) => currentIndex !== index);
}

function transportLabel(transport: McpServerTransport): string {
  switch (transport) {
    case "stdio":
      return "stdio";
    case "sse":
      return "SSE";
    case "http":
      return "HTTP";
  }
}

function providerStatusBadgeVariant(status: McpProviderStatus["state"]) {
  switch (status) {
    case "ready":
      return "success";
    case "limited":
      return "warning";
    case "unsupported":
      return "outline";
  }
}

function statusLabel(status: McpProviderStatus["state"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "limited":
      return "Limited";
    case "unsupported":
      return "Unsupported";
  }
}

function providerCapabilityLabel(status: McpProviderStatus): string {
  switch (status.capability) {
    case "sessionConfig":
      return "Session config";
    case "nativeConfig":
      return "Native config";
    case "unsupported":
      return "Unsupported";
  }
}

function serverSummary(server: McpServerDefinition): string {
  if (server.transport === "stdio") {
    return [server.command, ...server.args].join(" ");
  }
  return server.url;
}

function serverSecretCount(server: McpServerDefinition): number {
  return server.transport === "stdio"
    ? Object.keys(server.env).length
    : Object.keys(server.headers).length;
}

function scopeLabel(server: McpServerDefinition): string {
  if (server.scope === "global") return "Global";
  return server.projectCwd ?? server.projectId ?? "Project";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SecretEntriesEditor(props: {
  readonly label: string;
  readonly entries: ReadonlyArray<SecretEntryDraft>;
  readonly namePlaceholder: string;
  readonly onChange: (entries: ReadonlyArray<SecretEntryDraft>) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{props.label}</Label>
        <Button
          size="xs"
          variant="outline"
          onClick={() => props.onChange([...props.entries, newSecretEntryDraft()])}
        >
          <PlusIcon className="size-3.5" />
          Add
        </Button>
      </div>
      {props.entries.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-xs">
          No values configured.
        </div>
      ) : (
        <div className="space-y-2">
          {props.entries.map((entry, index) => (
            <div
              key={entry.rowId}
              className="grid gap-2 rounded-lg border bg-background/40 p-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto_auto] sm:items-center"
            >
              <Input
                value={entry.key}
                placeholder={props.namePlaceholder}
                onChange={(event) =>
                  props.onChange(
                    updateSecretEntry(props.entries, index, { key: event.currentTarget.value }),
                  )
                }
              />
              <Input
                value={entry.value}
                type={entry.sensitive ? "password" : "text"}
                placeholder={entry.valueRedacted ? "Stored secret" : "Value"}
                onChange={(event) =>
                  props.onChange(
                    updateSecretEntry(props.entries, index, {
                      value: event.currentTarget.value,
                      valueRedacted: false,
                    }),
                  )
                }
              />
              <label className="flex items-center gap-2 text-muted-foreground text-xs">
                <Switch
                  checked={entry.sensitive}
                  onCheckedChange={(checked) =>
                    props.onChange(
                      updateSecretEntry(props.entries, index, {
                        sensitive: Boolean(checked),
                        valueRedacted: checked ? entry.valueRedacted : false,
                      }),
                    )
                  }
                />
                Sensitive
              </label>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${entry.key || props.label} value`}
                onClick={() => props.onChange(removeSecretEntry(props.entries, index))}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function McpServerEditorDialog(props: {
  readonly open: boolean;
  readonly mode: EditorMode;
  readonly draft: McpServerDraft;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly onDraftChange: (draft: McpServerDraft) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: () => void;
}) {
  const project = selectedProject(props.draft, props.projects);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.mode === "edit" ? "Edit MCP server" : "New MCP server"}</DialogTitle>
          <DialogDescription>
            T3 stores MCP configuration locally and resolves it when a provider session starts.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={props.draft.name}
                placeholder="GitHub"
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, name: event.currentTarget.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Identifier</Label>
              <Input
                value={props.draft.id}
                placeholder={normalizeServerId(props.draft.name || "github")}
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, id: event.currentTarget.value })
                }
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-2">
              <Label>Scope</Label>
              <Select
                value={props.draft.scope}
                onValueChange={(value) =>
                  props.onDraftChange({
                    ...props.draft,
                    scope: (value ?? "global") as McpServerScope,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue>{props.draft.scope === "global" ? "Global" : "Project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select
                value={project?.key}
                disabled={props.draft.scope !== "project" || props.projects.length === 0}
                onValueChange={(value) =>
                  props.onDraftChange({ ...props.draft, projectKey: value ?? "" })
                }
              >
                <SelectTrigger>
                  <SelectValue>{project?.name ?? "No project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {props.projects.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <label className="flex h-8 items-center gap-2 text-muted-foreground text-xs sm:h-7">
              <Switch
                checked={props.draft.enabled}
                onCheckedChange={(checked) =>
                  props.onDraftChange({ ...props.draft, enabled: Boolean(checked) })
                }
              />
              Enabled
            </label>
          </div>

          <div className="grid gap-2">
            <Label>Transport</Label>
            <Select
              value={props.draft.transport}
              onValueChange={(value) =>
                props.onDraftChange({
                  ...props.draft,
                  transport: (value ?? "stdio") as McpServerTransport,
                })
              }
            >
              <SelectTrigger>
                <SelectValue>{transportLabel(props.draft.transport)}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="stdio">stdio</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
                <SelectItem value="http">HTTP</SelectItem>
              </SelectPopup>
            </Select>
          </div>

          {props.draft.transport === "stdio" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Command</Label>
                  <Input
                    value={props.draft.command}
                    placeholder="npx"
                    onChange={(event) =>
                      props.onDraftChange({ ...props.draft, command: event.currentTarget.value })
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Working directory</Label>
                  <Input
                    value={props.draft.cwd}
                    placeholder="/repo"
                    onChange={(event) =>
                      props.onDraftChange({ ...props.draft, cwd: event.currentTarget.value })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Arguments</Label>
                <Textarea
                  className="[&_textarea]:min-h-24 font-mono text-xs"
                  value={props.draft.argsText}
                  placeholder="-y&#10;@modelcontextprotocol/server-github"
                  onChange={(event) =>
                    props.onDraftChange({ ...props.draft, argsText: event.currentTarget.value })
                  }
                />
              </div>
              <SecretEntriesEditor
                label="Environment"
                entries={props.draft.env}
                namePlaceholder="GITHUB_TOKEN"
                onChange={(env) => props.onDraftChange({ ...props.draft, env })}
              />
            </>
          ) : (
            <>
              <div className="grid gap-2">
                <Label>URL</Label>
                <Input
                  value={props.draft.url}
                  placeholder="https://example.com/mcp"
                  onChange={(event) =>
                    props.onDraftChange({ ...props.draft, url: event.currentTarget.value })
                  }
                />
              </div>
              <SecretEntriesEditor
                label="Headers"
                entries={props.draft.headers}
                namePlaceholder="Authorization"
                onChange={(headers) => props.onDraftChange({ ...props.draft, headers })}
              />
            </>
          )}

          {props.error ? <p className="text-destructive text-xs">{props.error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={props.isSaving} onClick={props.onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ImportSourceRows(props: {
  readonly sources: ReadonlyArray<AgentImportSource>;
  readonly selectedSourceIds: ReadonlyArray<string>;
  readonly isLoading: boolean;
  readonly onSelectedSourceIdsChange: (sourceIds: ReadonlyArray<string>) => void;
}) {
  const selected = useMemo(() => new Set(props.selectedSourceIds), [props.selectedSourceIds]);

  if (props.isLoading) {
    return (
      <div className="rounded-md border p-4 text-muted-foreground text-sm">
        Scanning agent folders...
      </div>
    );
  }

  if (props.sources.length === 0) {
    return (
      <div className="rounded-md border p-4 text-muted-foreground text-sm">
        No agent dotfolders with importable MCP config were found.
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      {props.sources.map((source) => {
        const disabled = source.mcpServerCount === 0;
        return (
          <label
            key={source.id}
            className={cn(
              "flex gap-3 border-b p-3 last:border-b-0",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            )}
          >
            <Checkbox
              checked={selected.has(source.id)}
              disabled={disabled}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(source.id);
                else next.delete(source.id);
                props.onSelectedSourceIdsChange([...next]);
              }}
            />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{source.label}</span>
                <Badge variant="outline" size="sm">
                  {source.tool}
                </Badge>
              </span>
              <span className="block truncate text-muted-foreground text-xs">{source.path}</span>
              <span className="block text-muted-foreground text-xs">
                {source.mcpServerCount} MCP server{source.mcpServerCount === 1 ? "" : "s"},{" "}
                {source.skillCount} skill{source.skillCount === 1 ? "" : "s"}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function McpImportDialog(props: {
  readonly open: boolean;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly sources: ReadonlyArray<AgentImportSource>;
  readonly selectedSourceIds: ReadonlyArray<string>;
  readonly isLoadingSources: boolean;
  readonly isImporting: boolean;
  readonly error: string | null;
  readonly scope: McpServerScope;
  readonly projectKey: string;
  readonly replace: boolean;
  readonly deduplicate: boolean;
  readonly onSelectedSourceIdsChange: (sourceIds: ReadonlyArray<string>) => void;
  readonly onScopeChange: (scope: McpServerScope) => void;
  readonly onProjectKeyChange: (projectKey: string) => void;
  readonly onReplaceChange: (replace: boolean) => void;
  readonly onDeduplicateChange: (deduplicate: boolean) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImport: () => void;
}) {
  const project =
    props.projects.find((option) => option.key === props.projectKey) ?? props.projects[0] ?? null;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Agent Configs</DialogTitle>
          <DialogDescription>
            Import MCP servers from detected Codex, Cursor, Claude, and OpenCode folders.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <ImportSourceRows
            sources={props.sources}
            selectedSourceIds={props.selectedSourceIds}
            isLoading={props.isLoadingSources}
            onSelectedSourceIdsChange={props.onSelectedSourceIdsChange}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Scope</Label>
              <Select
                value={props.scope}
                onValueChange={(value) =>
                  props.onScopeChange((value ?? "global") as McpServerScope)
                }
              >
                <SelectTrigger>
                  <SelectValue>{props.scope === "global" ? "Global" : "Project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select
                value={project?.key}
                disabled={props.scope !== "project" || props.projects.length === 0}
                onValueChange={(value) => props.onProjectKeyChange(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue>{project?.name ?? "No project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {props.projects.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            <Switch
              checked={props.replace}
              onCheckedChange={(checked) => props.onReplaceChange(Boolean(checked))}
            />
            Replace existing MCP servers
          </label>
          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            <Switch
              checked={props.deduplicate}
              onCheckedChange={(checked) => props.onDeduplicateChange(Boolean(checked))}
            />
            Deduplicate matching MCP servers
          </label>
          {props.error ? <p className="text-destructive text-xs">{props.error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={props.isImporting || props.selectedSourceIds.length === 0}
            onClick={props.onImport}
          >
            <UploadIcon className="size-4" />
            Import
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function CursorExportDialog(props: {
  readonly open: boolean;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly isExporting: boolean;
  readonly error: string | null;
  readonly json: string;
  readonly scope: ExportScope;
  readonly projectKey: string;
  readonly includeDisabled: boolean;
  readonly onScopeChange: (scope: ExportScope) => void;
  readonly onProjectKeyChange: (projectKey: string) => void;
  readonly onIncludeDisabledChange: (includeDisabled: boolean) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRefresh: () => void;
  readonly onCopy: () => void;
}) {
  const project =
    props.projects.find((option) => option.key === props.projectKey) ?? props.projects[0] ?? null;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Cursor JSON</DialogTitle>
          <DialogDescription>
            Export the selected MCP servers as Cursor-compatible JSON.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Scope</Label>
              <Select
                value={props.scope}
                onValueChange={(value) => props.onScopeChange((value ?? "all") as ExportScope)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {props.scope === "all"
                      ? "All"
                      : props.scope === "global"
                        ? "Global"
                        : "Project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                </SelectPopup>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Project</Label>
              <Select
                value={project?.key}
                disabled={props.scope !== "project" || props.projects.length === 0}
                onValueChange={(value) => props.onProjectKeyChange(value ?? "")}
              >
                <SelectTrigger>
                  <SelectValue>{project?.name ?? "No project"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {props.projects.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            <Switch
              checked={props.includeDisabled}
              onCheckedChange={(checked) => props.onIncludeDisabledChange(Boolean(checked))}
            />
            Include disabled servers
          </label>
          <Textarea
            readOnly
            className="[&_textarea]:min-h-64 font-mono text-xs"
            value={props.json}
          />
          {props.error ? <p className="text-destructive text-xs">{props.error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={props.isExporting} onClick={props.onRefresh}>
            <RefreshCwIcon className="size-4" />
            Refresh
          </Button>
          <Button disabled={props.json.trim().length === 0} onClick={props.onCopy}>
            <CopyIcon className="size-4" />
            Copy
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ProviderStatusRows(props: {
  readonly statuses: ReadonlyArray<McpProviderStatus>;
  readonly providerNames: ReadonlyMap<string, string>;
  readonly isLoading: boolean;
}) {
  if (props.isLoading) {
    return <div className="p-5 text-muted-foreground text-sm">Loading provider status...</div>;
  }

  if (props.statuses.length === 0) {
    return <div className="p-5 text-muted-foreground text-sm">No providers configured.</div>;
  }

  return (
    <div className="divide-y divide-border/60">
      {props.statuses.map((status) => {
        const providerName =
          props.providerNames.get(status.instanceId) ?? `${status.provider} (${status.instanceId})`;
        return (
          <div
            key={status.instanceId}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium text-foreground">{providerName}</span>
                <Badge variant={providerStatusBadgeVariant(status.state)} size="sm">
                  {statusLabel(status.state)}
                </Badge>
                <Badge variant="outline" size="sm">
                  {providerCapabilityLabel(status)}
                </Badge>
              </div>
              <p className="text-muted-foreground text-xs">{status.message}</p>
            </div>
            <div className="text-right text-muted-foreground text-xs">
              {status.activeServerCount} active
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function McpServersSettingsPanel() {
  const queryClient = useQueryClient();
  const projects = useProjects();
  const projectEntries = useMemo(() => projectOptions(projects), [projects]);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const providerNames = useMemo(
    () =>
      new Map(
        providers.map((provider) => [
          provider.instanceId,
          provider.displayName ?? `${provider.driver} (${provider.instanceId})`,
        ]),
      ),
    [providers],
  );
  const servers = usePrimarySettings((settings) => settings.mcp.servers);
  const existingIds = useMemo(() => new Set(servers.map((server) => server.id)), [servers]);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("global");
  const [projectFilterKey, setProjectFilterKey] = useState(() => projectEntries[0]?.key ?? "");
  const selectedFilterProject =
    projectEntries.find((project) => project.key === projectFilterKey) ?? projectEntries[0] ?? null;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<McpServerDraft>(() => emptyDraft(projectEntries));
  const [editorError, setEditorError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [selectedImportSourceIds, setSelectedImportSourceIds] = useState<ReadonlyArray<string>>([]);
  const [importScope, setImportScope] = useState<McpServerScope>("global");
  const [importProjectKey, setImportProjectKey] = useState(() => projectEntries[0]?.key ?? "");
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [deduplicateOnImport, setDeduplicateOnImport] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportJson, setExportJson] = useState(EMPTY_CURSOR_JSON);
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [exportProjectKey, setExportProjectKey] = useState(() => projectEntries[0]?.key ?? "");
  const [includeDisabledExport, setIncludeDisabledExport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const providerStatusQuery = useQuery({
    queryKey: ["mcp", "providerStatus"],
    queryFn: () => ensureLocalApi().mcp.providerStatus(),
  });

  const importSourcesQuery = useQuery({
    queryKey: ["mcp", "importSources"],
    queryFn: () => ensureLocalApi().mcp.discoverImportSources(),
    enabled: importOpen,
  });

  useEffect(() => {
    if (!importOpen || selectedImportSourceIds.length > 0) return;
    const sourceIds =
      importSourcesQuery.data?.sources
        .filter((source) => source.mcpServerCount > 0)
        .map((source) => source.id) ?? [];
    if (sourceIds.length > 0) {
      setSelectedImportSourceIds(sourceIds);
    }
  }, [importOpen, importSourcesQuery.data?.sources, selectedImportSourceIds.length]);

  const visibleServers = useMemo(
    () =>
      servers.filter((server) => {
        if (server.scope !== scopeFilter) return false;
        if (scopeFilter === "global") return true;
        if (!selectedFilterProject) return true;
        return (
          server.projectCwd === selectedFilterProject.cwd ||
          server.projectId === selectedFilterProject.id
        );
      }),
    [scopeFilter, selectedFilterProject, servers],
  );

  const invalidateProviderStatus = () =>
    queryClient.invalidateQueries({ queryKey: ["mcp", "providerStatus"] });

  const upsertMutation = useMutation({
    mutationFn: (input: { readonly mode: EditorMode; readonly server: McpServerDefinition }) =>
      input.mode === "create"
        ? ensureLocalApi().mcp.create({ server: input.server })
        : ensureLocalApi().mcp.update({ server: input.server }),
    onSuccess: (_result, input) => {
      setEditorOpen(false);
      setEditorError(null);
      void invalidateProviderStatus();
      toastManager.add({
        type: "success",
        title: input.mode === "create" ? "MCP server created" : "MCP server updated",
      });
    },
    onError: (error) => {
      setEditorError(errorMessage(error, "Failed to save MCP server."));
    },
  });

  const setEnabledMutation = useMutation({
    mutationFn: (input: { readonly id: McpServerId; readonly enabled: boolean }) =>
      ensureLocalApi().mcp.setEnabled(input),
    onSuccess: () => {
      void invalidateProviderStatus();
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not update MCP server",
        description: errorMessage(error, "Failed to update MCP server."),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (server: McpServerDefinition) => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete MCP server '${server.name}'?`,
      );
      if (!confirmed) return null;
      return ensureLocalApi().mcp.delete({ id: server.id });
    },
    onSuccess: () => {
      void invalidateProviderStatus();
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Could not delete MCP server",
        description: errorMessage(error, "Failed to delete MCP server."),
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: () => {
      const project =
        projectEntries.find((option) => option.key === importProjectKey) ??
        projectEntries[0] ??
        null;
      if (importScope === "project" && !project) {
        throw new Error("Select a project before importing.");
      }
      return ensureLocalApi().mcp.importSources({
        sourceIds: selectedImportSourceIds,
        scope: importScope,
        replace: replaceOnImport,
        deduplicate: deduplicateOnImport,
        ...(importScope === "project" && project
          ? { projectId: project.id, projectCwd: project.cwd }
          : {}),
      });
    },
    onSuccess: () => {
      setImportOpen(false);
      setImportError(null);
      setSelectedImportSourceIds([]);
      void invalidateProviderStatus();
      toastManager.add({ type: "success", title: "MCP servers imported" });
    },
    onError: (error) => {
      setImportError(errorMessage(error, "Failed to import MCP servers."));
    },
  });

  const openCreateDialog = () => {
    setEditorMode("create");
    setOriginalId(null);
    setEditorDraft({
      ...emptyDraft(projectEntries),
      scope: scopeFilter,
      projectKey: selectedFilterProject?.key ?? projectEntries[0]?.key ?? "",
    });
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEditDialog = (server: McpServerDefinition) => {
    setEditorMode("edit");
    setOriginalId(server.id);
    setEditorDraft(draftFromServer(server, projectEntries));
    setEditorError(null);
    setEditorOpen(true);
  };

  const openDuplicateDialog = (server: McpServerDefinition) => {
    setEditorMode("create");
    setOriginalId(null);
    setEditorDraft(duplicateDraftFromServer(server, projectEntries, existingIds));
    setEditorError(null);
    setEditorOpen(true);
  };

  const saveEditorDraft = () => {
    const validationError = validateDraft({
      draft: editorDraft,
      mode: editorMode,
      originalId,
      existingIds,
      projects: projectEntries,
    });
    if (validationError) {
      setEditorError(validationError);
      return;
    }
    setEditorError(null);
    upsertMutation.mutate({
      mode: editorMode,
      server: draftToServer(editorDraft, projectEntries),
    });
  };

  const openImportDialog = () => {
    setSelectedImportSourceIds([]);
    setImportScope(scopeFilter);
    setImportProjectKey(selectedFilterProject?.key ?? projectEntries[0]?.key ?? "");
    setImportError(null);
    setReplaceOnImport(false);
    setDeduplicateOnImport(true);
    setImportOpen(true);
    void importSourcesQuery.refetch();
  };

  const buildExportInput = () => {
    const project =
      projectEntries.find((option) => option.key === exportProjectKey) ?? projectEntries[0] ?? null;
    return {
      includeDisabled: includeDisabledExport,
      ...(exportScope !== "all" ? { scope: exportScope } : {}),
      ...(exportScope === "project" && project
        ? { projectId: project.id, projectCwd: project.cwd }
        : {}),
    };
  };

  const refreshExportJson = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      if (exportScope === "project" && projectEntries.length === 0) {
        throw new Error("Select a project before exporting.");
      }
      const result = await ensureLocalApi().mcp.exportCursorJson(buildExportInput());
      setExportJson(result.json);
    } catch (error) {
      setExportError(errorMessage(error, "Failed to export MCP servers."));
    } finally {
      setIsExporting(false);
    }
  };

  const openExportDialog = () => {
    setExportScope(scopeFilter);
    setExportProjectKey(selectedFilterProject?.key ?? projectEntries[0]?.key ?? "");
    setIncludeDisabledExport(false);
    setExportJson(EMPTY_CURSOR_JSON);
    setExportError(null);
    setExportOpen(true);
    void refreshExportJson();
  };

  const copyExportJson = () => {
    if (!navigator.clipboard?.writeText) {
      setExportError("Clipboard copy is unavailable in this browser.");
      return;
    }
    void navigator.clipboard
      .writeText(exportJson)
      .then(() => {
        toastManager.add({ type: "success", title: "MCP JSON copied" });
      })
      .catch((error: unknown) => {
        setExportError(errorMessage(error, "Failed to copy MCP JSON."));
      });
  };

  return (
    <SettingsPageContainer className="max-w-5xl">
      <SettingsSection
        title="Provider Status"
        headerAction={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh MCP provider status"
            onClick={() => void providerStatusQuery.refetch()}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        }
      >
        <ProviderStatusRows
          statuses={providerStatusQuery.data?.providers ?? []}
          providerNames={providerNames}
          isLoading={providerStatusQuery.isLoading}
        />
      </SettingsSection>

      <SettingsSection
        title="MCP Servers"
        headerAction={
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="outline" onClick={openImportDialog}>
              <UploadIcon className="size-3.5" />
              Import
            </Button>
            <Button size="xs" variant="outline" onClick={openExportDialog}>
              <FileJsonIcon className="size-3.5" />
              Export
            </Button>
            <Button size="xs" onClick={openCreateDialog}>
              <PlusIcon className="size-3.5" />
              New
            </Button>
          </div>
        }
      >
        <div className="border-b border-border/60 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={scopeFilter}
              onValueChange={(value) => setScopeFilter((value ?? "global") as ScopeFilter)}
            >
              <SelectTrigger>
                <SelectValue>{scopeFilter === "global" ? "Global" : "Project"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="project">Project</SelectItem>
              </SelectPopup>
            </Select>
            <Select
              value={selectedFilterProject?.key}
              disabled={scopeFilter !== "project" || projectEntries.length === 0}
              onValueChange={(value) => setProjectFilterKey(value ?? "")}
            >
              <SelectTrigger>
                <SelectValue>{selectedFilterProject?.name ?? "No project"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projectEntries.map((project) => (
                  <SelectItem key={project.key} value={project.key}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
        <div className="divide-y divide-border/60">
          {visibleServers.length === 0 ? (
            <div className="p-5 text-muted-foreground text-sm">No MCP servers in this scope.</div>
          ) : (
            visibleServers.map((server) => {
              const secretCount = serverSecretCount(server);
              return (
                <div
                  key={server.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {server.scope === "global" ? (
                        <Globe2Icon className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          "truncate text-sm font-medium text-foreground",
                          !server.enabled && "text-muted-foreground",
                        )}
                      >
                        {server.name}
                      </span>
                      <Badge variant="outline" size="sm">
                        {transportLabel(server.transport)}
                      </Badge>
                      <Badge variant={server.enabled ? "success" : "outline"} size="sm">
                        {server.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      {secretCount > 0 ? (
                        <Badge variant="secondary" size="sm">
                          {secretCount} value{secretCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-muted-foreground text-xs">
                      {serverSummary(server)}
                    </p>
                    <p className="truncate text-muted-foreground/70 text-[11px]">
                      {scopeLabel(server)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={server.enabled}
                      disabled={setEnabledMutation.isPending}
                      onCheckedChange={(enabled) =>
                        setEnabledMutation.mutate({ id: server.id, enabled: Boolean(enabled) })
                      }
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Duplicate ${server.name}`}
                      onClick={() => openDuplicateDialog(server)}
                    >
                      <CopyIcon className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${server.name}`}
                      onClick={() => openEditDialog(server)}
                    >
                      <Edit3Icon className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={deleteMutation.isPending}
                      aria-label={`Delete ${server.name}`}
                      onClick={() => deleteMutation.mutate(server)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SettingsSection>

      <McpServerEditorDialog
        open={editorOpen}
        mode={editorMode}
        draft={editorDraft}
        projects={projectEntries}
        isSaving={upsertMutation.isPending}
        error={editorError}
        onDraftChange={setEditorDraft}
        onOpenChange={setEditorOpen}
        onSave={saveEditorDraft}
      />
      <McpImportDialog
        open={importOpen}
        projects={projectEntries}
        sources={importSourcesQuery.data?.sources ?? []}
        selectedSourceIds={selectedImportSourceIds}
        isLoadingSources={importSourcesQuery.isLoading}
        isImporting={importMutation.isPending}
        error={importError}
        scope={importScope}
        projectKey={importProjectKey}
        replace={replaceOnImport}
        deduplicate={deduplicateOnImport}
        onSelectedSourceIdsChange={setSelectedImportSourceIds}
        onScopeChange={setImportScope}
        onProjectKeyChange={setImportProjectKey}
        onReplaceChange={setReplaceOnImport}
        onDeduplicateChange={setDeduplicateOnImport}
        onOpenChange={setImportOpen}
        onImport={() => importMutation.mutate()}
      />
      <CursorExportDialog
        open={exportOpen}
        projects={projectEntries}
        isExporting={isExporting}
        error={exportError}
        json={exportJson}
        scope={exportScope}
        projectKey={exportProjectKey}
        includeDisabled={includeDisabledExport}
        onScopeChange={setExportScope}
        onProjectKeyChange={setExportProjectKey}
        onIncludeDisabledChange={setIncludeDisabledExport}
        onOpenChange={setExportOpen}
        onRefresh={() => void refreshExportJson()}
        onCopy={copyExportJson}
      />
    </SettingsPageContainer>
  );
}
