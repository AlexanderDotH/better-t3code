import { useStableCallback } from "../../hooks/useStableCallback";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveAssemblyAiVoiceSettings,
  type AssemblyAiVoiceSettings,
  type EnvironmentId,
  type ProjectId,
  type ProjectSpeechProfile,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveVoiceTranslationModelSelection } from "@t3tools/shared/serverSettings";
import { ChevronDownIcon, MicIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { toastManager } from "../ui/toast";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { cn } from "../../lib/utils";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { Spinner } from "../ui/spinner";
import {
  SettingResetButton,
  SettingsRow,
  SettingsSearchTarget,
  SettingsSection,
} from "./settingsLayout";
import { BetterT3SettingsSubgroup } from "./BetterT3SettingsSubgroup";
import { BetterT3SettingsSearchItems } from "./BetterT3SettingsSearch";
import { AssemblyAiVoiceSettingsForm } from "./AssemblyAiVoiceSettingsForm";

const EMPTY_SECRET_VALUE = { value: "", valueRedacted: false };

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

      <p className="text-2xs text-muted-foreground">
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
  disabled,
  onOpenChange,
  onIndex,
  onUseBasicContext,
  voiceSettings,
}: {
  readonly project: EnvironmentProject;
  readonly environmentState: EnvironmentProfileState | undefined;
  readonly open: boolean;
  readonly busyAction: ProjectAction | undefined;
  readonly actionError: string | undefined;
  readonly disabled: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onIndex: () => void;
  readonly onUseBasicContext: () => void;
  readonly voiceSettings?: ReactNode;
}) {
  const translate = useInterfaceTranslator().message;
  const profile =
    environmentState?.status === "error" ? undefined : environmentState?.profiles.get(project.id);
  const status = profileStatus(environmentState, profile);
  const isBusy = busyAction !== undefined || environmentState?.status === "loading";
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
              <span className="voice-input-project-title truncate font-semibold text-foreground">
                {project.title}
              </span>
              <ProfileStatusBadge status={status} />
              {environmentState?.status === "loading" ? <Spinner className="size-3.5" /> : null}
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
                disabled={disabled || isBusy}
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
                disabled={disabled || isBusy || profile?.source === "basic"}
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
            {voiceSettings}
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

export function VoiceInputSettings({
  environmentId,
  disabled,
  accessSettings,
  translationSettings,
  transcriptTransferSettings,
}: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly accessSettings?: ReactNode;
  readonly translationSettings?: ReactNode;
  readonly transcriptTransferSettings?: ReactNode;
}) {
  const translator = useInterfaceTranslator();
  const translate = translator.message;
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const indexProfile = useAtomCommand(serverEnvironment.indexProjectSpeechProfile, {
    reportFailure: false,
  });
  const createBasicProfile = useAtomCommand(serverEnvironment.createBasicProjectSpeechProfile, {
    reportFailure: false,
  });
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const supportsOptions =
    config?.environment.capabilities.supportsSpeechDictationProcessing === true;
  const assemblyAi = settings.speechTranscription.assemblyAi;
  const registry = useContext(RegistryContext);
  const modelsQuery = useEnvironmentQuery(
    supportsOptions && !disabled
      ? serverEnvironment.assemblyAiModelsQuery({ environmentId, input: {} })
      : null,
  );
  const models = modelsQuery.data?.models ?? [];
  const modelsState = modelsQuery.error ? "error" : modelsQuery.isPending ? "loading" : "ready";
  const [projectSettingsBusy, setProjectSettingsBusy] = useState<ProjectId | null>(null);
  const [projectSettingsError, setProjectSettingsError] = useState<ProjectId | null>(null);

  const persistAssemblyAiKey = async (apiKey: { value: string; valueRedacted: boolean }) => {
    const result = await saveSettings({
      environmentId,
      input: { patch: { speechTranscription: { assemblyAi: { apiKey } } } },
    });
    if (result._tag === "Success") modelsQuery.refresh();
    else toastManager.add({ type: "error", title: "Could not save AssemblyAI credentials" });
  };

  const persistVoiceOptions = useStableCallback(
    async (voice: AssemblyAiVoiceSettings | null, projectId?: ProjectId): Promise<boolean> => {
      if (disabled || !supportsOptions) return false;
      const result = await saveSettings({
        environmentId,
        input: {
          patch: {
            speechTranscription: {
              assemblyAi: projectId
                ? { projectOverrides: { [projectId]: voice } }
                : { voice: voice ?? assemblyAi.voice },
            },
          },
        },
      });
      return result._tag === "Success";
    },
  );

  const changeProjectOverride = async (
    projectId: ProjectId,
    voice: AssemblyAiVoiceSettings | null,
  ) => {
    setProjectSettingsBusy(projectId);
    setProjectSettingsError(null);
    await Promise.resolve()
      .then(() => persistVoiceOptions(voice, projectId))
      .then((saved) => {
        if (!saved) setProjectSettingsError(projectId);
      })
      .catch(() => setProjectSettingsError(projectId))
      .finally(() => setProjectSettingsBusy(null));
  };
  const allProjects = useProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  const { environments } = useEnvironments();
  const serverProviders = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? [];
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
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings, null),
  );
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    voiceTranslationModelSelection.instanceId,
    voiceTranslationModelSelection.model,
    "text-generation",
  );
  const savedTranslationSelection = settings.voiceTranslationModelSelection;
  const savedTranslationModel = savedTranslationSelection
    ? modelOptionsByInstance
        .get(savedTranslationSelection.instanceId)
        ?.find((model) => model.slug === savedTranslationSelection.model)
    : undefined;
  const savedTranslationProvider = modelInstanceEntries.find(
    (entry) => entry.instanceId === savedTranslationSelection?.instanceId,
  );
  const translationSummary = [
    translate(
      settings.voiceInputOutputLanguage === "english"
        ? "settings.betterT3.value.english"
        : "settings.betterT3.value.nativeLanguage",
    ),
    savedTranslationSelection === null
      ? translate("settings.betterT3.value.automatic")
      : (savedTranslationModel?.name ?? savedTranslationSelection.model),
    ...(disabled
      ? [translate("settings.betterT3.noEnvironment")]
      : savedTranslationSelection &&
          (!savedTranslationModel ||
            savedTranslationModel.isUnavailable ||
            !savedTranslationProvider ||
            !isProviderInstancePickerReady(savedTranslationProvider))
        ? [translate("settings.betterT3.value.unavailable")]
        : []),
  ].join(" · ");
  const cleanupModelPicker = {
    fallbackSelection: defaultModelSelection,
    instanceEntries: modelInstanceEntries,
    optionsByInstance: getCustomModelOptionsByInstance(
      settings,
      serverProviders,
      undefined,
      undefined,
      "text-generation",
    ),
  };
  const profilesQuery = useEnvironmentQuery(
    !disabled ? serverEnvironment.projectSpeechProfilesQuery({ environmentId, input: {} }) : null,
  );
  const profileStateByEnvironment = new Map<EnvironmentId, EnvironmentProfileState>([
    [
      environmentId,
      {
        status:
          disabled || profilesQuery.error ? "error" : profilesQuery.isPending ? "loading" : "ready",
        profiles: new Map(
          (profilesQuery.data?.profiles ?? []).map((profile) => [profile.projectId, profile]),
        ),
      },
    ],
  ]);
  const [expandedProjectKeys, setExpandedProjectKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [busyActionByProject, setBusyActionByProject] = useState<
    Readonly<Record<string, ProjectAction | undefined>>
  >({});
  const [actionErrorByProject, setActionErrorByProject] = useState<
    Readonly<Record<string, string | undefined>>
  >({});

  const projectEnvironmentIds = [
    ...new Set(projects.map((project) => project.environmentId)),
  ].toSorted();

  const projectGroups = (() => {
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
  })();

  const refreshEnvironmentProfiles = (targetEnvironmentId: EnvironmentId) => {
    registry.refresh(
      serverEnvironment.projectSpeechProfilesQuery({
        environmentId: targetEnvironmentId,
        input: {},
      }),
    );
  };
  const refreshProfiles = () => {
    for (const targetEnvironmentId of projectEnvironmentIds)
      refreshEnvironmentProfiles(targetEnvironmentId);
  };

  const setProjectExpanded = useStableCallback((key: string, open: boolean) => {
    setExpandedProjectKeys((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  });

  const runProjectAction = useStableCallback(
    async (project: EnvironmentProject, action: ProjectAction) => {
      const key = projectKey(project.environmentId, project.id);
      setBusyActionByProject((current) => ({ ...current, [key]: action }));
      setActionErrorByProject((current) => ({ ...current, [key]: undefined }));

      await Promise.resolve()
        .then(() =>
          (action === "index" ? indexProfile : createBasicProfile)({
            environmentId: project.environmentId,
            input: { projectId: project.id },
          }),
        )
        .then((response) => {
          if (response._tag === "Failure") throw squashAtomCommandFailure(response);
          refreshEnvironmentProfiles(project.environmentId);
        })
        .catch(() => {
          setActionErrorByProject((current) => ({
            ...current,
            [key]:
              action === "index"
                ? translate("settings.voice.profile.indexFailed")
                : translate("settings.voice.profile.basicFailed"),
          }));
        })
        .finally(() => {
          setBusyActionByProject((current) => ({ ...current, [key]: undefined }));
        });
    },
  );

  const isRefreshing = projectEnvironmentIds.some(
    (environmentId) => profileStateByEnvironment.get(environmentId)?.status === "loading",
  );

  return (
    <>
      <SettingsSection
        id="voice-input"
        title={translate("settings.voice.title")}
        icon={<MicIcon className="size-3.5" />}
      >
        <BetterT3SettingsSearchItems
          items={[
            {
              id: "voice-translation-model",
              targetId: "voice-translation-model",
              to: "/settings/better-t3",
              title: translate("settings.voice.model.title"),
              description: translate("settings.voice.model.description"),
              category: translate("settings.voice.title"),
            },
          ]}
        />
        <BetterT3SettingsSubgroup groupId="voice-access" hideTitle={!accessSettings}>
          {accessSettings}
          <SettingsRow
            id="voice.credentials"
            data-better-t3-feature="voice.credentials"
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
                  disabled={disabled}
                  onClick={() => void persistAssemblyAiKey(EMPTY_SECRET_VALUE)}
                />
              ) : null
            }
            control={
              <DraftInput
                disabled={disabled}
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
                onCommit={(value) => void persistAssemblyAiKey({ value, valueRedacted: false })}
              />
            }
          />
        </BetterT3SettingsSubgroup>
        <BetterT3SettingsSubgroup groupId="voice-translation" summary={translationSummary}>
          {translationSettings}
          <SettingsRow
            id="voice-translation-model"
            title={translate("settings.voice.model.title")}
            description={translate("settings.voice.model.description")}
            resetAction={
              settings.voiceTranslationModelSelection !== null ? (
                <SettingResetButton
                  label={translate("settings.voice.model.resetLabel")}
                  disabled={disabled}
                  onClick={() => updateSettings({ voiceTranslationModelSelection: null })}
                />
              ) : null
            }
            control={
              <ProviderModelPicker
                environmentId={environmentId}
                disabled={disabled}
                activeInstanceId={voiceTranslationModelSelection.instanceId}
                model={voiceTranslationModelSelection.model}
                lockedProvider={null}
                instanceEntries={modelInstanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                modelSelectionPurpose="text-generation"
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
        </BetterT3SettingsSubgroup>
        <SettingsSearchTarget id="voice-recording-options">
          {supportsOptions ? (
            <>
              <AssemblyAiVoiceSettingsForm
                environmentId={environmentId}
                key={`${environmentId}:${JSON.stringify(assemblyAi.voice)}`}
                value={assemblyAi.voice}
                models={models}
                modelsState={modelsState}
                t3Models={cleanupModelPicker}
                disabled={disabled}
                onSave={(voice) => persistVoiceOptions(voice)}
              />
              {modelsState !== "ready" ? (
                <div className="space-y-2 px-4 pb-4 text-xs text-muted-foreground" role="status">
                  <p>
                    {translate(
                      modelsState === "loading"
                        ? "settings.voice.options.modelsLoading"
                        : "settings.voice.options.modelsFailed",
                    )}
                  </p>
                  {modelsState === "error" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={modelsQuery.refresh}
                    >
                      {translate("settings.voice.options.modelsRetry")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="px-4 py-4 text-xs text-muted-foreground">
              {translate("settings.voice.options.unsupported")}
            </p>
          )}
        </SettingsSearchTarget>

        <BetterT3SettingsSubgroup groupId="voice-project-context">
          <SettingsSearchTarget id="project-speech-context">
            <div className="flex justify-end px-3 pt-2 sm:px-4">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={translate("settings.voice.context.refresh")}
                disabled={disabled || projectEnvironmentIds.length === 0}
                onClick={() => void refreshProfiles()}
              >
                <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
              </Button>
            </div>
            {projectGroups.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-5">
                {translate("settings.voice.context.noProjects")}
              </div>
            ) : (
              projectGroups.map((group) => {
                const environmentState = profileStateByEnvironment.get(group.environmentId);
                return (
                  <div
                    key={group.environmentId}
                    className="border-t border-border/60 first:border-t-0"
                  >
                    <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-2.5 sm:px-5">
                      <h3 className="voice-input-environment-title truncate text-2xs font-semibold uppercase text-foreground/60">
                        {group.label}
                      </h3>
                      <span className="shrink-0 text-2xs text-muted-foreground">
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
                            disabled={disabled}
                            project={project}
                            environmentState={environmentState}
                            open={expandedProjectKeys.has(key)}
                            busyAction={busyActionByProject[key]}
                            actionError={actionErrorByProject[key]}
                            onOpenChange={(open) => setProjectExpanded(key, open)}
                            onIndex={() => void runProjectAction(project, "index")}
                            onUseBasicContext={() => void runProjectAction(project, "basic")}
                            voiceSettings={
                              supportsOptions ? (
                                <div className="space-y-3 border-t border-border/60 pt-4">
                                  <h4 className="text-sm font-medium">
                                    {translate("settings.voice.options.project")}
                                  </h4>
                                  {assemblyAi.projectOverrides[project.id] ? (
                                    <>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={disabled || projectSettingsBusy !== null}
                                        onClick={() => void changeProjectOverride(project.id, null)}
                                      >
                                        {translate("settings.voice.options.inherit")}
                                      </Button>
                                      <AssemblyAiVoiceSettingsForm
                                        environmentId={environmentId}
                                        key={JSON.stringify(
                                          assemblyAi.projectOverrides[project.id],
                                        )}
                                        value={resolveAssemblyAiVoiceSettings(
                                          assemblyAi,
                                          project.id,
                                        )}
                                        grouped={false}
                                        models={models}
                                        modelsState={modelsState}
                                        t3Models={cleanupModelPicker}
                                        disabled={disabled || projectSettingsBusy !== null}
                                        onSave={(voice) => persistVoiceOptions(voice, project.id)}
                                      />
                                    </>
                                  ) : (
                                    <>
                                      <p className="text-xs text-muted-foreground">
                                        {translate("settings.voice.options.inherited")}
                                      </p>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={disabled || projectSettingsBusy !== null}
                                        onClick={() =>
                                          void changeProjectOverride(project.id, assemblyAi.voice)
                                        }
                                      >
                                        {translate("settings.voice.options.override")}
                                      </Button>
                                    </>
                                  )}
                                  {projectSettingsError === project.id ? (
                                    <p role="alert" className="text-xs text-destructive">
                                      {translate("settings.voice.options.saveFailed")}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </SettingsSearchTarget>
        </BetterT3SettingsSubgroup>
        {transcriptTransferSettings ? (
          <BetterT3SettingsSubgroup groupId="voice-transcript-transfer" hideTitle>
            {transcriptTransferSettings}
          </BetterT3SettingsSubgroup>
        ) : null}
      </SettingsSection>
    </>
  );
}
