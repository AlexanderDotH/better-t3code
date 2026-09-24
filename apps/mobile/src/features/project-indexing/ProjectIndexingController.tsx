import {
  createProjectIndexController,
  deriveProjectIndexActions,
} from "@t3tools/client-runtime/project-indexing";
import type {
  EnvironmentId,
  ProjectContextInput,
  ProjectId,
  ProjectIndexScopeInput,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useEnvironmentServerConfig, useProject } from "../../state/entities";
import { bindProjectIndexApi } from "../../state/project-index";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";
import { ProjectIndexingSettingsCard } from "../settings/ProjectIndexingSettingsCard";
import { ProjectIndexActionButton } from "./ProjectIndexControls";
import { ProjectIndexExplorer } from "./ProjectIndexExplorer";
import { ProjectIndexReviewCard } from "./ProjectIndexReviewCard";
import { mobileProjectIndexPermissions } from "./mobile-project-indexing";
import {
  mobileProjectIndexDefaults,
  mobileProjectIndexEffectiveSettings,
  mobileProjectIndexStatusWithDefaults,
  supportsMobileStaticProjectIndex,
} from "./mobile-project-index-settings";
import { useProjectIndexModelCheck } from "./use-project-index-model-check";

export interface ProjectIndexingControllerProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly environmentLabel?: string;
  readonly projectLabel?: string;
  readonly threadId?: ThreadId;
}

function ScopedProjectIndexingController(props: {
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly config: ServerConfig;
  readonly projectLabel: string;
  readonly canOperate: boolean;
  readonly staticSupported: boolean;
}) {
  const translator = useMobileInterfaceTranslator();
  const api = useMemo(() => bindProjectIndexApi(props.environmentId), [props.environmentId]);
  const controller = useMemo(
    () => createProjectIndexController({ api, scope: props.scope }),
    [api, props.scope],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [queryRefreshEpoch, setQueryRefreshEpoch] = useState(0);
  const configDefaults = useMemo(() => mobileProjectIndexDefaults(props.config), [props.config]);
  const status = useMemo(
    () =>
      state.status ? mobileProjectIndexStatusWithDefaults(state.status, configDefaults) : null,
    [configDefaults, state.status],
  );
  const effectiveSettings = status ? mobileProjectIndexEffectiveSettings(status) : null;
  const getModelSelection = useCallback(() => {
    if (!props.staticSupported) return null;
    const current = controller.getSnapshot().status;
    return current
      ? current.settings.reviewEnabled
        ? mobileProjectIndexEffectiveSettings(
            mobileProjectIndexStatusWithDefaults(current, configDefaults),
          ).modelSelection
        : null
      : null;
  }, [configDefaults, controller, props.staticSupported]);
  const modelCheck = useProjectIndexModelCheck({
    selectionKey: JSON.stringify(
      props.staticSupported && status?.settings.reviewEnabled
        ? (effectiveSettings?.modelSelection ?? null)
        : null,
    ),
    getSelection: getModelSelection,
    checkModel: controller.checkModel,
  });

  useEffect(() => {
    void controller.refresh().catch(() => undefined);
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    if (state.invalidationEpoch === 0) return;
    let active = true;
    void controller
      .refresh()
      .then(() => {
        if (active) setQueryRefreshEpoch(state.invalidationEpoch);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [controller, state.invalidationEpoch]);

  const query = useCallback((input: ProjectContextInput) => controller.query(input), [controller]);
  const review = useCallback(
    (selection: "workingtree" | "staged") => controller.review(selection),
    [controller],
  );
  const refresh = useCallback(() => {
    void controller.refresh().catch(() => undefined);
  }, [controller]);

  if (status === null) {
    return state.error ? (
      <EmptyState
        title={translator.message("projectIndexing.title")}
        detail={state.error}
        actionLabel={translator.message("common.retry")}
        onAction={refresh}
        variant="plain"
      />
    ) : (
      <View className="items-center gap-3 p-8">
        <ActivityIndicator />
        <Text className="text-sm text-foreground-muted">
          {translator.message("projectIndexing.loading")}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-5">
      {state.error ? (
        <View className="gap-3 rounded-2xl bg-card p-4">
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground" selectable>
            {state.error}
          </Text>
          <ProjectIndexActionButton label={translator.message("common.retry")} onPress={refresh} />
        </View>
      ) : null}
      <ProjectIndexingSettingsCard
        status={status}
        config={props.config}
        projectLabel={props.projectLabel}
        busy={state.pendingAction !== null}
        readOnly={!props.canOperate || !props.staticSupported}
        actions={deriveProjectIndexActions(status)}
        onUpdate={(patch) => {
          if (!props.canOperate || !props.staticSupported) return;
          void controller.updateSettings(patch).catch(() => undefined);
        }}
        onStart={(rebuild) => {
          if (!props.canOperate || !props.staticSupported) return;
          void controller.start(rebuild).catch(() => undefined);
        }}
        onControl={(action) => {
          if (!props.canOperate || !props.staticSupported) return;
          void controller.control(action).catch(() => undefined);
        }}
      />
      {!props.staticSupported ? (
        <Text className="px-2 text-sm text-foreground-muted">
          {translator.message("projectIndexing.updateServer")}
        </Text>
      ) : null}
      {effectiveSettings?.enabled ? (
        <>
          <ProjectIndexExplorer
            environmentId={props.environmentId}
            scope={props.scope}
            status={status}
            result={state.queryResult}
            invalidated={state.invalidated}
            refreshEpoch={queryRefreshEpoch}
            onQuery={query}
          />
          {status.settings.reviewEnabled ? (
            <ProjectIndexReviewCard
              environmentId={props.environmentId}
              scope={props.scope}
              config={props.config}
              status={status}
              modelCheck={modelCheck.result}
              checkingModel={modelCheck.checking}
              disabled={!props.canOperate || !props.staticSupported || state.pendingAction !== null}
              onUpdate={(patch) => {
                if (!props.canOperate || !props.staticSupported) return;
                void controller.updateSettings(patch).catch(() => undefined);
              }}
              onReview={review}
            />
          ) : null}
        </>
      ) : (
        <Text className="px-2 text-sm text-foreground-muted">
          {translator.message("projectIndexing.disabledHint")}
        </Text>
      )}
    </View>
  );
}

export function ProjectIndexingController(props: ProjectIndexingControllerProps) {
  const translator = useMobileInterfaceTranslator();
  const config = useEnvironmentServerConfig(props.environmentId);
  const project = useProject({ environmentId: props.environmentId, projectId: props.projectId });
  const projectLabel = props.projectLabel ?? project?.title ?? String(props.projectId);
  const sessionQuery = useEnvironmentQuery(
    environmentSession.sessionStateAtom(props.environmentId),
  );
  const session = sessionQuery.data;
  const permissions = mobileProjectIndexPermissions(session);
  const [useThreadScope, setUseThreadScope] = useState(props.threadId !== undefined);
  const scope = useMemo<ProjectIndexScopeInput>(
    () => ({
      projectId: props.projectId,
      ...(useThreadScope && props.threadId ? { threadId: props.threadId } : {}),
    }),
    [props.projectId, props.threadId, useThreadScope],
  );

  if (sessionQuery.error !== null) {
    return (
      <EmptyState
        title={translator.message("projectIndexing.title")}
        detail={sessionQuery.error}
        actionLabel={translator.message("projectIndexing.retry")}
        onAction={sessionQuery.refresh}
        variant="plain"
      />
    );
  }
  if (config === null || session === null) {
    return (
      <Text className="p-4 text-sm text-foreground-muted">
        {translator.message("projectIndexing.loading")}
      </Text>
    );
  }
  if ((config.environment.capabilities.projectIndexingVersion ?? 0) < 1) {
    return (
      <EmptyState
        title={translator.message("projectIndexing.title")}
        detail={translator.message("projectIndexing.unsupported")}
        variant="plain"
      />
    );
  }
  if (!permissions.canRead) {
    return (
      <EmptyState
        title={translator.message("projectIndexing.title")}
        detail={translator.message("projectIndexing.readUnavailable")}
        variant="plain"
      />
    );
  }

  return (
    <View className="gap-4">
      <View className="gap-2 px-2">
        {projectLabel || props.environmentLabel ? (
          <Text className="text-sm font-t3-semibold text-foreground">
            {[projectLabel, props.environmentLabel].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {props.threadId ? (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={translator.message("projectIndexing.scope")}
            className="flex-row flex-wrap gap-2"
          >
            {([false, true] as const).map((threadScope) => (
              <Pressable
                key={String(threadScope)}
                accessibilityRole="radio"
                accessibilityState={{ checked: useThreadScope === threadScope }}
                className={
                  useThreadScope === threadScope
                    ? "rounded-full bg-primary px-4 py-3"
                    : "rounded-full border border-border bg-card px-4 py-3"
                }
                onPress={() => setUseThreadScope(threadScope)}
              >
                <Text
                  className={
                    useThreadScope === threadScope
                      ? "text-sm font-t3-semibold text-primary-foreground"
                      : "text-sm text-foreground"
                  }
                >
                  {translator.message(
                    threadScope ? "projectIndexing.threadScope" : "projectIndexing.projectScope",
                  )}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text className="text-sm text-foreground-muted">
            {translator.message("projectIndexing.projectScope")}
          </Text>
        )}
      </View>
      <ScopedProjectIndexingController
        key={JSON.stringify([props.environmentId, scope])}
        environmentId={props.environmentId}
        scope={scope}
        config={config}
        projectLabel={projectLabel}
        canOperate={permissions.canOperate}
        staticSupported={supportsMobileStaticProjectIndex(
          config.environment.capabilities.projectIndexingVersion,
        )}
      />
    </View>
  );
}
