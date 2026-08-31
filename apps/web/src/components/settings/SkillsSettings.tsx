import type { AgentImportSource, SkillDescriptor, SkillMutationScope } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3Icon, PlusIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { usePrimaryEnvironmentId } from "../../state/environments";
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
import { requireSettingsEnvironment, resolveSettingsEnvironmentId } from "./settingsEnvironment";
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
  const translator = useInterfaceTranslator();
  const selected = useMemo(() => new Set(props.selectedSourceIds), [props.selectedSourceIds]);

  if (props.isLoading) {
    return (
      <div className="rounded-md border p-4 text-muted-foreground text-sm">
        {translator.message("settings.skills.scanning")}
      </div>
    );
  }

  if (props.sources.length === 0) {
    return (
      <div className="rounded-md border p-4 text-muted-foreground text-sm">
        {translator.message("settings.skills.noSources")}
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
                {translator.message("settings.skills.skillCount", {
                  count: source.skillCount,
                  formattedCount: translator.number(source.skillCount),
                })}
                {", "}
                {translator.message("settings.skills.mcpCount", {
                  count: source.mcpServerCount,
                  formattedCount: translator.number(source.mcpServerCount),
                })}
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
  const translator = useInterfaceTranslator();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{translator.message("settings.skills.importTitle")}</DialogTitle>
          <DialogDescription>
            {translator.message("settings.skills.importDescription", {
              scope: translator.message(
                props.scope === "global"
                  ? "settings.skills.globalAdjective"
                  : "settings.skills.projectAdjective",
              ),
            })}
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
            {translator.message("settings.skills.deduplicate")}
          </label>
          {props.error ? <p className="text-destructive text-xs">{props.error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            {translator.message("common.cancel")}
          </Button>
          <Button
            disabled={props.isImporting || props.selectedSourceIds.length === 0}
            onClick={props.onImport}
          >
            <UploadIcon className="size-4" />
            {translator.message("settings.skills.import")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function projectKey(project: EnvironmentProject): string {
  return `${project.environmentId}:${project.id}`;
}

function queryKey(input: {
  readonly environmentId: EnvironmentProject["environmentId"] | null;
  readonly projectCwd: string | null;
}) {
  return ["skills", input.environmentId, "settings", input.projectCwd] as const;
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
  const translator = useInterfaceTranslator();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-2">
            <Label>{translator.message("settings.skills.name")}</Label>
            <Input
              value={props.draft.name}
              placeholder="review-follow-up"
              onChange={(event) =>
                props.onDraftChange({ ...props.draft, name: event.currentTarget.value })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>{translator.message("settings.skills.description")}</Label>
            <Input
              value={props.draft.description}
              placeholder={translator.message("settings.skills.descriptionPlaceholder")}
              onChange={(event) =>
                props.onDraftChange({ ...props.draft, description: event.currentTarget.value })
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{translator.message("settings.skills.displayName")}</Label>
              <Input
                value={props.draft.displayName}
                placeholder={translator.message("settings.skills.displayNamePlaceholder")}
                onChange={(event) =>
                  props.onDraftChange({ ...props.draft, displayName: event.currentTarget.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>{translator.message("settings.skills.shortDescription")}</Label>
              <Input
                value={props.draft.shortDescription}
                placeholder={translator.message("settings.skills.shortDescriptionPlaceholder")}
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
            <Label>{translator.message("settings.skills.instructions")}</Label>
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
            {translator.message("common.cancel")}
          </Button>
          <Button disabled={props.isSaving} onClick={props.onSave}>
            {translator.message("settings.skills.save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function SkillsSettingsPanel() {
  const translator = useInterfaceTranslator();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [scope, setScope] = useState<SkillScopeSelection>("global");
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(() =>
    projects[0] ? projectKey(projects[0]) : null,
  );
  const [editingSkill, setEditingSkill] = useState<SkillDescriptor | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedImportSourceIds, setSelectedImportSourceIds] = useState<ReadonlyArray<string>>([]);
  const [deduplicateOnImport, setDeduplicateOnImport] = useState(true);
  const [draft, setDraft] = useState<SkillDraft>(EMPTY_DRAFT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);

  const selectedProject =
    projects.find((project) => projectKey(project) === selectedProjectKey) ?? projects[0] ?? null;
  const selectedProjectCwd = scope === "project" ? (selectedProject?.workspaceRoot ?? null) : null;
  const selectedProjectId = scope === "project" ? (selectedProject?.id ?? null) : null;
  const environmentSelection = {
    primaryEnvironmentId: scope === "global" ? primaryEnvironmentId : null,
    selectedEnvironmentId: scope === "project" ? (selectedProject?.environmentId ?? null) : null,
  };
  const environmentId = resolveSettingsEnvironmentId(environmentSelection);

  const skillsQuery = useQuery({
    queryKey: queryKey({
      environmentId,
      projectCwd: selectedProjectCwd,
    }),
    queryFn: () =>
      requireSettingsEnvironment(environmentSelection).api.skills.list({
        includeBody: true,
        forceReload: true,
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        ...(selectedProjectCwd ? { projectCwd: selectedProjectCwd } : {}),
      }),
    enabled: environmentId !== null,
  });

  const importSourcesQuery = useQuery({
    queryKey: ["skills", environmentId, "importSources"],
    queryFn: () =>
      requireSettingsEnvironment(environmentSelection).api.skills.discoverImportSources(),
    enabled: isImportOpen && environmentId !== null,
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
      queryKey: ["skills", environmentId],
    });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (scope === "project" && (!selectedProjectId || !selectedProjectCwd)) {
        throw new Error(translator.message("settings.skills.selectProjectSave"));
      }
      if (!draft.name.trim() || !draft.description.trim()) {
        throw new Error(translator.message("settings.skills.required"));
      }
      const skillsApi = requireSettingsEnvironment(environmentSelection).api.skills;

      if (!editingSkill) {
        return skillsApi.create({
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
        const renamed = await skillsApi.rename({
          target,
          newName: draft.name,
        });
        target = skillTarget(renamed.skill);
      }
      return skillsApi.update({
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
      setErrorMessage(
        error instanceof Error ? error.message : translator.message("settings.skills.saveFailed"),
      );
    },
  });

  const setEnabledMutation = useMutation({
    mutationFn: (input: { skill: SkillDescriptor; enabled: boolean }) =>
      requireSettingsEnvironment(environmentSelection).api.skills.setEnabled({
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
        throw new Error(translator.message("settings.skills.selectProjectImport"));
      }
      return requireSettingsEnvironment(environmentSelection).api.skills.importSources({
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
      setImportErrorMessage(
        error instanceof Error ? error.message : translator.message("settings.skills.importFailed"),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (skill: SkillDescriptor) => {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        translator.message("settings.skills.deleteConfirm", { skill: skill.name }),
      );
      if (!confirmed) return null;
      return requireSettingsEnvironment(environmentSelection).api.skills.delete({
        target: skillTarget(skill),
      });
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
        title={translator.message("settings.skills.title")}
        headerAction={
          <div className="flex items-center gap-1.5">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => void skillsQuery.refetch()}
              aria-label={translator.message("settings.skills.refresh")}
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
              {translator.message("settings.skills.import")}
            </Button>
            <Button
              size="xs"
              onClick={openCreateDialog}
              disabled={scope === "project" && !selectedProjectCwd}
            >
              <PlusIcon className="size-3.5" />
              {translator.message("settings.skills.new")}
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
                <SelectValue>
                  {translator.message(
                    scope === "global" ? "settings.skills.global" : "settings.skills.project",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="global">
                  {translator.message("settings.skills.global")}
                </SelectItem>
                <SelectItem value="project">
                  {translator.message("settings.skills.project")}
                </SelectItem>
              </SelectPopup>
            </Select>
            <Select
              value={selectedProject ? projectKey(selectedProject) : undefined}
              disabled={scope !== "project" || projects.length === 0}
              onValueChange={(value) => setSelectedProjectKey(value ?? null)}
            >
              <SelectTrigger>
                <SelectValue>
                  {selectedProject?.title ?? translator.message("settings.skills.noProject")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projects.map((project) => (
                  <SelectItem key={projectKey(project)} value={projectKey(project)}>
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
              {translator.message(
                skillsQuery.isLoading ? "settings.skills.loading" : "settings.skills.empty",
              )}
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
                        {translator.message("settings.skills.readOnly")}
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
                    aria-label={translator.message("settings.skills.editAria", {
                      skill: skill.name,
                    })}
                    onClick={() => openEditDialog(skill)}
                  >
                    <Edit3Icon className="size-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={skill.readOnly || deleteMutation.isPending}
                    aria-label={translator.message("settings.skills.deleteAria", {
                      skill: skill.name,
                    })}
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
        title={translator.message(
          editingSkill ? "settings.skills.editTitle" : "settings.skills.newTitle",
        )}
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
