import {
  projectIndexingDefaultsSupported,
  projectIndexingSupported,
} from "@t3tools/client-runtime/project-indexing";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ProjectIndexModelSelection,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { isElectron } from "../../env";
import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironment, type EnvironmentPresentation } from "../../state/environments";
import { bindProjectIndexApi } from "../../state/projectIndexing";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { useSettingsCommand, useSettingsMutation } from "../settings/useSettingsMutation";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { ProjectIndexModelPicker } from "./ProjectIndexModelPicker";
import { ProjectIndexingSettingsSection } from "./ProjectIndexingSettingsSection";
import { useProjectIndexModelCheck } from "./useProjectIndexModelCheck";

type DefaultsPatch = Pick<
  ServerSettingsPatch,
  "projectIndexingEnabled" | "projectIndexingDefaultModelSelection"
>;

function ProjectIndexDefaultsForm({
  environment,
  canOperate,
}: {
  readonly environment: EnvironmentPresentation;
  readonly canOperate: boolean;
}) {
  const { message } = useInterfaceTranslator();
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(environment.environmentId);
  const saveSettings = useSettingsCommand(serverEnvironment.updateSettings);
  const [error, setError] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const api = bindProjectIndexApi(environment.environmentId);
  const selection = settings.projectIndexingDefaultModelSelection;
  const checkModel = useCallback(
    (modelSelection: ProjectIndexModelSelection) => api.checkModel({ modelSelection }),
    [api],
  );
  const check = useProjectIndexModelCheck(checkModel, selection, checkAttempt);
  const save = useSettingsMutation({
    mutationFn: (patch: DefaultsPatch) =>
      saveSettings({ environmentId: environment.environmentId, input: { patch } }),
    onMutate: () => setError(null),
    onError: (failure) => setError(failure instanceof Error ? failure.message : String(failure)),
  });
  const update = (patch: DefaultsPatch) => {
    if (canOperate) save.mutate(patch);
  };
  const modelStatus =
    selection === null
      ? message("projectIndexing.noDefaultModel")
      : check === null
        ? message("projectIndexing.checkingModel")
        : check.supported
          ? null
          : (check.reason ?? message("projectIndexing.modelUnsupported"));

  return (
    <div className="space-y-6">
      <SettingsSection
        id="knowledge.projectIndexingMaster"
        title={message("projectIndexing.globalTitle")}
      >
        {!canOperate ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
            {message("projectIndexing.readOnly")}
          </p>
        ) : null}
        <SettingsRow
          title={message("projectIndexing.masterEnabled")}
          description={message("projectIndexing.masterDescription")}
          control={
            <Switch
              aria-label={message("projectIndexing.masterEnabled")}
              checked={settings.projectIndexingEnabled}
              disabled={!canOperate || save.isPending}
              onCheckedChange={(projectIndexingEnabled) => update({ projectIndexingEnabled })}
            />
          }
        />
        <SettingsRow
          title={message("projectIndexing.projectSettings")}
          description={message("projectIndexing.projectSettingsDescription")}
          control={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void navigate({
                  to: "/settings/projects",
                  search: { project: undefined, machine: environment.environmentId },
                })
              }
            >
              {message("projectIndexing.projectSettings")}
            </Button>
          }
        />
        {error ? (
          <p role="alert" className="px-3 py-3 text-sm text-destructive sm:px-4">
            {error}
          </p>
        ) : null}
      </SettingsSection>
      <SettingsSection
        id="knowledge.projectIndexingReviewDefaults"
        title={message("projectIndexing.reviewEnabled")}
      >
        <SettingsRow
          id="knowledge.projectIndexingDefaultModel"
          title={message("projectIndexing.defaultModel")}
          description={message("projectIndexing.defaultModelDescription")}
          status={modelStatus}
          control={
            <div className="flex flex-wrap items-center gap-2">
              <ProjectIndexModelPicker
                label={message("projectIndexing.defaultModel")}
                selection={selection}
                settings={settings}
                providers={environment.serverConfig?.providers ?? []}
                disabled={!canOperate || save.isPending}
                onChange={(projectIndexingDefaultModelSelection) =>
                  update({ projectIndexingDefaultModelSelection })
                }
              />
              {selection ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  disabled={!canOperate || save.isPending}
                  onClick={() => update({ projectIndexingDefaultModelSelection: null })}
                >
                  {message("common.clear")}
                </Button>
              ) : null}
              {selection && check?.supported === false ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setCheckAttempt((attempt) => attempt + 1)}
                >
                  {message("projectIndexing.checkModelAgain")}
                </Button>
              ) : null}
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}

function AuthorizedProjectIndexDefaults({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const { message } = useInterfaceTranslator();
  const localDesktop = isElectron && environment.entry.target._tag === "PrimaryConnectionTarget";
  const session = useEnvironmentQuery(
    localDesktop ? null : environmentSession.sessionStateAtom(environment.environmentId),
  );
  const [initialized, setInitialized] = useState(false);
  const canRead =
    localDesktop ||
    (session.data?.authenticated === true &&
      session.data.scopes?.includes(AuthOrchestrationReadScope) === true);
  const canOperate =
    localDesktop ||
    (session.data?.authenticated === true &&
      session.data.scopes?.includes(AuthOrchestrationOperateScope) === true);
  const refreshing = !localDesktop && session.data === null;
  if (!localDesktop && (session.error !== null || (session.data !== null && !canRead))) {
    if (initialized) setInitialized(false);
    return (
      <div className="space-y-2 px-3 text-sm text-muted-foreground sm:px-4">
        <p role="alert">{session.error ?? message("projectIndexing.readUnavailable")}</p>
        {session.error ? (
          <Button size="xs" variant="outline" onClick={session.refresh}>
            {message("projectIndexing.retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  if (!initialized && refreshing)
    return (
      <p role="status" className="px-3 text-sm text-muted-foreground sm:px-4">
        {message("common.loading")}
      </p>
    );
  if (!initialized) setInitialized(true);
  return (
    <div inert={refreshing} aria-busy={refreshing}>
      <ProjectIndexDefaultsForm environment={environment} canOperate={canOperate && !refreshing} />
    </div>
  );
}

export function ProjectIndexingGlobalSettings({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const { message } = useInterfaceTranslator();
  const environment = useEnvironment(environmentId);
  if (!environment || environment.connection.phase !== "connected" || !environment.serverConfig)
    return (
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        {message("settings.betterT3.noEnvironment")}
      </p>
    );
  const capabilities = environment.serverConfig.environment.capabilities;
  if (!projectIndexingSupported(capabilities))
    return (
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        {message("projectIndexing.updateServer")}
      </p>
    );
  if (!projectIndexingDefaultsSupported(capabilities))
    return (
      <div className="space-y-4">
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          {message("projectIndexing.legacyDefaults")}
        </p>
        <ProjectIndexingSettingsSection environmentId={environmentId} />
      </div>
    );
  return <AuthorizedProjectIndexDefaults key={environmentId} environment={environment} />;
}
