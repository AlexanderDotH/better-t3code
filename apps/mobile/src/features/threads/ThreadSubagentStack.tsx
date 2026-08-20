import type {
  EnvironmentId,
  OrchestrationSubagentDetail,
  OrchestrationSubagentSummary,
  SubagentId,
  ThreadId,
} from "@t3tools/contracts";
import { requestOlderSubagentActivities } from "@t3tools/client-runtime/state/threads";
import { useIsFocused } from "@react-navigation/native";
import * as Option from "effect/Option";
import { memo, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  useColorScheme,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { useEnvironmentSubagent } from "../../state/threads";
import {
  CLOSED_MOBILE_SUBAGENT_HISTORY_STATE,
  deriveMobileSubagentGroups,
  deriveMobileSubagentTranscript,
  mobileSubagentDisplayName,
  mobileSubagentHistoryIsVisible,
  mobileSubagentTranscriptEntryKey,
  nextRecentSubagentExpiryDelayMs,
  reduceMobileSubagentHistory,
  type MobileSubagentTranscriptEntry,
} from "./subagent-presentation";

const SUBAGENT_LIST_INITIAL_RENDER_COUNT = 12;
const SUBAGENT_LIST_RENDER_BATCH_SIZE = 12;
const SUBAGENT_TRANSCRIPT_INITIAL_RENDER_COUNT = 10;
const SUBAGENT_TRANSCRIPT_RENDER_BATCH_SIZE = 8;

function statusClasses(agent: OrchestrationSubagentSummary): string {
  if (agent.status === "completed") return "border-emerald-500/30 bg-emerald-500/10";
  if (agent.status === "error" || agent.status === "unavailable") {
    return "border-red-500/30 bg-red-500/10";
  }
  if (agent.status === "waiting") return "border-amber-500/30 bg-amber-500/10";
  return "border-blue-500/30 bg-blue-500/10";
}

function AgentChip(props: {
  readonly agent: OrchestrationSubagentSummary;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Inspect ${mobileSubagentDisplayName(props.agent)}`}
      className={`min-h-9 flex-row items-center gap-2 rounded-full border px-3 active:opacity-65 ${statusClasses(props.agent)}`}
      onPress={props.onPress}
    >
      {props.agent.status === "starting" || props.agent.status === "running" ? (
        <ActivityIndicator size="small" />
      ) : (
        <View
          className={`h-2 w-2 rounded-full ${
            props.agent.status === "completed"
              ? "bg-emerald-500"
              : props.agent.status === "waiting"
                ? "bg-amber-500"
                : "bg-red-500"
          }`}
        />
      )}
      <Text className="max-w-40 font-t3-bold text-xs text-foreground" numberOfLines={1}>
        {mobileSubagentDisplayName(props.agent)}
      </Text>
    </Pressable>
  );
}

function SubagentTranscript(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly subagentId: SubagentId;
}) {
  const state = useEnvironmentSubagent(props.environmentId, props.threadId, props.subagentId);
  const detail = Option.getOrNull(state.data);
  const error = Option.getOrNull(state.error);
  const page = Option.getOrNull(state.page);
  const loadOlderActivities = useCallback(() => {
    requestOlderSubagentActivities(props.environmentId, props.threadId, props.subagentId);
  }, [props.environmentId, props.subagentId, props.threadId]);

  if (!detail && (state.status === "empty" || state.status === "synchronizing")) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-6">
        <ActivityIndicator />
        <Text className="text-sm text-foreground-muted">Loading agent transcript…</Text>
      </View>
    );
  }
  if (!detail) {
    return (
      <View className="flex-1 items-center justify-center gap-2 px-6">
        <Text className="font-t3-bold text-base text-foreground">Transcript unavailable</Text>
        {error ? <Text className="text-center text-sm text-danger">{error}</Text> : null}
      </View>
    );
  }
  return (
    <SubagentTranscriptContent
      detail={detail}
      error={error}
      hasOlderActivities={page?.hasMore ?? false}
      isLoadingOlderActivities={page?.loadingOlder ?? false}
      onLoadOlderActivities={loadOlderActivities}
    />
  );
}

function SubagentTranscriptContent(props: {
  readonly detail: OrchestrationSubagentDetail;
  readonly error: string | null;
  readonly hasOlderActivities: boolean;
  readonly isLoadingOlderActivities: boolean;
  readonly onLoadOlderActivities: () => void;
}) {
  const entries = useMemo(() => deriveMobileSubagentTranscript(props.detail), [props.detail]);
  const renderEntry = useCallback(
    ({ item }: ListRenderItemInfo<MobileSubagentTranscriptEntry>) => (
      <MobileSubagentTranscriptEntryView entry={item} />
    ),
    [],
  );
  return (
    <FlatList
      className="flex-1"
      data={entries}
      keyExtractor={mobileSubagentTranscriptEntryKey}
      initialNumToRender={SUBAGENT_TRANSCRIPT_INITIAL_RENDER_COUNT}
      maxToRenderPerBatch={SUBAGENT_TRANSCRIPT_RENDER_BATCH_SIZE}
      updateCellsBatchingPeriod={16}
      windowSize={7}
      removeClippedSubviews={Platform.OS === "android"}
      contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 40, paddingTop: 16 }}
      renderItem={renderEntry}
      ListHeaderComponent={
        <View className="gap-3">
          <View className="rounded-2xl border border-border bg-card px-4 py-3">
            <Text className="font-t3-bold text-base text-foreground">
              {mobileSubagentDisplayName(props.detail)}
            </Text>
            <Text className="mt-1 text-xs text-foreground-muted">
              {[props.detail.status, props.detail.model, props.detail.reasoningEffort]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {props.detail.latestProgress ? (
              <Text className="mt-2 text-sm text-foreground-secondary">
                {props.detail.latestProgress.summary}
              </Text>
            ) : null}
            {props.error ? <Text className="mt-2 text-xs text-danger">{props.error}</Text> : null}
          </View>
          {props.hasOlderActivities ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Load earlier agent activity"
              disabled={props.isLoadingOlderActivities}
              className="min-h-10 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 active:opacity-65 disabled:opacity-55"
              onPress={props.onLoadOlderActivities}
            >
              {props.isLoadingOlderActivities ? <ActivityIndicator size="small" /> : null}
              <Text className="font-t3-bold text-xs text-foreground">
                {props.isLoadingOlderActivities
                  ? "Loading earlier activity…"
                  : "Load earlier activity"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <Text className="py-12 text-center text-sm text-foreground-muted">
          No transcript events yet.
        </Text>
      }
    />
  );
}

function MobileSubagentTranscriptEntryView(props: {
  readonly entry: MobileSubagentTranscriptEntry;
}) {
  const entry = props.entry;
  if (entry.type === "message") {
    return (
      <View
        className={`rounded-2xl px-4 py-3 ${
          entry.message.role === "user" ? "self-end bg-primary" : "border border-border bg-card"
        }`}
        style={{ maxWidth: "92%" }}
      >
        <Text
          className={`mb-1 font-t3-bold text-2xs uppercase tracking-widest ${
            entry.message.role === "user" ? "text-primary-foreground/70" : "text-foreground-muted"
          }`}
        >
          {entry.message.role}
        </Text>
        <Text
          selectable
          className={`text-sm leading-relaxed ${
            entry.message.role === "user" ? "text-primary-foreground" : "text-foreground"
          }`}
        >
          {entry.message.text}
        </Text>
      </View>
    );
  }
  if (entry.type === "proposed-plan") {
    return (
      <View className="rounded-2xl border border-blue-500/25 bg-blue-500/5 px-4 py-3">
        <Text className="mb-2 font-t3-bold text-xs uppercase tracking-widest text-blue-600 dark:text-blue-400">
          Proposed plan
        </Text>
        <Text selectable className="font-mono text-xs leading-relaxed text-foreground">
          {entry.proposedPlan.planMarkdown}
        </Text>
      </View>
    );
  }
  return (
    <View className="rounded-xl bg-subtle px-3 py-2.5">
      <Text className="text-xs text-foreground-secondary">{entry.activity.summary}</Text>
    </View>
  );
}

export const ThreadSubagentStack = memo(function ThreadSubagentStack(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly subagents: ReadonlyArray<OrchestrationSubagentSummary>;
}) {
  const iconColor = useThemeColor("--color-icon-subtle");
  const screenColor = useThemeColor("--color-screen");
  const isDark = useColorScheme() === "dark";
  const routeIsFocused = useIsFocused();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [history, dispatchHistory] = useReducer(
    reduceMobileSubagentHistory,
    CLOSED_MOBILE_SUBAGENT_HISTORY_STATE,
  );
  const groups = useMemo(
    () => deriveMobileSubagentGroups(props.subagents, nowMs),
    [nowMs, props.subagents],
  );
  const visible = useMemo(() => {
    const byId = new Map<SubagentId, OrchestrationSubagentSummary>();
    for (const agent of [...groups.active, ...groups.recent]) byId.set(agent.id, agent);
    return [...byId.values()];
  }, [groups.active, groups.recent]);
  const historyAgents = useMemo(
    () => [...groups.active, ...groups.history],
    [groups.active, groups.history],
  );

  const openAgent = useCallback((subagentId: SubagentId) => {
    dispatchHistory({ type: "open", subagentId });
  }, []);
  const closeHistory = useCallback(() => {
    dispatchHistory({ type: "close" });
  }, []);
  const renderVisibleAgent = useCallback(
    ({ item }: ListRenderItemInfo<OrchestrationSubagentSummary>) => (
      <AgentChip agent={item} onPress={() => openAgent(item.id)} />
    ),
    [openAgent],
  );
  const renderHistoryAgent = useCallback(
    ({ item }: ListRenderItemInfo<OrchestrationSubagentSummary>) => (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: item.id === history.selectedSubagentId }}
        className={`rounded-full px-3 py-2 active:opacity-65 ${
          item.id === history.selectedSubagentId ? "bg-primary" : "bg-subtle"
        }`}
        onPress={() => dispatchHistory({ type: "select", subagentId: item.id })}
      >
        <Text
          className={`font-t3-bold text-xs ${
            item.id === history.selectedSubagentId ? "text-primary-foreground" : "text-foreground"
          }`}
        >
          {mobileSubagentDisplayName(item)}
        </Text>
      </Pressable>
    ),
    [history.selectedSubagentId],
  );

  useEffect(() => setNowMs(Date.now()), [props.subagents]);
  useEffect(() => {
    const delay = nextRecentSubagentExpiryDelayMs(groups.recent, nowMs);
    if (delay === null) return;
    const timeout = setTimeout(() => setNowMs(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [groups.recent, nowMs]);
  useEffect(() => {
    closeHistory();
  }, [closeHistory, props.environmentId, props.threadId]);
  useEffect(() => {
    if (!routeIsFocused) closeHistory();
  }, [closeHistory, routeIsFocused]);

  if (visible.length === 0 && groups.history.length === 0) return null;

  const selectedSummary =
    props.subagents.find((agent) => agent.id === history.selectedSubagentId) ?? null;
  const historyIsVisible = mobileSubagentHistoryIsVisible(history, routeIsFocused);

  return (
    <>
      <View className="mb-3 flex-row items-center gap-2 px-4">
        <FlatList
          className="min-w-0 flex-1"
          horizontal
          data={visible}
          keyExtractor={(agent) => agent.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          initialNumToRender={SUBAGENT_LIST_INITIAL_RENDER_COUNT}
          maxToRenderPerBatch={SUBAGENT_LIST_RENDER_BATCH_SIZE}
          windowSize={5}
          removeClippedSubviews={Platform.OS === "android"}
          renderItem={renderVisibleAgent}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open agent history"
          className="min-h-9 shrink-0 flex-row items-center gap-1.5 rounded-full border border-border bg-card px-3 active:opacity-65"
          onPress={() => {
            dispatchHistory({
              type: "open",
              subagentId: history.selectedSubagentId ?? props.subagents[0]?.id ?? null,
            });
          }}
        >
          <SymbolView name="person.2" size={14} tintColor={iconColor} type="monochrome" />
          <Text className="font-t3-bold text-xs text-foreground">{props.subagents.length}</Text>
        </Pressable>
      </View>

      {historyIsVisible ? (
        <Modal
          animationType="slide"
          presentationStyle="pageSheet"
          visible
          onRequestClose={closeHistory}
        >
          <SafeAreaView
            className="flex-1 bg-screen"
            edges={["top", "bottom"]}
            style={{ backgroundColor: screenColor }}
          >
            <View className="flex-row items-center border-b border-border px-4 py-3">
              <Text className="min-w-0 flex-1 font-t3-bold text-lg text-foreground">Agents</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close agent history"
                className="h-9 w-9 items-center justify-center rounded-full bg-subtle active:opacity-65"
                onPress={closeHistory}
              >
                <SymbolView
                  name="xmark"
                  size={15}
                  tintColor={isDark ? "#ffffff" : "#111111"}
                  type="monochrome"
                />
              </Pressable>
            </View>
            <FlatList
              horizontal
              data={historyAgents}
              extraData={history.selectedSubagentId}
              keyExtractor={(agent) => agent.id}
              className="max-h-14 border-b border-border"
              contentContainerStyle={{
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
              showsHorizontalScrollIndicator={false}
              initialNumToRender={SUBAGENT_LIST_INITIAL_RENDER_COUNT}
              maxToRenderPerBatch={SUBAGENT_LIST_RENDER_BATCH_SIZE}
              windowSize={5}
              removeClippedSubviews={Platform.OS === "android"}
              renderItem={renderHistoryAgent}
            />
            {selectedSummary ? (
              <SubagentTranscript
                key={selectedSummary.id}
                environmentId={props.environmentId}
                threadId={props.threadId}
                subagentId={selectedSummary.id}
              />
            ) : (
              <View className="flex-1 items-center justify-center px-6">
                <Text className="text-sm text-foreground-muted">Select an agent to inspect.</Text>
              </View>
            )}
          </SafeAreaView>
        </Modal>
      ) : null}
    </>
  );
});
