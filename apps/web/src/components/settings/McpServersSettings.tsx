import type {
  AgentImportSource,
  McpProviderRouting,
  McpRuntimeAction,
  McpRuntimeServerDetailsResult,
  McpRuntimeServerKey,
  McpSecretValue,
  McpServerDefinition,
  McpServerId,
  McpServerScope,
  McpServerTransport,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { mcpRuntimeSelectorKey, mcpRuntimeServerDetailsKey } from "@t3tools/client-runtime/mcp";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Cause from "effect/Cause";
import {
  CopyIcon,
  FileJsonIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useServerConfigs } from "../../state/entities";
import { agentSettingsEnvironment } from "../../state/agentSettings";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
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
import { McpProviderWorkspace } from "./McpProviderWorkspace";
import { McpScopeFilterControls } from "./McpScopeFilterControls";
import {
  type McpConfiguredServerView,
  type McpRuntimeDetailsTarget,
  mcpRuntimeContextId,
  toMcpRuntimeContextView,
  toMcpRuntimeServerView,
} from "../mcp-management/mcpManagementView";
import { useMcpManagementRuntime } from "../mcp-management/mcpManagementRuntime";
import { deriveMcpManagementSummary } from "../mcp-management/mcpManagementSummary";
import {
  deriveMcpProviderTabs,
  isMcpServerEnabledForProvider,
  mcpMutationToastPresentation,
  type McpSettingsSearch,
} from "./McpServersSettings.logic";
import { requireSettingsEnvironment, resolveSettingsEnvironmentId } from "./settingsEnvironment";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const MCP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MCP_ENV_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MCP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MCP_HTTP_URL_PATTERN = /^https?:\/\/.+/i;
const EMPTY_CURSOR_JSON = '{\n  "mcpServers": {}\n}';

export type ScopeFilter = McpServerScope;
export type ExportScope = "all" | McpServerScope;
export type EditorMode = "create" | "edit";

export interface ProjectOption {
  readonly key: string;
  readonly id: EnvironmentProject["id"];
  readonly cwd: string;
  readonly name: string;
  readonly environmentId: EnvironmentProject["environmentId"];
}

export interface SecretEntryDraft {
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

export interface McpServerDraft {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly providerRouting: McpProviderRouting;
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

export function emptyDraft(
  projects: ReadonlyArray<ProjectOption>,
  providerInstanceId?: ProviderInstanceId | string,
): McpServerDraft {
  return {
    id: "",
    name: "",
    enabled: true,
    providerRouting: providerInstanceId
      ? { mode: "selected", instanceIds: [providerInstanceId as ProviderInstanceId] }
      : { mode: "all" },
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

export function draftFromServer(
  server: McpServerDefinition,
  projects: ReadonlyArray<ProjectOption>,
): McpServerDraft {
  const base = {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    providerRouting: server.providerRouting,
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

export function duplicateDraftFromServer(
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

export function draftToServer(
  draft: McpServerDraft,
  projects: ReadonlyArray<ProjectOption>,
): McpServerDefinition {
  const id = (draft.id.trim() || normalizeServerId(draft.name)) as McpServerId;
  const project = selectedProject(draft, projects);
  const base = {
    id,
    name: draft.name.trim(),
    enabled: draft.enabled,
    providerRouting: draft.providerRouting,
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

export function validateDraft(input: {
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
  if (
    input.draft.providerRouting.mode === "selected" &&
    input.draft.providerRouting.instanceIds.length === 0
  ) {
    return "Select at least one provider account, or enable this server for all accounts.";
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

export function McpServerEditorDialog(props: {
  readonly open: boolean;
  readonly mode: EditorMode;
  readonly draft: McpServerDraft;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly providers: ReturnType<typeof deriveMcpProviderTabs>;
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
            <div className="flex items-center justify-between gap-3">
              <Label>Enable for</Label>
              <label className="flex items-center gap-2 text-muted-foreground text-xs">
                <Checkbox
                  checked={props.draft.providerRouting.mode === "all"}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      props.onDraftChange({
                        ...props.draft,
                        providerRouting: { mode: "all" },
                      });
                      return;
                    }
                    props.onDraftChange({
                      ...props.draft,
                      providerRouting: { mode: "selected", instanceIds: [] },
                    });
                  }}
                />
                All provider accounts
              </label>
            </div>
            {props.draft.providerRouting.mode === "selected" ? (
              <div className="grid gap-2 rounded-lg border border-border/60 bg-background/35 p-3 sm:grid-cols-2">
                {props.providers.map((provider) => {
                  const selected =
                    props.draft.providerRouting.mode === "selected"
                      ? props.draft.providerRouting.instanceIds.some(
                          (instanceId) => instanceId === provider.instanceId,
                        )
                      : true;
                  return (
                    <label key={provider.instanceId} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) => {
                          if (props.draft.providerRouting.mode !== "selected") return;
                          const next = new Set(props.draft.providerRouting.instanceIds);
                          if (checked) next.add(provider.instanceId as ProviderInstanceId);
                          else next.delete(provider.instanceId as ProviderInstanceId);
                          props.onDraftChange({
                            ...props.draft,
                            providerRouting: { mode: "selected", instanceIds: [...next] },
                          });
                        }}
                      />
                      <span className="truncate">{provider.label}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                This server will be available to every configured provider that supports MCP.
              </p>
            )}
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

export function McpImportDialog(props: {
  readonly open: boolean;
  readonly projects: ReadonlyArray<ProjectOption>;
  readonly sources: ReadonlyArray<AgentImportSource>;
  readonly selectedSourceIds: ReadonlyArray<string>;
  readonly isLoadingSources: boolean;
  readonly isImporting: boolean;
  readonly error: string | null;
  readonly scope: McpServerScope;
  readonly projectKey: string;
  readonly providers: ReturnType<typeof deriveMcpProviderTabs>;
  readonly providerRouting: McpProviderRouting;
  readonly replace: boolean;
  readonly deduplicate: boolean;
  readonly onSelectedSourceIdsChange: (sourceIds: ReadonlyArray<string>) => void;
  readonly onScopeChange: (scope: McpServerScope) => void;
  readonly onProjectKeyChange: (projectKey: string) => void;
  readonly onProviderRoutingChange: (routing: McpProviderRouting) => void;
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
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Enable imported servers for</Label>
              <label className="flex items-center gap-2 text-muted-foreground text-xs">
                <Checkbox
                  checked={props.providerRouting.mode === "all"}
                  onCheckedChange={(checked) =>
                    props.onProviderRoutingChange(
                      checked ? { mode: "all" } : { mode: "selected", instanceIds: [] },
                    )
                  }
                />
                All accounts
              </label>
            </div>
            {props.providerRouting.mode === "selected" ? (
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {props.providers.map((provider) => (
                  <label key={provider.instanceId} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={
                        props.providerRouting.mode === "selected" &&
                        props.providerRouting.instanceIds.some((id) => id === provider.instanceId)
                      }
                      onCheckedChange={(checked) => {
                        if (props.providerRouting.mode !== "selected") return;
                        const ids = new Set(props.providerRouting.instanceIds);
                        if (checked) ids.add(provider.instanceId as ProviderInstanceId);
                        else ids.delete(provider.instanceId as ProviderInstanceId);
                        props.onProviderRoutingChange({ mode: "selected", instanceIds: [...ids] });
                      }}
                    />
                    <span className="truncate">{provider.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
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

export function CursorExportDialog(props: {
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
          <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
            This export contains the servers enabled for the selected provider account. Cursor JSON
            does not preserve T3 provider assignments.
          </p>
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

export function McpServersSettingsPanel(props: {
  readonly search?: McpSettingsSearch;
  readonly embedded?: boolean;
  readonly showRuntimeSelector?: boolean;
  readonly onProviderChange?: (providerInstanceId: ProviderInstanceId) => void;
}) {
  const runRuntimeDetailsQuery = useAtomQueryRunner(
    agentSettingsEnvironment.mcp.runtimeServerDetailsQuery,
    { reportFailure: false },
  );
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectEntries = useMemo(() => projectOptions(projects), [projects]);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("global");
  const [projectFilterKey, setProjectFilterKey] = useState(() => projectEntries[0]?.key ?? "");
  const selectedFilterProject =
    projectEntries.find((project) => project.key === projectFilterKey) ?? projectEntries[0] ?? null;
  const deepLinkedEnvironmentId = useMemo(
    () =>
      [...serverConfigs.keys()].find(
        (environmentId) => String(environmentId) === props.search?.environment,
      ) ?? null,
    [props.search?.environment, serverConfigs],
  );
  const filterEnvironmentSelection = {
    primaryEnvironmentId:
      deepLinkedEnvironmentId === null && scopeFilter === "global" ? primaryEnvironmentId : null,
    selectedEnvironmentId:
      deepLinkedEnvironmentId ??
      (scopeFilter === "project" ? (selectedFilterProject?.environmentId ?? null) : null),
  };
  const filterEnvironmentId = resolveSettingsEnvironmentId(filterEnvironmentSelection);
  const filterEnvironment = useEnvironment(filterEnvironmentId);
  const authorizationAvailable = filterEnvironment?.entry.target._tag === "PrimaryConnectionTarget";
  const mcpApi =
    filterEnvironmentId === null
      ? null
      : requireSettingsEnvironment(filterEnvironmentSelection).api.mcp;
  const selectedServerConfig =
    filterEnvironmentId === null ? undefined : serverConfigs.get(filterEnvironmentId);
  const providers = selectedServerConfig?.providers ?? [];
  const providerStatusQuery = useQuery({
    queryKey: ["mcp", filterEnvironmentId, "provider-status"],
    queryFn: () => mcpApi!.providerStatus({}),
    enabled: mcpApi !== null,
    staleTime: 30_000,
    retry: false,
  });
  const providerCapabilities = useMemo(
    () =>
      new Map(
        (providerStatusQuery.data?.providers ?? []).map((status) => [
          String(status.instanceId),
          status.capability,
        ]),
      ),
    [providerStatusQuery.data?.providers],
  );
  const providerTabs = useMemo(
    () =>
      deriveMcpProviderTabs(
        providers.map((provider) => {
          const mcpCapability = providerCapabilities.get(String(provider.instanceId));
          return {
            ...provider,
            ...(mcpCapability ? { mcpCapability } : {}),
          };
        }),
      ),
    [providerCapabilities, providers],
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    props.search?.provider ?? null,
  );
  const appliedProviderDeepLinkRef = useRef<string | null>(null);
  const selectedProvider =
    providerTabs.find((provider) => provider.instanceId === selectedProviderId) ??
    providerTabs[0] ??
    null;
  const selectedProviderInstanceId = selectedProvider?.instanceId as ProviderInstanceId | undefined;
  const servers = selectedServerConfig?.settings.mcp.servers ?? [];
  const existingIds = useMemo(() => new Set(servers.map((server) => server.id)), [servers]);
  const appliedServerDeepLinkRef = useRef<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [originalId, setOriginalId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<McpServerDraft>(() =>
    emptyDraft(projectEntries, props.search?.provider),
  );
  const [editorError, setEditorError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [selectedImportSourceIds, setSelectedImportSourceIds] = useState<ReadonlyArray<string>>([]);
  const [importScope, setImportScope] = useState<McpServerScope>("global");
  const [importProviderRouting, setImportProviderRouting] = useState<McpProviderRouting>(() =>
    props.search?.provider
      ? { mode: "selected", instanceIds: [props.search.provider as ProviderInstanceId] }
      : { mode: "all" },
  );
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

  const selectedImportProject =
    projectEntries.find((project) => project.key === importProjectKey) ?? projectEntries[0] ?? null;
  const importEnvironmentSelection = {
    primaryEnvironmentId:
      deepLinkedEnvironmentId === null && importScope === "global" ? primaryEnvironmentId : null,
    selectedEnvironmentId:
      deepLinkedEnvironmentId ??
      (importScope === "project" ? (selectedImportProject?.environmentId ?? null) : null),
  };
  const importEnvironmentId = resolveSettingsEnvironmentId(importEnvironmentSelection);

  const [selectedRuntimeContextId, setSelectedRuntimeContextId] = useState<string | null>(null);
  const runtimeState = useMcpManagementRuntime({
    enabled: true,
    environmentId: filterEnvironmentId,
    providerInstanceId: selectedProviderInstanceId,
    workspaceVersion: selectedServerConfig?.environment.capabilities.mcpWorkspaceVersion,
    selectedContextId: selectedRuntimeContextId,
    ...(props.search?.thread ? { preferredThreadId: props.search.thread } : {}),
    ...(props.search?.runtime ? { preferredRuntimeSessionId: props.search.runtime } : {}),
  });
  const runtimeApiSupported = runtimeState.supported;
  const runtimeContexts = runtimeState.contexts;
  const deepLinkedRuntimeContext = runtimeContexts.find(
    (context) =>
      String(context.threadId) === props.search?.thread &&
      String(context.runtimeSessionId) === props.search?.runtime,
  );
  const appliedRuntimeDeepLinkRef = useRef<string | null>(null);
  const selectedRuntimeContext = runtimeState.selectedContext;
  const [runtimeDetails, setRuntimeDetails] = useState<
    ReadonlyMap<string, McpRuntimeServerDetailsResult>
  >(() => new Map());
  const [loadingRuntimeDetails, setLoadingRuntimeDetails] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const currentRuntimeSelectorKeyRef = useRef<string | null>(null);
  currentRuntimeSelectorKeyRef.current =
    filterEnvironmentId && selectedProviderInstanceId && selectedRuntimeContext
      ? mcpRuntimeSelectorKey({
          environmentId: filterEnvironmentId,
          providerInstanceId: selectedProviderInstanceId,
          threadId: selectedRuntimeContext.threadId,
          runtimeSessionId: selectedRuntimeContext.runtimeSessionId,
        })
      : null;
  const sessionAccessQuery = useEnvironmentQuery(
    filterEnvironmentId === null
      ? null
      : agentSettingsEnvironment.mcp.sessionAccess({
          environmentId: filterEnvironmentId,
          input: {},
        }),
  );
  const readOnly =
    sessionAccessQuery.data?.scopes !== undefined &&
    !sessionAccessQuery.data.scopes.includes("orchestration:operate");

  const importSourcesQuery = useQuery({
    queryKey: ["mcp", importEnvironmentId, "importSources"],
    queryFn: () =>
      requireSettingsEnvironment(importEnvironmentSelection).api.mcp.discoverImportSources(),
    enabled: importOpen && importEnvironmentId !== null,
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

  useEffect(() => {
    if (
      props.search?.provider &&
      props.search.provider !== appliedProviderDeepLinkRef.current &&
      providerTabs.some((provider) => provider.instanceId === props.search?.provider)
    ) {
      appliedProviderDeepLinkRef.current = props.search.provider;
      setSelectedProviderId(props.search.provider);
    }
  }, [props.search?.provider, providerTabs]);

  useEffect(() => {
    if (selectedProvider && selectedProvider.instanceId !== selectedProviderId) {
      setSelectedProviderId(selectedProvider.instanceId);
    }
  }, [selectedProvider, selectedProviderId]);

  useEffect(() => {
    const serverKey = props.search?.server;
    if (!serverKey || appliedServerDeepLinkRef.current === serverKey) return;
    const server = servers.find((candidate) => candidate.id === serverKey);
    if (!server) return;
    appliedServerDeepLinkRef.current = serverKey;
    setScopeFilter(server.scope);
    if (server.scope === "project") {
      const project = projectEntries.find(
        (candidate) => candidate.cwd === server.projectCwd || candidate.id === server.projectId,
      );
      if (project) setProjectFilterKey(project.key);
    }
  }, [projectEntries, props.search?.server, servers]);

  useEffect(() => {
    if (!deepLinkedRuntimeContext) return;
    const deepLinkKey = `${props.search?.thread ?? ""}:${props.search?.runtime ?? ""}`;
    if (deepLinkKey === appliedRuntimeDeepLinkRef.current) return;
    appliedRuntimeDeepLinkRef.current = deepLinkKey;
    setSelectedRuntimeContextId(mcpRuntimeContextId(deepLinkedRuntimeContext));
    setRuntimeDetails(new Map());
    setLoadingRuntimeDetails(new Set());
  }, [deepLinkedRuntimeContext, props.search?.runtime, props.search?.thread]);

  useEffect(() => {
    if (!selectedRuntimeContext) return;
    const nextId = mcpRuntimeContextId(selectedRuntimeContext);
    if (nextId !== selectedRuntimeContextId) setSelectedRuntimeContextId(nextId);
  }, [selectedRuntimeContext, selectedRuntimeContextId]);

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

  const upsertMutation = useMutation({
    mutationFn: (input: {
      readonly environmentId: ProjectOption["environmentId"];
      readonly mode: EditorMode;
      readonly server: McpServerDefinition;
    }) => {
      const mcpApi = requireSettingsEnvironment({
        primaryEnvironmentId: null,
        selectedEnvironmentId: input.environmentId,
      }).api.mcp;
      return input.mode === "create"
        ? mcpApi.create({ server: input.server })
        : mcpApi.update({ server: input.server });
    },
    onSuccess: (result, input) => {
      setEditorOpen(false);
      setEditorError(null);
      toastManager.add(
        mcpMutationToastPresentation(
          result,
          input.mode === "create" ? "MCP server created" : "MCP server updated",
        ),
      );
    },
    onError: (error) => {
      setEditorError(errorMessage(error, "Failed to save MCP server."));
    },
  });

  const setProviderEnabledMutation = useMutation({
    mutationFn: (input: {
      readonly environmentId: ProjectOption["environmentId"];
      readonly serverId: McpServerId;
      readonly providerInstanceId: ProviderInstanceId;
      readonly enabled: boolean;
    }) =>
      requireSettingsEnvironment({
        primaryEnvironmentId: null,
        selectedEnvironmentId: input.environmentId,
      }).api.mcp.setProviderEnabled({
        serverId: input.serverId,
        providerInstanceId: input.providerInstanceId,
        enabled: input.enabled,
      }),
    onSuccess: (result) => {
      toastManager.add(mcpMutationToastPresentation(result, "MCP assignment updated"));
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
    mutationFn: async (input: {
      readonly environmentId: ProjectOption["environmentId"];
      readonly server: McpServerDefinition;
    }) => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete MCP server '${input.server.name}'?`,
      );
      if (!confirmed) return null;
      return requireSettingsEnvironment({
        primaryEnvironmentId: null,
        selectedEnvironmentId: input.environmentId,
      }).api.mcp.delete({ id: input.server.id });
    },
    onSuccess: (result) => {
      if (result) toastManager.add(mcpMutationToastPresentation(result, "MCP server deleted"));
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
    mutationFn: (input: {
      readonly environmentId: ProjectOption["environmentId"];
      readonly project: ProjectOption | null;
    }) =>
      requireSettingsEnvironment({
        primaryEnvironmentId: null,
        selectedEnvironmentId: input.environmentId,
      }).api.mcp.importSources({
        sourceIds: selectedImportSourceIds,
        providerRouting: importProviderRouting,
        scope: importScope,
        replace: replaceOnImport,
        deduplicate: deduplicateOnImport,
        ...(importScope === "project" && input.project
          ? { projectId: input.project.id, projectCwd: input.project.cwd }
          : {}),
      }),
    onSuccess: (result) => {
      setImportOpen(false);
      setImportError(null);
      setSelectedImportSourceIds([]);
      toastManager.add(mcpMutationToastPresentation(result, "MCP servers imported"));
    },
    onError: (error) => {
      setImportError(errorMessage(error, "Failed to import MCP servers."));
    },
  });

  const openCreateDialog = () => {
    setEditorMode("create");
    setOriginalId(null);
    setEditorDraft({
      ...emptyDraft(projectEntries, selectedProviderInstanceId),
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
    const project = selectedProject(editorDraft, projectEntries);
    let environmentId: ProjectOption["environmentId"];
    try {
      environmentId = requireSettingsEnvironment({
        primaryEnvironmentId:
          deepLinkedEnvironmentId === null && editorDraft.scope === "global"
            ? primaryEnvironmentId
            : null,
        selectedEnvironmentId:
          deepLinkedEnvironmentId ??
          (editorDraft.scope === "project" ? (project?.environmentId ?? null) : null),
      }).environmentId;
    } catch (error) {
      setEditorError(errorMessage(error, "No environment is available."));
      return;
    }
    setEditorError(null);
    upsertMutation.mutate({
      environmentId,
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
    setImportProviderRouting(
      selectedProviderInstanceId
        ? { mode: "selected", instanceIds: [selectedProviderInstanceId] }
        : { mode: "all" },
    );
    setImportOpen(true);
  };

  const startImport = () => {
    if (
      importProviderRouting.mode === "selected" &&
      importProviderRouting.instanceIds.length === 0
    ) {
      setImportError("Select at least one provider account for imported MCP servers.");
      return;
    }
    if (importScope === "project" && !selectedImportProject) {
      setImportError("Select a project before importing.");
      return;
    }
    if (importEnvironmentId === null) {
      setImportError("No environment is available for this import.");
      return;
    }
    importMutation.mutate({
      environmentId: importEnvironmentId,
      project: selectedImportProject,
    });
  };

  const buildExportInput = (input: {
    readonly scope: ExportScope;
    readonly project: ProjectOption | null;
    readonly includeDisabled: boolean;
  }) => {
    return {
      includeDisabled: input.includeDisabled,
      ...(input.scope !== "all" ? { scope: input.scope } : {}),
      ...(input.scope === "project" && input.project
        ? { projectId: input.project.id, projectCwd: input.project.cwd }
        : {}),
    };
  };

  const refreshExportJson = async (
    input: {
      readonly scope: ExportScope;
      readonly projectKey: string;
      readonly includeDisabled: boolean;
    } = {
      scope: exportScope,
      projectKey: exportProjectKey,
      includeDisabled: includeDisabledExport,
    },
  ) => {
    setIsExporting(true);
    setExportError(null);
    try {
      const project =
        projectEntries.find((option) => option.key === input.projectKey) ??
        projectEntries[0] ??
        null;
      if (input.scope === "project" && !project) {
        throw new Error("Select a project before exporting.");
      }
      const target = requireSettingsEnvironment({
        primaryEnvironmentId:
          deepLinkedEnvironmentId === null && input.scope !== "project"
            ? primaryEnvironmentId
            : null,
        selectedEnvironmentId:
          deepLinkedEnvironmentId ??
          (input.scope === "project" ? (project?.environmentId ?? null) : null),
      });
      const result = await target.api.mcp.exportCursorJson({
        ...buildExportInput({
          scope: input.scope,
          project,
          includeDisabled: input.includeDisabled,
        }),
        ...(selectedProviderInstanceId ? { providerInstanceId: selectedProviderInstanceId } : {}),
      });
      setExportJson(result.json);
    } catch (error) {
      setExportError(errorMessage(error, "Failed to export MCP servers."));
    } finally {
      setIsExporting(false);
    }
  };

  const openExportDialog = () => {
    const projectKey = selectedFilterProject?.key ?? projectEntries[0]?.key ?? "";
    setExportScope(scopeFilter);
    setExportProjectKey(projectKey);
    setIncludeDisabledExport(false);
    setExportJson(EMPTY_CURSOR_JSON);
    setExportError(null);
    setExportOpen(true);
    void refreshExportJson({
      scope: scopeFilter,
      projectKey,
      includeDisabled: false,
    });
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

  const runtimeActionMutation = useMutation({
    mutationFn: (input: {
      readonly action: McpRuntimeAction;
      readonly selectorKey: string;
      readonly target: McpRuntimeDetailsTarget;
    }) =>
      requireSettingsEnvironment({
        primaryEnvironmentId: null,
        selectedEnvironmentId: input.target.environmentId,
      }).api.mcp.runtimeAction({
        providerInstanceId: input.target.providerInstanceId,
        threadId: input.target.threadId,
        runtimeSessionId: input.target.runtimeSessionId,
        providerKey: input.target.providerKey,
        action: input.action,
      }),
    onSuccess: (result, input) => {
      if (currentRuntimeSelectorKeyRef.current !== input.selectorKey) return;
      if (result.authorizationUrl) {
        void ensureLocalApi()
          .shell.openExternal(result.authorizationUrl)
          .catch((error: unknown) => {
            toastManager.add({
              type: "error",
              title: "Could not open authorization",
              description: errorMessage(error, "Open the authorization URL on the host."),
            });
          });
      }
      if (result.message) {
        toastManager.add({ type: result.accepted ? "success" : "info", title: result.message });
      }
    },
    onError: (error, input) => {
      if (currentRuntimeSelectorKeyRef.current !== input.selectorKey) return;
      toastManager.add({
        type: "error",
        title: "MCP action failed",
        description: errorMessage(error, "The provider could not perform this action."),
      });
    },
  });

  const loadRuntimeServerDetails = async (serverKey: string) => {
    if (!filterEnvironmentId || !selectedRuntimeContext || !selectedProviderInstanceId) return;
    const target = {
      environmentId: filterEnvironmentId,
      providerInstanceId: selectedProviderInstanceId,
      threadId: selectedRuntimeContext.threadId,
      runtimeSessionId: selectedRuntimeContext.runtimeSessionId,
      providerKey: serverKey as McpRuntimeServerKey,
    };
    const selectorKey = mcpRuntimeSelectorKey(target);
    const detailsKey = mcpRuntimeServerDetailsKey(target);
    if (loadingRuntimeDetails.has(detailsKey)) return;
    setLoadingRuntimeDetails((current) => new Set(current).add(detailsKey));
    try {
      const result = await runRuntimeDetailsQuery({
        environmentId: target.environmentId,
        input: {
          providerInstanceId: target.providerInstanceId,
          threadId: target.threadId,
          runtimeSessionId: target.runtimeSessionId,
          providerKey: target.providerKey,
        },
      });
      if (result._tag === "Failure") throw Cause.squash(result.cause);
      if (currentRuntimeSelectorKeyRef.current !== selectorKey) return;
      setRuntimeDetails((current) => new Map(current).set(detailsKey, result.value));
    } catch (error) {
      if (currentRuntimeSelectorKeyRef.current !== selectorKey) return;
      toastManager.add({
        type: "error",
        title: "Could not load MCP inventory",
        description: errorMessage(error, "The provider did not return server details."),
      });
    } finally {
      setLoadingRuntimeDetails((current) => {
        const next = new Set(current);
        next.delete(detailsKey);
        return next;
      });
    }
  };

  const configuredServerViews: ReadonlyArray<McpConfiguredServerView> = visibleServers.map(
    (server) => ({
      id: String(server.id),
      name: server.name,
      enabledForProvider:
        selectedProviderInstanceId && selectedProvider?.supportsUserMcp
          ? isMcpServerEnabledForProvider(server, selectedProviderInstanceId)
          : false,
      globallyEnabled: server.enabled,
      globalScope: server.scope === "global",
      scopeLabel: scopeLabel(server),
      transport: transportLabel(server.transport),
      summary: serverSummary(server),
      secretCount: serverSecretCount(server),
    }),
  );
  const runtimeServerViews =
    runtimeState.snapshot?.servers.map((server) => {
      const detailsKey =
        filterEnvironmentId && selectedProviderInstanceId && selectedRuntimeContext
          ? mcpRuntimeServerDetailsKey({
              environmentId: filterEnvironmentId,
              providerInstanceId: selectedProviderInstanceId,
              threadId: selectedRuntimeContext.threadId,
              runtimeSessionId: selectedRuntimeContext.runtimeSessionId,
              providerKey: server.providerKey,
            })
          : null;
      return toMcpRuntimeServerView(
        server,
        detailsKey ? runtimeDetails.get(detailsKey) : undefined,
        detailsKey ? loadingRuntimeDetails.has(detailsKey) : false,
        authorizationAvailable,
      );
    }) ?? [];
  const managementSummary = deriveMcpManagementSummary({
    applicableConfiguredCount: configuredServerViews.filter(
      (server) => server.globallyEnabled && server.enabledForProvider,
    ).length,
    runtimeSupported: runtimeApiSupported,
    snapshot: runtimeState.snapshot,
  });
  const selectedContextView = selectedRuntimeContext
    ? toMcpRuntimeContextView(selectedRuntimeContext)
    : undefined;
  const runtimeContextViews = runtimeContexts.map(toMcpRuntimeContextView);
  const displayedRuntimeContexts =
    selectedRuntimeContextId &&
    !runtimeContextViews.some((context) => context.id === selectedRuntimeContextId)
      ? [
          ...runtimeContextViews,
          {
            id: selectedRuntimeContextId,
            runtimeSessionId: selectedRuntimeContextId,
            threadId: selectedRuntimeContextId,
            label: "Ended or unavailable session",
            live: false,
          },
        ]
      : runtimeContextViews;

  return (
    <SettingsPageContainer
      className={cn("max-w-5xl", props.embedded && "max-w-none gap-3 p-0 sm:p-0")}
      {...(props.embedded ? { viewportClassName: "overflow-visible p-0 sm:p-0" } : {})}
    >
      <SettingsSection
        title="MCP Servers"
        headerAction={
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="outline" disabled={readOnly} onClick={openImportDialog}>
              <UploadIcon className="size-3.5" />
              Import
            </Button>
            <Button size="xs" variant="outline" onClick={openExportDialog}>
              <FileJsonIcon className="size-3.5" />
              Export
            </Button>
            <Button size="xs" disabled={readOnly} onClick={openCreateDialog}>
              <PlusIcon className="size-3.5" />
              New
            </Button>
          </div>
        }
      >
        <div className="mb-3 px-1">
          <McpScopeFilterControls
            scope={scopeFilter}
            projectKey={selectedFilterProject?.key ?? ""}
            projects={projectEntries}
            onScopeChange={setScopeFilter}
            onProjectKeyChange={setProjectFilterKey}
          />
        </div>
        <McpProviderWorkspace
          providers={providerTabs}
          selectedProviderId={selectedProvider?.instanceId ?? null}
          contexts={displayedRuntimeContexts}
          selectedContextId={selectedContextView?.id ?? selectedRuntimeContextId}
          configuredServers={configuredServerViews}
          runtimeServers={runtimeServerViews}
          runtimeSummary={managementSummary}
          runtimeSupported={runtimeApiSupported}
          embedded={props.embedded === true}
          {...(runtimeState.contextError || runtimeState.runtimeError
            ? {
                runtimeError:
                  runtimeState.contextError ??
                  runtimeState.runtimeError ??
                  "MCP runtime status could not be loaded.",
              }
            : {})}
          providerAssignmentsSupported={selectedProvider?.supportsUserMcp ?? false}
          showProviderTabs={!props.embedded}
          showRuntimeSelector={props.showRuntimeSelector ?? !props.embedded}
          readOnly={readOnly}
          isLoadingRuntime={runtimeState.isLoading}
          {...(props.search?.server ? { focusedServerKey: props.search.server } : {})}
          pendingProviderServerIds={
            setProviderEnabledMutation.isPending
              ? new Set([String(setProviderEnabledMutation.variables.serverId)])
              : new Set()
          }
          pendingRuntimeAction={
            runtimeActionMutation.isPending
              ? {
                  serverKey: String(runtimeActionMutation.variables.target.providerKey),
                  action: runtimeActionMutation.variables.action,
                }
              : null
          }
          onSelectProvider={(providerId) => {
            setSelectedProviderId(providerId);
            setSelectedRuntimeContextId(null);
            setRuntimeDetails(new Map());
            setLoadingRuntimeDetails(new Set());
            props.onProviderChange?.(providerId as ProviderInstanceId);
          }}
          onSelectContext={(contextId) => {
            setSelectedRuntimeContextId(contextId);
            setRuntimeDetails(new Map());
            setLoadingRuntimeDetails(new Set());
          }}
          onToggleProviderServer={(serverId, enabled) => {
            if (filterEnvironmentId === null || !selectedProviderInstanceId) return;
            setProviderEnabledMutation.mutate({
              environmentId: filterEnvironmentId,
              serverId: serverId as McpServerId,
              providerInstanceId: selectedProviderInstanceId,
              enabled,
            });
          }}
          onEditServer={(serverId) => {
            const server = visibleServers.find((candidate) => candidate.id === serverId);
            if (server) openEditDialog(server);
          }}
          onDuplicateServer={(serverId) => {
            const server = visibleServers.find((candidate) => candidate.id === serverId);
            if (server) openDuplicateDialog(server);
          }}
          onDeleteServer={(serverId) => {
            const server = visibleServers.find((candidate) => candidate.id === serverId);
            if (!server || filterEnvironmentId === null) return;
            deleteMutation.mutate({ environmentId: filterEnvironmentId, server });
          }}
          onRuntimeAction={(serverKey, action) => {
            if (!filterEnvironmentId || !selectedRuntimeContext || !selectedProviderInstanceId) {
              return;
            }
            const target = {
              environmentId: filterEnvironmentId,
              providerInstanceId: selectedProviderInstanceId,
              threadId: selectedRuntimeContext.threadId,
              runtimeSessionId: selectedRuntimeContext.runtimeSessionId,
              providerKey: serverKey as McpRuntimeServerKey,
            };
            runtimeActionMutation.mutate({
              action,
              selectorKey: mcpRuntimeSelectorKey(target),
              target,
            });
          }}
          onLoadServerDetails={(serverKey) => void loadRuntimeServerDetails(serverKey)}
        />
      </SettingsSection>

      <McpServerEditorDialog
        open={editorOpen}
        mode={editorMode}
        draft={editorDraft}
        projects={projectEntries}
        providers={providerTabs}
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
        providers={providerTabs}
        providerRouting={importProviderRouting}
        replace={replaceOnImport}
        deduplicate={deduplicateOnImport}
        onSelectedSourceIdsChange={setSelectedImportSourceIds}
        onScopeChange={setImportScope}
        onProjectKeyChange={setImportProjectKey}
        onProviderRoutingChange={setImportProviderRouting}
        onReplaceChange={setReplaceOnImport}
        onDeduplicateChange={setDeduplicateOnImport}
        onOpenChange={setImportOpen}
        onImport={startImport}
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
