import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  HarnessChatSessionId,
  HarnessChatSummary,
  HarnessChatSyncListResult,
  HarnessChatSyncRunResult,
  HarnessChatSyncSource,
  ProjectId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { useThemeColor } from "../../lib/useThemeColor";
import { agentSettingsEnvironment } from "../../state/agent-settings";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  applyHarnessChatTarget,
  clearHarnessChatSelection,
  createHarnessChatSelection,
  harnessChatSelectedCount,
  isHarnessChatSelected,
  selectAllHarnessChats,
  supportsHarnessChatSync,
  toggleHarnessChatSelection,
  type HarnessChatSelectionState,
} from "./harness-chat-sync-settings";

const PAGE_SIZE = 10;

function failureMessage(result: { readonly _tag: string }, fallback: string): string {
  if (result._tag !== "Failure") return fallback;
  const error = squashAtomCommandFailure(result as never);
  return error instanceof Error ? error.message : fallback;
}

function formatUpdatedAt(value: string | null): string {
  if (value === null) return "No dated chats";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function mergeChats(
  current: ReadonlyArray<HarnessChatSummary>,
  incoming: ReadonlyArray<HarnessChatSummary>,
): ReadonlyArray<HarnessChatSummary> {
  const byId = new Map(current.map((chat) => [chat.sessionId, chat]));
  for (const chat of incoming) byId.set(chat.sessionId, chat);
  return [...byId.values()];
}

function resultSummary(result: HarnessChatSyncRunResult): string {
  const synced = `${result.syncedCount} synced`;
  const failed = result.failedCount > 0 ? ` · ${result.failedCount} failed` : "";
  return `${synced}${failed} · ${result.messagesImported} new messages`;
}

function sourceSummary(input: {
  readonly source: HarnessChatSyncSource;
  readonly visibleCount: number;
  readonly totalMatching: number;
  readonly changedMatching: number;
  readonly countsAreComplete: boolean;
}): string {
  const latestUpdatedAt = input.source.latestUpdatedAt;
  if (!input.countsAreComplete) {
    const changed = input.changedMatching > 0 ? ` · ${input.changedMatching}+ changed` : "";
    return `${input.visibleCount} shown · more available${changed}`;
  }
  const changed = input.changedMatching > 0 ? ` · ${input.changedMatching} changed` : "";
  return `${input.totalMatching} chats${changed} · ${formatUpdatedAt(latestUpdatedAt)}`;
}

function projectTargetLabel(
  chat: HarnessChatSummary,
  projectsById: ReadonlyMap<ProjectId, EnvironmentProject>,
): string {
  if (chat.targetProject.kind === "existing") {
    return projectsById.get(chat.targetProject.projectId)?.title ?? "Existing project";
  }
  if (chat.targetProject.kind === "create") {
    return `Create ${chat.targetProject.suggestedName}`;
  }
  return "Project needed";
}

function HarnessChatRow(props: {
  readonly chat: HarnessChatSummary;
  readonly selected: boolean;
  readonly projectsById: ReadonlyMap<ProjectId, EnvironmentProject>;
  readonly onToggle: () => void;
}) {
  const iconColor = useThemeColor("--color-icon");
  const detailParts = [
    `${props.chat.messageCount} messages`,
    props.chat.activity === "active" ? "Active elsewhere" : null,
    props.chat.link !== null ? `Already linked: ${props.chat.link.threadId}` : null,
    props.chat.hasChanges ? "Changes available" : null,
    props.chat.archived ? "Archived" : null,
  ].filter((part): part is string => part !== null);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onToggle}
      className="flex-row items-start gap-3 border-t border-border-subtle p-4"
    >
      <View className="mt-0.5 size-6 items-center justify-center rounded-lg border border-border">
        {props.selected ? (
          <SymbolView
            name="checkmark"
            size={15}
            tintColor={iconColor}
            type="monochrome"
            weight="semibold"
          />
        ) : null}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text className="text-base font-t3-medium text-foreground" numberOfLines={2}>
          {props.chat.title}
        </Text>
        {props.chat.preview ? (
          <Text className="text-sm leading-normal text-foreground-muted" numberOfLines={2}>
            {props.chat.preview}
          </Text>
        ) : null}
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {props.chat.cwd ?? "No working directory"}
        </Text>
        <Text className="text-xs text-foreground-muted">{detailParts.join(" · ")}</Text>
        <Text
          className={
            props.chat.targetProject.kind === "unresolved"
              ? "text-xs font-t3-medium text-danger-foreground"
              : "text-xs font-t3-medium text-foreground"
          }
        >
          {projectTargetLabel(props.chat, props.projectsById)}
        </Text>
      </View>
    </Pressable>
  );
}

function HarnessChatTargetResolverModal(props: {
  readonly chat: HarnessChatSummary | null;
  readonly unresolvedCount: number;
  readonly allowApplyToAll: boolean;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly onClose: () => void;
  readonly onResolve: (projectId: ProjectId, applyToAll: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [applyToAll, setApplyToAll] = useState(false);
  const sortedProjects = useMemo(
    () => [...props.projects].sort((left, right) => left.title.localeCompare(right.title)),
    [props.projects],
  );

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible={props.chat !== null}
      onRequestClose={props.onClose}
    >
      <View className="flex-1 bg-sheet">
        <View className="flex-row items-center border-b border-border px-5 py-4">
          <Text className="flex-1 text-xl font-t3-semibold text-foreground">Choose project</Text>
          <Pressable accessibilityRole="button" onPress={props.onClose} className="px-2 py-1">
            <Text className="text-base font-t3-medium text-foreground">Cancel</Text>
          </Pressable>
        </View>
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          <View className="gap-1 px-2">
            <Text className="text-base font-t3-medium text-foreground">
              {props.chat?.title ?? "Missing workspace"}
            </Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              The original working directory is unavailable. Select where this chat should live.
            </Text>
          </View>
          {props.allowApplyToAll ? (
            <View className="flex-row items-center gap-3 rounded-[24px] bg-card p-4">
              <View className="min-w-0 flex-1">
                <Text className="text-base text-foreground">Apply to all unresolved chats</Text>
                <Text className="text-sm text-foreground-muted">
                  {props.unresolvedCount > 1
                    ? `Use one target for ${props.unresolvedCount} selected chats.`
                    : "Also resolve unloaded matching chats with this target."}
                </Text>
              </View>
              <ThemedSwitch value={applyToAll} onValueChange={setApplyToAll} />
            </View>
          ) : null}
          <View className="overflow-hidden rounded-[24px] bg-card">
            {sortedProjects.length === 0 ? (
              <Text className="p-5 text-center text-sm leading-normal text-foreground-muted">
                Add a project in this environment before resolving this chat.
              </Text>
            ) : (
              sortedProjects.map((project, index) => (
                <Pressable
                  key={project.id}
                  accessibilityRole="button"
                  onPress={() => props.onResolve(project.id, applyToAll)}
                  className={
                    index === 0 ? "gap-0.5 p-4" : "gap-0.5 border-t border-border-subtle p-4"
                  }
                >
                  <Text className="text-base font-t3-medium text-foreground">{project.title}</Text>
                  <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                    {project.workspaceRoot}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SupportedHarnessChatSource(props: {
  readonly environmentId: EnvironmentId;
  readonly source: HarnessChatSyncSource;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly onSynced: () => void;
  readonly active: boolean;
}) {
  const listChats = useAtomCommand(agentSettingsEnvironment.harnessChatSync.list, {
    reportFailure: false,
  });
  const runSync = useAtomCommand(agentSettingsEnvironment.harnessChatSync.run, {
    reportFailure: false,
  });
  const refreshStatus = useAtomCommand(agentSettingsEnvironment.harnessChatSync.status, {
    reportFailure: false,
  });
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selection, setSelection] = useState<HarnessChatSelectionState>(createHarnessChatSelection);
  const [chats, setChats] = useState<ReadonlyArray<HarnessChatSummary>>([]);
  const [nextCursor, setNextCursor] = useState<HarnessChatSyncListResult["nextCursor"]>(null);
  const [totalMatching, setTotalMatching] = useState(0);
  const [changedMatching, setChangedMatching] = useState(0);
  const [countsAreComplete, setCountsAreComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<HarnessChatSyncRunResult | null>(null);
  const [targetResolutions, setTargetResolutions] = useState<
    ReadonlyMap<HarnessChatSessionId, ProjectId>
  >(() => new Map());
  const [unresolvedTargetProjectId, setUnresolvedTargetProjectId] = useState<ProjectId | null>(
    null,
  );
  const [resolverSessionId, setResolverSessionId] = useState<HarnessChatSessionId | null>(null);
  const requestSequence = useRef(0);
  const placeholderColor = String(useThemeColor("--color-foreground-muted"));
  const projectsById = useMemo(
    () => new Map(props.projects.map((project) => [project.id, project])),
    [props.projects],
  );

  const loadPage = useCallback(
    async (cursor: HarnessChatSyncListResult["nextCursor"]) => {
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      if (cursor === null) setLoading(true);
      if (cursor !== null) setLoadingMore(true);
      setError(null);
      const result = await listChats({
        environmentId: props.environmentId,
        input: {
          sourceId: props.source.id,
          query,
          includeArchived,
          limit: PAGE_SIZE,
          ...(cursor === null ? {} : { cursor }),
        },
      });
      if (requestSequence.current !== sequence) return;
      setLoading(false);
      setLoadingMore(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          setError(failureMessage(result, "Could not load harness chats."));
        }
        return;
      }
      setChats((current) =>
        cursor === null ? result.value.chats : mergeChats(current, result.value.chats),
      );
      setNextCursor(result.value.nextCursor);
      setTotalMatching(result.value.totalMatching);
      setChangedMatching(result.value.changedMatching);
      setCountsAreComplete(result.value.countsAreComplete ?? true);
    },
    [includeArchived, listChats, props.environmentId, props.source.id, query],
  );

  useEffect(() => {
    if (!props.active) return;
    void loadPage(null);
    return () => {
      requestSequence.current += 1;
    };
  }, [loadPage, props.active]);

  const selectedUnresolved = useMemo(
    () =>
      chats.filter(
        (chat) =>
          isHarnessChatSelected(selection, chat.sessionId) &&
          chat.targetProject.kind === "unresolved" &&
          !targetResolutions.has(chat.sessionId) &&
          unresolvedTargetProjectId === null,
      ),
    [chats, selection, targetResolutions, unresolvedTargetProjectId],
  );
  const resolverChat =
    resolverSessionId === null
      ? null
      : (chats.find((chat) => chat.sessionId === resolverSessionId) ?? null);
  const selectedCount = harnessChatSelectedCount(
    selection,
    totalMatching,
    chats.map((chat) => chat.sessionId),
  );
  const selectionLabel =
    selection.mode === "allMatching"
      ? selection.excludedSessionIds.size === 0
        ? countsAreComplete
          ? `All ${totalMatching} matching selected`
          : `All matching selected · ${chats.length} shown`
        : `All matching except ${selection.excludedSessionIds.size}`
      : `${selection.sessionIds.size} selected`;

  const refreshLoadedStatuses = useCallback(async () => {
    if (refreshingStatus || chats.length === 0) return;
    setRefreshingStatus(true);
    setError(null);
    const result = await refreshStatus({
      environmentId: props.environmentId,
      input: { sourceId: props.source.id, sessionIds: chats.map((chat) => chat.sessionId) },
    });
    setRefreshingStatus(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setError(failureMessage(result, "Could not refresh harness chat status."));
      }
      return;
    }
    const byId = new Map(result.value.statuses.map((status) => [status.sessionId, status]));
    setChats((current) =>
      current.map((chat) => {
        const status = byId.get(chat.sessionId);
        if (!status) return chat;
        return {
          ...chat,
          activity: status.activity,
          hasChanges: status.hasChanges,
          link: status.link,
        };
      }),
    );
  }, [chats, props.environmentId, props.source.id, refreshStatus, refreshingStatus]);

  const performSync = useCallback(
    async (
      resolutions: ReadonlyMap<HarnessChatSessionId, ProjectId>,
      unresolvedProjectId: ProjectId | null,
    ) => {
      if (syncing) return;
      setSyncing(true);
      setError(null);
      setLastResult(null);
      const result = await runSync({
        environmentId: props.environmentId,
        input: {
          sourceId: props.source.id,
          selection:
            selection.mode === "allMatching"
              ? {
                  mode: "allMatching",
                  query,
                  includeArchived,
                  excludedSessionIds: [...selection.excludedSessionIds],
                }
              : { mode: "only", sessionIds: [...selection.sessionIds] },
          ...(props.source.preferredInstanceId === null
            ? {}
            : { providerInstanceId: props.source.preferredInstanceId }),
          targetResolutions: [...resolutions].map(([sessionId, projectId]) => ({
            sessionId,
            projectId,
          })),
          ...(unresolvedProjectId === null
            ? {}
            : { unresolvedTargetProjectId: unresolvedProjectId }),
        },
      });
      setSyncing(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const message = failureMessage(result, "Could not sync harness chats.");
          setError(message);
          Alert.alert("Could not sync chats", message);
        }
        return;
      }
      setLastResult(result.value);
      props.onSynced();
      void loadPage(null);
    },
    [
      includeArchived,
      loadPage,
      props.environmentId,
      props.onSynced,
      props.source.id,
      props.source.preferredInstanceId,
      query,
      runSync,
      selection,
      syncing,
    ],
  );

  const startSync = useCallback(() => {
    if (selectedCount === 0 || syncing) return;
    const unresolved = selectedUnresolved[0];
    if (unresolved) {
      if (props.projects.length === 0) {
        Alert.alert(
          "Project required",
          "Add a project in this environment before syncing chats whose workspace is missing.",
        );
        return;
      }
      setResolverSessionId(unresolved.sessionId);
      return;
    }
    void performSync(targetResolutions, unresolvedTargetProjectId);
  }, [
    performSync,
    props.projects.length,
    selectedCount,
    selectedUnresolved,
    syncing,
    targetResolutions,
    unresolvedTargetProjectId,
  ]);

  const resolveTarget = useCallback(
    (projectId: ProjectId, applyToAll: boolean) => {
      if (resolverChat === null) return;
      const next = applyHarnessChatTarget({
        current: targetResolutions,
        sessionId: resolverChat.sessionId,
        unresolvedSessionIds: selectedUnresolved.map((chat) => chat.sessionId),
        projectId,
        applyToAll,
      });
      setTargetResolutions(next);
      setResolverSessionId(null);
      if (applyToAll) {
        setUnresolvedTargetProjectId(projectId);
        void performSync(next, projectId);
        return;
      }
      const remaining = selectedUnresolved.find((chat) => !next.has(chat.sessionId));
      if (remaining) {
        setResolverSessionId(remaining.sessionId);
        return;
      }
      void performSync(next, unresolvedTargetProjectId);
    },
    [performSync, resolverChat, selectedUnresolved, targetResolutions, unresolvedTargetProjectId],
  );

  return (
    <View className="gap-2">
      <SettingsSection card title={`${props.source.label} · ${props.source.driver}`}>
        <View className="gap-1 p-4">
          <Text className="text-sm text-foreground-muted">
            {loading
              ? "Checking history…"
              : sourceSummary({
                  source: props.source,
                  visibleCount: chats.length,
                  totalMatching,
                  changedMatching,
                  countsAreComplete,
                })}
          </Text>
          {props.source.status.kind === "supported" &&
          !props.source.status.supportsActivityStatus ? (
            <Text className="text-xs leading-normal text-foreground-muted">
              This harness cannot report whether a source session is active.
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center gap-2 border-t border-border-subtle p-3">
          <TextInput
            accessibilityLabel={`Search ${props.source.label} chats`}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-w-0 flex-1 rounded-xl bg-sheet px-3 py-2 text-base text-foreground"
            onChangeText={setQueryDraft}
            onSubmitEditing={() => setQuery(queryDraft.trim())}
            placeholder="Search chats"
            placeholderTextColor={placeholderColor}
            returnKeyType="search"
            value={queryDraft}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const nextQuery = queryDraft.trim();
              if (nextQuery === query) void loadPage(null);
              if (nextQuery !== query) setQuery(nextQuery);
            }}
            className="rounded-xl bg-foreground px-3 py-2"
          >
            <Text className="font-t3-medium text-background">Search</Text>
          </Pressable>
        </View>
        <SettingsSwitchRow
          icon="archivebox.fill"
          label="Include archived"
          subtitle="Top-level chats only"
          value={includeArchived}
          onValueChange={setIncludeArchived}
        />
        <View className="flex-row items-center gap-3 border-t border-border-subtle px-4 py-3">
          <Text className="min-w-0 flex-1 text-sm text-foreground-muted">{selectionLabel}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSelection(clearHarnessChatSelection())}
          >
            <Text className="font-t3-medium text-foreground">Clear all</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setSelection((current) => selectAllHarnessChats(current))}
          >
            <Text className="font-t3-medium text-foreground">Select all</Text>
          </Pressable>
        </View>
        {loading ? (
          <View className="items-center gap-2 border-t border-border-subtle p-6">
            <ActivityIndicator size="small" />
            <Text className="text-sm text-foreground-muted">Loading chats…</Text>
          </View>
        ) : chats.length === 0 ? (
          <Text className="border-t border-border-subtle p-5 text-center text-sm text-foreground-muted">
            No matching chats.
          </Text>
        ) : (
          chats.map((chat) => (
            <HarnessChatRow
              key={chat.sessionId}
              chat={chat}
              projectsById={projectsById}
              selected={isHarnessChatSelected(selection, chat.sessionId)}
              onToggle={() =>
                setSelection((current) => toggleHarnessChatSelection(current, chat.sessionId))
              }
            />
          ))
        )}
        {nextCursor !== null ? (
          <Pressable
            accessibilityRole="button"
            disabled={loadingMore}
            onPress={() => void loadPage(nextCursor)}
            className="border-t border-border-subtle p-4 disabled:opacity-40"
          >
            <Text className="text-center font-t3-medium text-foreground">
              {loadingMore ? "Loading…" : "View more"}
            </Text>
          </Pressable>
        ) : null}
        <View className="flex-row items-center gap-3 border-t border-border-subtle p-4">
          <Pressable
            accessibilityRole="button"
            disabled={refreshingStatus || chats.length === 0}
            onPress={() => void refreshLoadedStatuses()}
            className="flex-1 rounded-xl border border-border px-3 py-2 disabled:opacity-40"
          >
            <Text className="text-center font-t3-medium text-foreground">
              {refreshingStatus ? "Refreshing…" : "Refresh status"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: syncing, disabled: syncing || selectedCount === 0 }}
            disabled={syncing || selectedCount === 0}
            onPress={startSync}
            className="flex-1 rounded-xl bg-foreground px-3 py-2 disabled:opacity-40"
          >
            <Text className="text-center font-t3-medium text-background">
              {syncing ? "Syncing…" : "Sync selected"}
            </Text>
          </Pressable>
        </View>
      </SettingsSection>
      {changedMatching > 0 ? (
        <Text className="px-2 text-xs text-foreground-muted">
          {changedMatching}
          {countsAreComplete ? "" : "+"} matching chats have changes.
        </Text>
      ) : null}
      {lastResult ? (
        <View className="gap-1 px-2">
          <Text className="text-sm font-t3-medium text-foreground">
            {resultSummary(lastResult)}
          </Text>
          {lastResult.failures.map((failure) => (
            <Text
              key={`${failure.sessionId}:${failure.code}`}
              className="text-xs leading-normal text-danger-foreground"
            >
              {failure.message}
              {failure.retryable ? " Retry after fixing the source or project." : ""}
            </Text>
          ))}
        </View>
      ) : null}
      {error ? (
        <Pressable accessibilityRole="button" onPress={() => void loadPage(null)} className="px-2">
          <Text className="text-sm leading-normal text-danger-foreground">
            {error} Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      <HarnessChatTargetResolverModal
        key={resolverChat?.sessionId ?? "closed"}
        chat={resolverChat}
        unresolvedCount={selectedUnresolved.length}
        allowApplyToAll={selection.mode === "allMatching" || selectedUnresolved.length > 1}
        projects={props.projects}
        onClose={() => setResolverSessionId(null)}
        onResolve={resolveTarget}
      />
    </View>
  );
}

function HarnessChatSourceCard(props: {
  readonly environmentId: EnvironmentId;
  readonly source: HarnessChatSyncSource;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly onSynced: () => void;
  readonly active: boolean;
}) {
  if (props.source.status.kind === "supported") {
    return <SupportedHarnessChatSource {...props} />;
  }

  return (
    <SettingsSection card title={`${props.source.label} · ${props.source.driver}`}>
      <View className="gap-1 p-4">
        <Text className="text-base font-t3-medium text-foreground">
          {props.source.status.kind === "already-local" ? "Already local" : "Unavailable"}
        </Text>
        <Text className="text-sm leading-normal text-foreground-muted">
          {props.source.status.reason}
        </Text>
      </View>
    </SettingsSection>
  );
}

export function HarnessChatSyncEnvironment(props: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  const config = useEnvironmentServerConfig(props.environmentId);
  const discoverSources = useAtomCommand(agentSettingsEnvironment.harnessChatSync.sources, {
    reportFailure: false,
  });
  const supported = supportsHarnessChatSync(
    config?.environment.capabilities.harnessChatSyncVersion,
  );
  const [sources, setSources] = useState<ReadonlyArray<HarnessChatSyncSource> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<HarnessChatSyncSource["id"] | null>(null);
  const requestSequence = useRef(0);
  const activeSource =
    sources?.find((source) => source.id === activeSourceId) ??
    sources?.find((source) => source.status.kind === "supported") ??
    sources?.[0] ??
    null;

  const reload = useCallback(async () => {
    if (!supported) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError(null);
    const result = await discoverSources({ environmentId: props.environmentId, input: {} });
    if (requestSequence.current !== sequence) return;
    setLoading(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setError(failureMessage(result, "Could not discover harness chat sources."));
      }
      return;
    }
    setSources(result.value.sources);
  }, [discoverSources, props.environmentId, supported]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  if (!supported) return null;

  return (
    <View className="gap-4">
      <View className="gap-1 px-2">
        <Text className="text-xl font-t3-semibold text-foreground">Harness chat sync</Text>
        <Text className="text-sm leading-normal text-foreground-muted">
          {props.environmentLabel} · Review available chats, then sync only after you confirm the
          selection.
        </Text>
      </View>
      {sources === null ? (
        <SettingsSection card title={props.environmentLabel}>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void reload()}
            className="items-center gap-2 p-5"
          >
            {loading ? <ActivityIndicator size="small" /> : null}
            <Text className="text-center text-sm text-foreground-muted">
              {error ?? (loading ? "Finding harness chats…" : "Find harness chats")}
            </Text>
          </Pressable>
        </SettingsSection>
      ) : sources.length === 0 ? (
        <SettingsSection card title={props.environmentLabel}>
          <Text className="p-5 text-center text-sm leading-normal text-foreground-muted">
            No configured provider exposes a harness history source.
          </Text>
        </SettingsSection>
      ) : activeSource ? (
        <View className="gap-3">
          <View accessibilityRole="tablist" className="flex-row flex-wrap gap-2 px-1">
            {sources.map((source) => {
              const active = source.id === activeSource.id;
              return (
                <Pressable
                  key={source.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setActiveSourceId(source.id)}
                  className={
                    active
                      ? "min-w-36 flex-1 basis-[47%] max-w-[48%] items-center rounded-xl bg-foreground px-4 py-2"
                      : "min-w-36 flex-1 basis-[47%] max-w-[48%] items-center rounded-xl border border-border bg-card px-4 py-2"
                  }
                >
                  <Text
                    numberOfLines={1}
                    className={
                      active ? "font-t3-medium text-background" : "font-t3-medium text-foreground"
                    }
                  >
                    {source.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {sources.map((source) => {
            const active = source.id === activeSource.id;
            return (
              <View key={source.id} style={{ display: active ? "flex" : "none" }}>
                <HarnessChatSourceCard
                  environmentId={props.environmentId}
                  source={source}
                  projects={props.projects}
                  active={active}
                  onSynced={() => void reload()}
                />
              </View>
            );
          })}
        </View>
      ) : null}
      {sources !== null ? (
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void reload()}
          className="self-start px-2 py-1 disabled:opacity-40"
        >
          <Text className="font-t3-medium text-foreground">
            {loading ? "Refreshing sources…" : "Refresh sources"}
          </Text>
        </Pressable>
      ) : null}
      <Text className="px-2 text-xs leading-normal text-foreground-muted">
        Sync is additive and manual. It never removes T3 history or polls in the background.
      </Text>
    </View>
  );
}
