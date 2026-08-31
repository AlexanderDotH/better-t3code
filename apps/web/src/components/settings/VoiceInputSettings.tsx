import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ProjectSpeechProfile } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveVoiceTranslationModelSelection } from "@t3tools/shared/serverSettings";
import {
  ChevronDownIcon,
  FolderSearchIcon,
  MicIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createBasicProjectSpeechProfileForEnvironment,
  indexProjectSpeechProfileForEnvironment,
  listProjectSpeechProfilesForEnvironment,
} from "../../environmentApi";
import {
  usePrimarySettings,
  useUpdateClientSettings,
  useUpdatePrimarySettings,
} from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { cn } from "../../lib/utils";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const EMPTY_SECRET_VALUE = { value: "", valueRedacted: false };
const EMPTY_PROFILES: ReadonlyMap<ProjectId, ProjectSpeechProfile> = new Map();

type EnvironmentProfileState = {
  readonly status: "loading" | "ready" | "error";
  readonly profiles: ReadonlyMap<ProjectId, ProjectSpeechProfile>;
};

type ProjectAction = "index" | "basic";
type ProfileStatus = "not-indexed" | "indexed" | "basic" | "unavailable";

function projectKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return JSON.stringify([environmentId, projectId]);
}

function formatUpdatedAt(value: string, format: (date: Date) => string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date);
}

function profileStatus(
  environmentState: EnvironmentProfileState | undefined,
  profile: ProjectSpeechProfile | undefined,
): ProfileStatus {
  if (environmentState?.status === "error") return "unavailable";
  if (profile?.source === "indexed") return "indexed";
  if (profile?.source === "basic") return "basic";
  return environmentState?.status === "ready" ? "not-indexed" : "unavailable";
}

function ProfileStatusBadge({ status }: { readonly status: ProfileStatus }) {
  const translate = useInterfaceTranslator().message;
  const variant =
    status === "indexed"
      ? "success"
      : status === "basic"
        ? "info"
        : status === "unavailable"
          ? "warning"
          : "outline";
  const messageId =
    status === "not-indexed"
      ? "settings.voice.profile.status.notIndexed"
      : status === "indexed"
        ? "settings.voice.profile.status.indexed"
        : status === "basic"
          ? "settings.voice.profile.status.basic"
          : "settings.voice.profile.status.unavailable";

  return (
    <Badge variant={variant} size="sm">
      {translate(messageId)}
    </Badge>
  );
}

function ProfilePayload({ profile }: { readonly profile: ProjectSpeechProfile }) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h5 className="text-xs font-medium text-foreground">
          {translate("settings.voice.profile.prompt")}
        </h5>
        <pre className="whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 font-sans text-xs leading-relaxed text-foreground">
          {profile.contextPrompt}
        </pre>
      </div>

      <div className="space-y-1.5">
        <h5 className="text-xs font-medium text-foreground">
          {translate("settings.voice.profile.keyterms")}
        </h5>
        {profile.keyterms.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.keyterms.map((keyterm) => (
              <Badge key={keyterm} variant="outline">
                {keyterm}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {translate("settings.voice.profile.noKeyterms")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <h5 className="text-xs font-medium text-foreground">
          {translate("settings.voice.profile.technologies")}
        </h5>
        {profile.technologies.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {profile.technologies.map((technology) => (
              <Badge key={technology} variant="secondary">
                {technology}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {translate("settings.voice.profile.noTechnologies")}
          </p>
        )}
      </div>

      {profile.warning ? (
        <p className="flex items-start gap-1.5 text-xs text-warning" role="status">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{profile.warning}</span>
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        {translate("settings.voice.profile.updated")}{" "}
        <time dateTime={profile.updatedAt}>
          {formatUpdatedAt(profile.updatedAt, (date) =>
            translator.date(date, { timeStyle: "short" }),
          )}
        </time>
      </p>
    </div>
  );
}

function ProjectSpeechProfileRow({
  project,
  environmentState,
  open,
  busyAction,
  actionError,
  onOpenChange,
  onIndex,
  onUseBasicContext,
}: {
  readonly project: EnvironmentProject;
  readonly environmentState: EnvironmentProfileState | undefined;
  readonly open: boolean;
  readonly busyAction: ProjectAction | undefined;
  readonly actionError: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onIndex: () => void;
  readonly onUseBasicContext: () => void;
}) {
  const translate = useInterfaceTranslator().message;
  const profile =
    environmentState?.status === "error" ? undefined : environmentState?.profiles.get(project.id);
  const status = profileStatus(environmentState, profile);
  const isBusy = busyAction !== undefined;
  const reindex = profile?.source === "indexed";
  const indexLabel = translate(
    reindex ? "settings.voice.profile.reindex" : "settings.voice.profile.index",
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="border-t border-border/60 first:border-t-0">
        <CollapsibleTrigger
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5"
          aria-label={translate("settings.voice.profile.toggle", { project: project.title })}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                {project.title}
              </span>
              <ProfileStatusBadge status={status} />
              {environmentState?.status === "loading" ? (
                <Spinner className="size-3.5 text-muted-foreground" />
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground/80">{project.workspaceRoot}</p>
          </div>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>

        {actionError ? (
          <p className="px-4 pb-3 text-xs text-destructive sm:px-5" role="alert">
            {actionError}
          </p>
        ) : null}

        <CollapsiblePanel>
          <div className="space-y-4 border-t border-border/60 px-4 py-4 sm:px-5">
            {environmentState?.status === "error" ? (
              <p className="text-xs text-muted-foreground">
                {translate("settings.voice.profile.unavailable")}
              </p>
            ) : profile ? (
              <ProfilePayload profile={profile} />
            ) : environmentState?.status === "ready" ? (
              <p className="text-xs text-muted-foreground">
                {translate("settings.voice.profile.missing")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {translate("settings.voice.profile.loading")}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={isBusy}
                aria-busy={busyAction === "index"}
                aria-label={translate("settings.voice.profile.indexAria", {
                  action: indexLabel,
                  project: project.title,
                })}
                onClick={onIndex}
              >
                {busyAction === "index" ? <Spinner className="size-3.5" /> : null}
                {busyAction === "index"
                  ? translate(
                      reindex
                        ? "settings.voice.profile.reindexing"
                        : "settings.voice.profile.indexing",
                    )
                  : indexLabel}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isBusy || profile?.source === "basic"}
                aria-busy={busyAction === "basic"}
                aria-label={translate("settings.voice.profile.basicAria", {
                  project: project.title,
                })}
                onClick={onUseBasicContext}
              >
                {busyAction === "basic" ? <Spinner className="size-3.5" /> : null}
                {busyAction === "basic"
                  ? translate("settings.voice.profile.creating")
                  : translate("settings.voice.profile.basic")}
              </Button>
            </div>
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

export function VoiceInputSettings() {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const updateClientSettings = useUpdateClientSettings();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const assemblyAiApiKey = settings.speechTranscription.assemblyAi.apiKey;
  const assemblyAiApiKeyConfigured =
    assemblyAiApiKey.value.trim().length > 0 || Boolean(assemblyAiApiKey.valueRedacted);
  const defaultModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const resolvedVoiceTranslationModelSelection = resolveVoiceTranslationModelSelection(
    settings,
    serverProviders,
  );
  const voiceTranslationModelSelection =
    resolvedVoiceTranslationModelSelection === settings.textGenerationModelSelection
      ? defaultModelSelection
      : resolvedVoiceTranslationModelSelection;
  const modelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    voiceTranslationModelSelection.instanceId,
    voiceTranslationModelSelection.model,
  );
  const [profileStateByEnvironment, setProfileStateByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, EnvironmentProfileState>
  >(() => new Map());
  const [expandedProjectKeys, setExpandedProjectKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busyActionByProject, setBusyActionByProject] = useState<
    Readonly<Record<string, ProjectAction | undefined>>
  >({});
  const [actionErrorByProject, setActionErrorByProject] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const profileRequestSequenceByEnvironment = useRef(new Map<EnvironmentId, number>());

  const projectEnvironmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))].toSorted(),
    [projects],
  );

  const projectGroups = useMemo(() => {
    const environmentLabels = new Map(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );
    const projectsByEnvironment = new Map<EnvironmentId, EnvironmentProject[]>();

    for (const project of projects) {
      const environmentProjects = projectsByEnvironment.get(project.environmentId) ?? [];
      environmentProjects.push(project);
      projectsByEnvironment.set(project.environmentId, environmentProjects);
    }

    return [...projectsByEnvironment.entries()]
      .map(([environmentId, environmentProjects]) => ({
        environmentId,
        label: environmentLabels.get(environmentId) ?? String(environmentId),
        projects: environmentProjects.toSorted((left, right) =>
          left.title.localeCompare(right.title),
        ),
      }))
      .toSorted(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          String(left.environmentId).localeCompare(String(right.environmentId)),
      );
  }, [environments, projects]);

  const refreshEnvironmentProfiles = useCallback(async (environmentId: EnvironmentId) => {
    const requestSequence =
      (profileRequestSequenceByEnvironment.current.get(environmentId) ?? 0) + 1;
    profileRequestSequenceByEnvironment.current.set(environmentId, requestSequence);
    setProfileStateByEnvironment((current) => {
      const next = new Map(current);
      next.set(environmentId, {
        status: "loading",
        profiles: current.get(environmentId)?.profiles ?? EMPTY_PROFILES,
      });
      return next;
    });

    try {
      const result = await listProjectSpeechProfilesForEnvironment(environmentId);
      if (profileRequestSequenceByEnvironment.current.get(environmentId) !== requestSequence)
        return;
      const profiles = new Map(result.profiles.map((profile) => [profile.projectId, profile]));
      setProfileStateByEnvironment((current) => {
        const next = new Map(current);
        next.set(environmentId, { status: "ready", profiles });
        return next;
      });
    } catch {
      if (profileRequestSequenceByEnvironment.current.get(environmentId) !== requestSequence)
        return;
      setProfileStateByEnvironment((current) => {
        const next = new Map(current);
        next.set(environmentId, { status: "error", profiles: EMPTY_PROFILES });
        return next;
      });
    }
  }, []);

  const refreshProfiles = useCallback(async () => {
    await Promise.all(
      projectEnvironmentIds.map((environmentId) => refreshEnvironmentProfiles(environmentId)),
    );
  }, [projectEnvironmentIds, refreshEnvironmentProfiles]);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const setProjectExpanded = useCallback((key: string, open: boolean) => {
    setExpandedProjectKeys((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const runProjectAction = useCallback(
    async (project: EnvironmentProject, action: ProjectAction) => {
      const key = projectKey(project.environmentId, project.id);
      setBusyActionByProject((current) => ({ ...current, [key]: action }));
      setActionErrorByProject((current) => ({ ...current, [key]: undefined }));

      try {
        if (action === "index") {
          await indexProjectSpeechProfileForEnvironment(project.environmentId, project.id);
        } else {
          await createBasicProjectSpeechProfileForEnvironment(project.environmentId, project.id);
        }
        await refreshEnvironmentProfiles(project.environmentId);
      } catch {
        setActionErrorByProject((current) => ({
          ...current,
          [key]:
            action === "index"
              ? translate("settings.voice.profile.indexFailed")
              : translate("settings.voice.profile.basicFailed"),
        }));
      } finally {
        setBusyActionByProject((current) => ({ ...current, [key]: undefined }));
      }
    },
    [refreshEnvironmentProfiles, translate],
  );

  const isRefreshing = projectEnvironmentIds.some(
    (environmentId) => profileStateByEnvironment.get(environmentId)?.status === "loading",
  );

  return (
    <>
      <SettingsSection
        title={translate("settings.voice.title")}
        icon={<MicIcon className="size-3.5" />}
      >
        <SettingsRow
          title={translate("settings.voice.apiKey.title")}
          description={translate("settings.voice.apiKey.description")}
          status={translate(
            assemblyAiApiKeyConfigured
              ? "settings.voice.apiKey.configured"
              : "settings.voice.apiKey.missing",
          )}
          resetAction={
            assemblyAiApiKeyConfigured ? (
              <SettingResetButton
                label={translate("settings.voice.apiKey.title")}
                onClick={() =>
                  updateSettings({
                    speechTranscription: {
                      assemblyAi: {
                        apiKey: EMPTY_SECRET_VALUE,
                      },
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              className="w-full sm:w-72"
              nativeInput
              type="password"
              value={assemblyAiApiKey.value}
              placeholder={
                assemblyAiApiKey.valueRedacted
                  ? translate("settings.voice.apiKey.saved")
                  : "aai_..."
              }
              autoComplete="off"
              spellCheck={false}
              aria-label={translate("settings.voice.apiKey.title")}
              onCommit={(value) =>
                updateSettings({
                  speechTranscription: {
                    assemblyAi: {
                      apiKey: { value, valueRedacted: false },
                    },
                  },
                })
              }
            />
          }
        />
        <SettingsRow
          title={translate("settings.voice.output.title")}
          description={translate("settings.voice.output.description")}
          control={
            <Select
              value={settings.voiceInputOutputLanguage}
              onValueChange={(value) => {
                if (value === "native" || value === "english") {
                  updateClientSettings({ voiceInputOutputLanguage: value });
                }
              }}
            >
              <SelectTrigger
                className="w-full sm:w-44"
                aria-label={translate("settings.voice.output.aria")}
              >
                <SelectValue>
                  {translate(
                    settings.voiceInputOutputLanguage === "native"
                      ? "settings.voice.output.native"
                      : "settings.voice.output.english",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end">
                <SelectItem value="native">{translate("settings.voice.output.native")}</SelectItem>
                <SelectItem value="english">
                  {translate("settings.voice.output.english")}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title={translate("settings.voice.model.title")}
          description={translate("settings.voice.model.description")}
          resetAction={
            settings.voiceTranslationModelSelection !== null ? (
              <SettingResetButton
                label={translate("settings.voice.model.resetLabel")}
                onClick={() => updateSettings({ voiceTranslationModelSelection: null })}
              />
            ) : null
          }
          control={
            <ProviderModelPicker
              activeInstanceId={voiceTranslationModelSelection.instanceId}
              model={voiceTranslationModelSelection.model}
              lockedProvider={null}
              instanceEntries={modelInstanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              triggerVariant="outline"
              triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
              triggerAriaLabel={translate("settings.voice.model.title")}
              onInstanceModelChange={(instanceId, model) =>
                updateSettings({
                  voiceTranslationModelSelection: createModelSelection(instanceId, model),
                })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title={translate("settings.voice.context.title")}
        icon={<FolderSearchIcon className="size-3.5" />}
        headerAction={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={translate("settings.voice.context.refresh")}
            disabled={projectEnvironmentIds.length === 0}
            onClick={() => void refreshProfiles()}
          >
            <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
          </Button>
        }
      >
        {projectGroups.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-5">
            {translate("settings.voice.context.noProjects")}
          </div>
        ) : (
          projectGroups.map((group) => {
            const environmentState = profileStateByEnvironment.get(group.environmentId);
            return (
              <div key={group.environmentId} className="border-t border-border/60 first:border-t-0">
                <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-2.5 sm:px-5">
                  <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/60">
                    {group.label}
                  </h3>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {translate("settings.voice.context.projectCount", {
                      count: group.projects.length,
                    })}
                  </span>
                </div>
                {environmentState?.status === "error" ? (
                  <p
                    className="border-t border-border/60 px-4 py-2 text-xs text-destructive sm:px-5"
                    role="alert"
                  >
                    {translate("settings.voice.context.environmentUnavailable")}
                  </p>
                ) : null}
                <div className="border-t border-border/60">
                  {group.projects.map((project) => {
                    const key = projectKey(project.environmentId, project.id);
                    return (
                      <ProjectSpeechProfileRow
                        key={key}
                        project={project}
                        environmentState={environmentState}
                        open={expandedProjectKeys.has(key)}
                        busyAction={busyActionByProject[key]}
                        actionError={actionErrorByProject[key]}
                        onOpenChange={(open) => setProjectExpanded(key, open)}
                        onIndex={() => void runProjectAction(project, "index")}
                        onUseBasicContext={() => void runProjectAction(project, "basic")}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </SettingsSection>
    </>
  );
}
