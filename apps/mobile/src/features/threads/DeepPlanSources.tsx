import {
  deepPlanSourceRefKey,
  loadDeepPlanSourceCatalog,
} from "@t3tools/client-runtime/deep-planning";
import type {
  DeepPlanSourceCatalogEntry,
  DeepPlanSourceRef,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useProjects, useServerConfigs } from "../../state/entities";
import { getMobileDeepPlanningApi } from "../../state/deep-planning";
import { useWorkspaceState } from "../../state/workspace";

type SourceOption = DeepPlanSourceCatalogEntry & { readonly environmentLabel?: string };

export function DeepPlanSourceSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly sources: ReadonlyArray<SourceOption>;
  readonly selected: ReadonlyArray<DeepPlanSourceRef>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onChange: (sources: ReadonlyArray<DeepPlanSourceRef>) => void;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [query, setQuery] = useState("");
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedKeys = new Set(props.selected.map(deepPlanSourceRefKey));
  const sources = props.sources.filter((source) =>
    [source.threadTitle, source.projectTitle, source.environmentLabel ?? ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  return (
    <Modal
      animationType="slide"
      presentationStyle={Platform.OS === "android" ? "overFullScreen" : "pageSheet"}
      transparent={Platform.OS === "android"}
      onRequestClose={props.onClose}
      onDismiss={props.onClose}
    >
      <View className={Platform.OS === "android" ? "flex-1 justify-end bg-backdrop" : "flex-1"}>
        {Platform.OS === "android" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translator.message("common.close")}
            className="absolute inset-0"
            onPress={props.onClose}
          />
        ) : null}
        <View
          accessibilityViewIsModal
          className="overflow-hidden rounded-t-3xl bg-sheet-solid"
          style={{
            height: Platform.OS === "android" ? height - insets.top - 24 : "100%",
            paddingBottom: insets.bottom,
          }}
        >
          <View className="min-h-14 flex-row items-center gap-3 border-b border-border pl-5 pr-2">
            <Text
              accessibilityRole="header"
              className="flex-1 text-lg font-t3-semibold text-foreground"
            >
              {translator.message("chat.deepPlan.sources")}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="min-h-11 min-w-11 items-center justify-center px-3"
              onPress={props.onClose}
            >
              <Text className="text-sm text-foreground">{translator.message("common.done")}</Text>
            </Pressable>
          </View>
          <Text className="px-5 pb-3 pt-4 text-sm text-foreground-muted">
            {translator.message("chat.deepPlan.selectionHint")}
          </Text>
          <TextInput
            accessibilityLabel={translator.message("chat.deepPlan.searchSources")}
            placeholder={translator.message("chat.deepPlan.searchSources")}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            className="mx-4 mb-3 min-h-11 rounded-xl bg-subtle px-3 text-base text-foreground"
          />
          {props.loading ? (
            <ActivityIndicator
              accessibilityLabel={translator.message("chat.deepPlan.preparing")}
              className="my-3"
            />
          ) : null}
          {props.error ? (
            <View className="gap-1 px-5 pb-2">
              <Text accessibilityRole="alert" className="text-sm text-danger">
                {props.error}
              </Text>
              <Pressable
                accessibilityRole="button"
                className="min-h-11 justify-center"
                onPress={props.onRetry}
              >
                <Text className="text-sm font-t3-medium text-foreground">
                  {translator.message("chat.deepPlan.retry")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <FlatList
            data={sources}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            keyExtractor={(source) => deepPlanSourceRefKey(source.origin)}
            ListEmptyComponent={
              !props.loading ? (
                <Text className="p-5 text-sm text-foreground-muted">
                  {translator.message("chat.deepPlan.noSources")}
                </Text>
              ) : null
            }
            renderItem={({ item: source }) => {
              const key = deepPlanSourceRefKey(source.origin);
              const automatic =
                source.origin.environmentId === props.environmentId &&
                source.origin.projectId === props.projectId;
              const checked = automatic || selectedKeys.has(key);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={[
                    source.threadTitle,
                    source.projectTitle,
                    source.environmentLabel,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  accessibilityState={{ checked, disabled: automatic }}
                  disabled={automatic}
                  className="min-h-14 flex-row items-center gap-3 border-b border-border-subtle px-5 py-3"
                  onPress={() =>
                    props.onChange(
                      checked
                        ? props.selected.filter((ref) => deepPlanSourceRefKey(ref) !== key)
                        : [...props.selected, source.origin],
                    )
                  }
                >
                  <SymbolView
                    name={checked ? "checkmark.circle" : "circle"}
                    size={22}
                    tintColorClassName={checked ? "accent-focus" : "accent-icon-muted"}
                  />
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-sm font-t3-medium text-foreground" numberOfLines={2}>
                      {source.threadTitle}
                    </Text>
                    <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                      {[
                        source.projectTitle,
                        source.environmentLabel,
                        source.archived ? translator.message("chat.deepPlan.archived") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                  {automatic ? (
                    <Text className="text-xs text-foreground-muted">
                      {translator.message("chat.deepPlan.included")}
                    </Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

export function DeepPlanSources(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly selected: ReadonlyArray<DeepPlanSourceRef>;
  readonly disabled?: boolean;
  readonly onChange: (sources: ReadonlyArray<DeepPlanSourceRef>) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const projects = useProjects();
  const configs = useServerConfigs();
  const { environments } = useWorkspaceState();
  const [open, setOpen] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const scopeKey = JSON.stringify([props.environmentId, props.projectId]);
  const environmentById = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const targets = projects.filter((project) => {
    const isCurrent =
      project.environmentId === props.environmentId && project.id === props.projectId;
    const selected = props.selected.some(
      (ref) => ref.environmentId === project.environmentId && ref.projectId === project.id,
    );
    return (
      (isCurrent || open || selected) &&
      environmentById.get(project.environmentId)?.connectionState === "connected" &&
      configs.get(project.environmentId)?.environment.capabilities.deepPlanning?.sourceExport ===
        true
    );
  });
  const targetKey = JSON.stringify(
    targets.map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
      projectTitle: project.title,
      environmentLabel:
        environmentById.get(project.environmentId)?.environmentLabel ??
        String(project.environmentId),
    })),
  );
  const requestKey = JSON.stringify([scopeKey, targetKey, retryVersion]);
  const [catalog, setCatalog] = useState<{
    readonly scopeKey: string;
    readonly requestKey: string;
    readonly sources: ReadonlyArray<SourceOption>;
    readonly error: string | null;
  }>({ scopeKey: "", requestKey: "", sources: [], error: null });
  useEffect(() => {
    const controller = new AbortController();
    const requestedProjects = JSON.parse(targetKey) as ReadonlyArray<{
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly projectTitle: string;
      readonly environmentLabel: string;
    }>;
    void Promise.allSettled(
      requestedProjects.map(async (project) => {
        const result = await loadDeepPlanSourceCatalog({
          environmentId: project.environmentId,
          projectId: project.projectId,
          api: getMobileDeepPlanningApi(project.environmentId),
          signal: controller.signal,
        });
        return result.sources.map((source) => ({
          ...source,
          environmentLabel: project.environmentLabel,
        }));
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const sources = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const errors = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              `${requestedProjects[index]?.projectTitle ?? ""}: ${result.reason instanceof Error ? result.reason.message : translator.message("chat.deepPlan.sourceUnavailable")}`,
            ]
          : [],
      );
      setCatalog({
        scopeKey,
        requestKey,
        sources,
        error: errors.length > 0 ? errors.join("\n") : null,
      });
    });
    return () => controller.abort();
  }, [scopeKey, targetKey, requestKey, translator]);
  const loading = catalog.requestKey !== requestKey;
  const error = loading ? null : catalog.error;
  const sources = catalog.scopeKey === scopeKey ? catalog.sources : [];
  const byRef = useMemo(
    () => new Map(sources.map((source) => [deepPlanSourceRefKey(source.origin), source])),
    [sources],
  );
  const projectCount = sources.filter(
    (source) =>
      source.origin.environmentId === props.environmentId &&
      source.origin.projectId === props.projectId,
  ).length;
  const currentProjectAvailable = targets.some(
    (project) => project.environmentId === props.environmentId && project.id === props.projectId,
  );
  return (
    <View className="gap-1 px-3 pb-2">
      <View className="min-h-11 flex-row items-center gap-2">
        <Text
          accessibilityHint={translator.message("chat.deepPlan.allProjectChats")}
          className="min-w-0 flex-1 text-xs text-foreground-muted"
        >
          {!currentProjectAvailable
            ? translator.message("chat.deepPlan.sourceUnavailable")
            : loading
              ? translator.message("chat.deepPlan.preparing")
              : translator.message("chat.deepPlan.projectSources", { count: projectCount })}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled}
          onPress={() => setOpen(true)}
          className="min-h-11 justify-center px-2"
        >
          <Text className="text-sm font-t3-medium text-foreground">
            {translator.message("chat.deepPlan.chooseSources")}
          </Text>
        </Pressable>
      </View>
      {props.selected.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {props.selected.map((ref) => {
            const key = deepPlanSourceRefKey(ref);
            const title =
              byRef.get(key)?.threadTitle ?? translator.message("chat.deepPlan.sourceUnavailable");
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={translator.message("chat.deepPlan.removeSource", { title })}
                disabled={props.disabled}
                className="min-h-11 max-w-56 flex-row items-center gap-2 rounded-xl bg-subtle px-3"
                onPress={() =>
                  props.onChange(
                    props.selected.filter((source) => deepPlanSourceRefKey(source) !== key),
                  )
                }
              >
                <Text className="shrink text-xs text-foreground" numberOfLines={1}>
                  {title}
                </Text>
                <SymbolView name="xmark" size={11} tintColorClassName="accent-icon-muted" />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {error && !open ? (
        <Text accessibilityRole="alert" className="text-xs text-danger">
          {error}
        </Text>
      ) : null}
      {open ? (
        <DeepPlanSourceSheet
          environmentId={props.environmentId}
          projectId={props.projectId}
          sources={sources}
          selected={props.selected}
          loading={loading}
          error={error}
          onChange={props.onChange}
          onRetry={() => setRetryVersion((version) => version + 1)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}
