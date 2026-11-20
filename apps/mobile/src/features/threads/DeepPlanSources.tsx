import { deepPlanSourceRefKey } from "@t3tools/client-runtime/deep-planning";
import {
  DEEP_PLAN_MAX_CHATS,
  isListedThreadLineage,
  type DeepPlanSourceRef,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";
import {
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

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useProjects, useThreadShells } from "../../state/entities";
import { useLinkedEnvironments } from "../../state/peerLinks";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useArchivedThreadSnapshots } from "../archive/useArchivedThreadSnapshots";

interface SourceOption {
  readonly origin: DeepPlanSourceRef;
  readonly threadTitle: string;
  readonly projectTitle: string;
  readonly environmentLabel?: string;
  readonly archived: boolean;
}

export function DeepPlanSourceSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly sources: ReadonlyArray<SourceOption>;
  readonly selected: ReadonlyArray<DeepPlanSourceRef>;
  readonly includeProjectChats: boolean;
  readonly onChange: (
    sources: ReadonlyArray<DeepPlanSourceRef>,
    includeProjectChats: boolean,
  ) => void;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const [query, setQuery] = useState("");
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const includeProjectChats = props.includeProjectChats;
  const belongsToCurrentProject = (ref: DeepPlanSourceRef) =>
    ref.environmentId === props.environmentId && ref.projectId === props.projectId;
  const selectedKeys = new Set(props.selected.map(deepPlanSourceRefKey));
  const atLimit = selectedKeys.size >= DEEP_PLAN_MAX_CHATS;
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
            {translator.message(
              includeProjectChats
                ? "chat.deepPlan.selectionHint"
                : "chat.deepPlan.manualSelectionHint",
            )}
          </Text>
          <View className="mx-5 mb-3 min-h-11 flex-row items-center justify-between gap-3">
            <Text className="min-w-0 flex-1 text-sm text-foreground">
              {translator.message("chat.deepPlan.includeProjectChats")}
            </Text>
            <ThemedSwitch
              accessibilityLabel={translator.message("chat.deepPlan.includeProjectChats")}
              value={includeProjectChats}
              onValueChange={(include) =>
                props.onChange(
                  include
                    ? props.selected.filter((ref) => !belongsToCurrentProject(ref))
                    : props.selected,
                  include,
                )
              }
            />
          </View>
          <TextInput
            accessibilityLabel={translator.message("chat.deepPlan.searchSources")}
            placeholder={translator.message("chat.deepPlan.searchSources")}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            className="mx-4 mb-3 min-h-11 rounded-xl bg-subtle px-3 text-base text-foreground"
          />
          {atLimit ? (
            <Text className="px-5 pb-2 text-xs text-foreground-muted">
              {translator.message("chat.deepPlan.sourceLimit", { count: DEEP_PLAN_MAX_CHATS })}
            </Text>
          ) : null}
          <FlatList
            data={sources}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            keyExtractor={(source) => deepPlanSourceRefKey(source.origin)}
            ListEmptyComponent={
              <Text className="p-5 text-sm text-foreground-muted">
                {translator.message("chat.deepPlan.noSources")}
              </Text>
            }
            renderItem={({ item: source }) => {
              const key = deepPlanSourceRefKey(source.origin);
              const automatic = includeProjectChats && belongsToCurrentProject(source.origin);
              const checked = automatic || selectedKeys.has(key);
              const disabled = automatic || (atLimit && !checked);
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
                  accessibilityState={{ checked, disabled }}
                  disabled={disabled}
                  className="min-h-14 flex-row items-center gap-3 border-b border-border-subtle px-5 py-3"
                  onPress={() =>
                    props.onChange(
                      checked
                        ? props.selected.filter((ref) => deepPlanSourceRefKey(ref) !== key)
                        : [...props.selected, source.origin],
                      includeProjectChats,
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
  readonly threadId: ThreadId;
  readonly selected: ReadonlyArray<DeepPlanSourceRef>;
  readonly includeProjectChats: boolean;
  readonly disabled?: boolean;
  readonly onChange: (
    sources: ReadonlyArray<DeepPlanSourceRef>,
    includeProjectChats: boolean,
  ) => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const projects = useProjects();
  const shells = useThreadShells();
  const environments = useWorkspaceEnvironments();
  const linkedEnvironments = useLinkedEnvironments(props.environmentId);
  const [open, setOpen] = useState(false);
  const eligibleEnvironments = useMemo(
    () =>
      new Map(
        environments
          .filter(
            (environment) =>
              environment.connectionState === "connected" &&
              (environment.environmentId === props.environmentId ||
                linkedEnvironments.has(environment.environmentId)),
          )
          .map((environment) => [environment.environmentId, environment.environmentLabel]),
      ),
    [environments, linkedEnvironments, props.environmentId],
  );
  const archivedEnvironmentIds = useMemo(
    () =>
      open
        ? [...eligibleEnvironments.keys()]
        : [
            ...new Set(
              props.selected
                .map((ref) => ref.environmentId)
                .filter((environmentId) => eligibleEnvironments.has(environmentId)),
            ),
          ],
    [eligibleEnvironments, open, props.selected],
  );
  const { snapshots } = useArchivedThreadSnapshots(archivedEnvironmentIds);
  const byRef = useMemo(() => {
    if (!open && props.selected.length === 0) return new Map<string, SourceOption>();
    const selectedKeys = new Set(props.selected.map(deepPlanSourceRefKey));
    const projectTitles = new Map(
      [
        ...projects,
        ...snapshots.flatMap(({ environmentId, snapshot }) =>
          snapshot.projects.map((project) => ({ ...project, environmentId })),
        ),
      ].map((project) => [JSON.stringify([project.environmentId, project.id]), project.title]),
    );
    const options = new Map<string, SourceOption>();
    const archivedShells = snapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => ({ ...thread, environmentId })),
    );
    for (const thread of [...shells, ...archivedShells]) {
      const environmentLabel = eligibleEnvironments.get(thread.environmentId);
      if (
        environmentLabel === undefined ||
        thread.deletedAt !== null ||
        !isListedThreadLineage(thread.lineage) ||
        thread.deepPlanExecution?.readOnly ||
        (thread.environmentId === props.environmentId && thread.id === props.threadId)
      )
        continue;
      const origin = {
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        threadId: thread.id,
      };
      const key = deepPlanSourceRefKey(origin);
      if (options.has(key) || (!open && !selectedKeys.has(key))) continue;
      options.set(key, {
        origin,
        threadTitle: thread.title,
        projectTitle:
          projectTitles.get(JSON.stringify([thread.environmentId, thread.projectId])) ??
          String(thread.projectId),
        environmentLabel,
        archived: thread.archivedAt !== null,
      });
    }
    return options;
  }, [
    eligibleEnvironments,
    open,
    projects,
    props.environmentId,
    props.selected,
    props.threadId,
    shells,
    snapshots,
  ]);
  const chosenProjectCount = props.selected.filter(
    (ref) => ref.environmentId === props.environmentId && ref.projectId === props.projectId,
  ).length;
  return (
    <View className="gap-1 px-3 pb-2">
      <View className="min-h-11 flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted">
          {props.includeProjectChats
            ? translator.message("chat.deepPlan.allProjectChats")
            : chosenProjectCount > 0
              ? translator.message("chat.deepPlan.projectSources", { count: chosenProjectCount })
              : translator.message("chat.deepPlan.noProjectChats")}
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
                    props.includeProjectChats,
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
      {open ? (
        <DeepPlanSourceSheet
          environmentId={props.environmentId}
          projectId={props.projectId}
          sources={[...byRef.values()]}
          selected={props.selected}
          includeProjectChats={props.includeProjectChats}
          onChange={props.onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}
