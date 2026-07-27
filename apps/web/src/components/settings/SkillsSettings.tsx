import type {
  AgentImportSource,
  ProjectId,
  SkillDescriptor,
  SkillMutationScope,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3Icon, PlusIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { useProjects } from "../../state/entities";
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
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

type SkillScopeSelection = SkillMutationScope;

interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly body: string;
}

const EMPTY_DRAFT: SkillDraft = {
  name: "",
  description: "",
  displayName: "",
  shortDescription: "",
  body: "",
};

function SkillImportSourceRows(props: {
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
        No agent dotfolders with importable skills were found.
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      {props.sources.map((source) => {
        const disabled = source.skillCount === 0;
        return (
          <label
            key={source.id}
            className={
              disabled
                ? "flex cursor-not-allowed gap-3 border-b p-3 opacity-60 last:border-b-0"
                : "flex cursor-pointer gap-3 border-b p-3 last:border-b-0"
            }
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
                <span className="rounded-sm border px-1.5 py-0.5 text-muted-foreground text-[10px] uppercase">
                  {source.tool}
                </span>
              </span>
              <span className="block truncate text-muted-foreground text-xs">{source.path}</span>
              <span className="block text-muted-foreground text-xs">
                {source.skillCount} skill{source.skillCount === 1 ? "" : "s"},{" "}
                {source.mcpServerCount} MCP server{source.mcpServerCount === 1 ? "" : "s"}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function SkillImportDialog(props: {
  readonly open: boolean;
  readonly scope: SkillMutationScope;
  readonly sources: ReadonlyArray<AgentImportSource>;
  readonly selectedSourceIds: ReadonlyArray<string>;
  readonly isLoadingSources: boolean;
  readonly isImporting: boolean;
  readonly deduplicate: boolean;
  readonly error: string | null;
  readonly onSelectedSourceIdsChange: (sourceIds: ReadonlyArray<string>) => void;
  readonly onDeduplicateChange: (deduplicate: boolean) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImport: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Agent Skills</DialogTitle>
          <DialogDescription>
            Import skills from detected Codex, Cursor, Claude, and OpenCode folders into{" "}
            {props.scope === "global" ? "global" : "project"} skills.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <SkillImportSourceRows
            sources={props.sources}
            selectedSourceIds={props.selectedSourceIds}
            isLoading={props.isLoadingSources}
            onSelectedSourceIdsChange={props.onSelectedSourceIdsChange}
          />
          <label className="flex items-center gap-2 text-muted-foreground text-xs">
            <Switch
              checked={props.deduplicate}
              onCheckedChange={(checked) => props.onDeduplicateChange(Boolean(checked))}
            />
            Deduplicate matching skills
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

function queryKey(input: { readonly projectCwd: string | null }) {
  return ["skills", "settings", input.projectCwd] as const;
}

function draftFromSkill(skill: SkillDescriptor | null): SkillDraft {
  if (!skill) {
    return {
      name: "",
      description: "",
      displayName: "",
      shortDescription: "",
      body: "# Guidance\n\n",
    };
  }
  return {
    name: skill.name,
    description: skill.description ?? "",
    displayName: skill.displayName ?? "",
    shortDescription: skill.shortDescription ?? "",
    body: skill.body ?? "",
  };
}

function skillTarget(skill: SkillDescriptor) {
  return {
    scope: skill.scope,
    name: skill.name,
    path: skill.path,
    ...(skill.projectId ? { projectId: skill.projectId } : {}),
    ...(skill.projectCwd ? { projectCwd: skill.projectCwd } : {}),
  };
}

function SkillEditorDialog(props: {
  readonly open: boolean;
  readonly title: string;
  readonly draft: SkillDraft;
  readonly isSaving: boolean;
  readonly onDraftChange: (draft: SkillDraft) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              value={props.draft.name}
              placeholder="review-follow-up"
              onChange={(event) =>
                props.onDraftChange({ ...props.draft, name: event.currentTarget.value })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Input
              value={props.draft.description}
              placeholder="Use when reviewing follow-up changes."
              onChange={(event) =>
                props.onDraftChange({ ...props.draft, description: event.currentTarget.value })
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Display name</Label>
              <Input
                value={props.draft.displayName}
                placeholder="Review follow-up"
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, displayName: event.currentTarget.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>Short description</Label>
              <Input
                value={props.draft.shortDescription}
                placeholder="Focused review workflow"
                onChange={(event) =>
                  props.onDraftChange({
                    ...props.draft,
                    shortDescription: event.currentTarget.value,
                  })
                }
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Instructions</Label>
            <Textarea
              className="font-mono text-xs"
              value={props.draft.body}
              onChange={(event) =>
                props.onDraftChange({ ...props.draft, body: event.currentTarget.value })
              }
            />
          </div>
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

export function SkillsSettingsPanel() {
  const queryClient = useQueryClient();
  const projects = useProjects();
  const [scope, setScope] = useState<SkillScopeSelection>("global");
  const [projectId, setProjectId] = useState<ProjectId | null>(() => projects[0]?.id ?? null);
  const [editingSkill, setEditingSkill] = useState<SkillDescriptor | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedImportSourceIds, setSelectedImportSourceIds] = useState<ReadonlyArray<string>>([]);
  const [deduplicateOnImport, setDeduplicateOnImport] = useState(true);
  const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);

  const selectedProject =
    projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const selectedProjectCwd = scope === "project" ? (selectedProject?.workspaceRoot ?? null) : null;
  const selectedProjectId = scope === "project" ? (selectedProject?.id ?? null) : null;

  const skillsQuery = useQuery({
    queryKey: queryKey({
      projectCwd: selectedProjectCwd,
    }),
    queryFn: () =>
      ensureLocalApi().skills.list({
        includeBody: true,
        forceReload: true,
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        ...(selectedProjectCwd ? { projectCwd: selectedProjectCwd } : {}),
      }),
  });

  const importSourcesQuery = useQuery({
    queryKey: ["skills", "importSources"],
    queryFn: () => ensureLocalApi().skills.discoverImportSources(),
    enabled: isImportOpen,
  });

  useEffect(() => {
    if (!isImportOpen || selectedImportSourceIds.length > 0) return;
    const sourceIds =
      importSourcesQuery.data?.sources
        .filter((source) => source.skillCount > 0)
        .map((source) => source.id) ?? [];
    if (sourceIds.length > 0) {
      setSelectedImportSourceIds(sourceIds);
    }
  }, [importSourcesQuery.data?.sources, isImportOpen, selectedImportSourceIds.length]);

  const visibleSkills = useMemo(
    () => (skillsQuery.data?.skills ?? []).filter((skill) => skill.scope === scope),
    [scope, skillsQuery.data?.skills],
  );

  const invalidateSkills = () =>
    queryClient.invalidateQueries({
      queryKey: ["skills"],
    });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (scope === "project" && (!selectedProjectId || !selectedProjectCwd)) {
        throw new Error("Select a project before saving a project skill.");
      }
      if (!draft.name.trim() || !draft.description.trim()) {
        throw new Error("Name and description are required.");
      }

      if (!editingSkill) {
        return ensureLocalApi().skills.create({
          scope,
          name: draft.name,
          description: draft.description,
          displayName: draft.displayName,
          shortDescription: draft.shortDescription,
          body: draft.body,
          ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
          ...(selectedProjectCwd ? { projectCwd: selectedProjectCwd } : {}),
        });
      }

      let target = skillTarget(editingSkill);
      if (draft.name.trim() !== editingSkill.name) {
        const renamed = await ensureLocalApi().skills.rename({
          target,
          newName: draft.name,
        });
        target = skillTarget(renamed.skill);
      }
      return ensureLocalApi().skills.update({
        target,
        description: draft.description,
        displayName: draft.displayName,
        shortDescription: draft.shortDescription,
        body: draft.body,
      });
    },
    onSuccess: () => {
      setErrorMessage(null);
      setIsEditorOpen(false);
      setEditingSkill(null);
      setDraft(EMPTY_DRAFT);
      void invalidateSkills();
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save skill.");
    },
  });

  const setEnabledMutation = useMutation({
    mutationFn: (input: { skill: SkillDescriptor; enabled: boolean }) =>
      ensureLocalApi().skills.setEnabled({
        target: skillTarget(input.skill),
        enabled: input.enabled,
      }),
    onSuccess: () => {
      void invalidateSkills();
    },
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (scope === "project" && (!selectedProjectId || !selectedProjectCwd)) {
        throw new Error("Select a project before importing project skills.");
      }
      return ensureLocalApi().skills.importSources({
        sourceIds: selectedImportSourceIds,
        scope,
        deduplicate: deduplicateOnImport,
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        ...(selectedProjectCwd ? { projectCwd: selectedProjectCwd } : {}),
      });
    },
    onSuccess: () => {
      setIsImportOpen(false);
      setSelectedImportSourceIds([]);
      setImportErrorMessage(null);
      void invalidateSkills();
    },
    onError: (error) => {
      setImportErrorMessage(error instanceof Error ? error.message : "Failed to import skills.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (skill: SkillDescriptor) => {
      const confirmed = await ensureLocalApi().dialogs.confirm(`Delete skill '${skill.name}'?`);
      if (!confirmed) return null;
      return ensureLocalApi().skills.delete({ target: skillTarget(skill) });
    },
    onSuccess: () => {
      void invalidateSkills();
    },
  });

  const openCreateDialog = () => {
    setEditingSkill(null);
    setDraft(draftFromSkill(null));
    setErrorMessage(null);
    setIsEditorOpen(true);
  };

  const openEditDialog = (skill: SkillDescriptor) => {
    setEditingSkill(skill);
    setDraft(draftFromSkill(skill));
    setErrorMessage(null);
    setIsEditorOpen(true);
  };

  const openImportDialog = () => {
    setSelectedImportSourceIds([]);
    setDeduplicateOnImport(true);
    setImportErrorMessage(null);
    setIsImportOpen(true);
    void importSourcesQuery.refetch();
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Skills"
        headerAction={
          <div className="flex items-center gap-1.5">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => void skillsQuery.refetch()}
              aria-label="Refresh skills"
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={openImportDialog}
              disabled={scope === "project" && !selectedProjectCwd}
            >
              <UploadIcon className="size-3.5" />
              Import
            </Button>
            <Button
              size="xs"
              onClick={openCreateDialog}
              disabled={scope === "project" && !selectedProjectCwd}
            >
              <PlusIcon className="size-3.5" />
              New
            </Button>
          </div>
        }
      >
        <div className="border-b border-border/60 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={scope}
              onValueChange={(value) => setScope((value ?? "global") as SkillScopeSelection)}
            >
              <SelectTrigger>
                <SelectValue>{scope === "global" ? "Global" : "Project"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="project">Project</SelectItem>
              </SelectPopup>
            </Select>
            <Select
              value={selectedProject?.id}
              disabled={scope !== "project" || projects.length === 0}
              onValueChange={(value) => setProjectId((value as ProjectId | undefined) ?? null)}
            >
              <SelectTrigger>
                <SelectValue>{selectedProject?.title ?? "No project"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projects.map((project) => (
                  <SelectItem key={`${project.environmentId}:${project.id}`} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          {errorMessage ? <p className="mt-3 text-destructive text-xs">{errorMessage}</p> : null}
        </div>
        <div className="divide-y divide-border/60">
          {visibleSkills.length === 0 ? (
            <div className="p-5 text-muted-foreground text-sm">
              {skillsQuery.isLoading ? "Loading skills..." : "No skills in this scope."}
            </div>
          ) : (
            visibleSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{skill.name}</span>
                    {skill.readOnly ? (
                      <span className="rounded-sm border px-1.5 py-0.5 text-muted-foreground text-[10px] uppercase">
                        Read-only
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-muted-foreground text-xs">
                    {skill.shortDescription ?? skill.description ?? skill.path}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={skill.enabled}
                    disabled={setEnabledMutation.isPending}
                    onCheckedChange={(enabled) =>
                      setEnabledMutation.mutate({ skill, enabled: Boolean(enabled) })
                    }
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={skill.readOnly}
                    aria-label={`Edit ${skill.name}`}
                    onClick={() => openEditDialog(skill)}
                  >
                    <Edit3Icon className="size-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={skill.readOnly || deleteMutation.isPending}
                    aria-label={`Delete ${skill.name}`}
                    onClick={() => deleteMutation.mutate(skill)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SettingsSection>

      <SkillEditorDialog
        open={isEditorOpen}
        title={editingSkill ? "Edit skill" : "New skill"}
        draft={draft}
        isSaving={saveMutation.isPending}
        onDraftChange={setDraft}
        onOpenChange={setIsEditorOpen}
        onSave={() => saveMutation.mutate()}
      />
      <SkillImportDialog
        open={isImportOpen}
        scope={scope}
        sources={importSourcesQuery.data?.sources ?? []}
        selectedSourceIds={selectedImportSourceIds}
        isLoadingSources={importSourcesQuery.isLoading}
        isImporting={importMutation.isPending}
        deduplicate={deduplicateOnImport}
        error={importErrorMessage}
        onSelectedSourceIdsChange={setSelectedImportSourceIds}
        onDeduplicateChange={setDeduplicateOnImport}
        onOpenChange={setIsImportOpen}
        onImport={() => importMutation.mutate()}
      />
    </SettingsPageContainer>
  );
}
