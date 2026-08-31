import { useAtomValue } from "@effect/atom-react";
import type {
  KnowledgeGraphEdgeV1,
  KnowledgeGraphNodeId,
  KnowledgeGraphNodeV1,
  KnowledgeGraphSourceExcerptV1,
  KnowledgeGraphScopeInput,
  KnowledgeGraphSnapshotV1,
} from "@t3tools/contracts";
import { EnvironmentId, ProjectId, ThreadId, resolveBetterT3FeatureFlag } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { AndroidScreenScaffold } from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { serverEnvironment } from "../../state/server";
import { knowledgeGraphEnvironment } from "../../state/knowledge-graph";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { useDebouncedValue } from "../../state/queries";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { KnowledgeGraphCanvas } from "./KnowledgeGraphCanvas";
import {
  knowledgeGraphDirectionMessageKey,
  knowledgeGraphEdgeKindMessageKey,
  knowledgeGraphNodeKindMessageKey,
  knowledgeGraphProvenanceMessageKey,
  knowledgeGraphSourceNavigationTarget,
  knowledgeGraphStatusMessageKey,
  mobileKnowledgeGraphClearConfirmationActions,
  resolveMobileKnowledgeGraphAccess,
  resolveMobileKnowledgeGraphActions,
  resolveMobileKnowledgeGraphRoutePolicy,
} from "./mobile-knowledge-graph";

type KnowledgeGraphRouteScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly projectId: string;
  readonly threadId?: string;
}>;

const KNOWLEDGE_GRAPH_SEARCH_DEBOUNCE_MS = 180;

type SourceNavigation = NativeStackNavigationProp<{
  ThreadFile: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly path: string[];
    readonly line?: string;
  };
}>;

function NodeDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | undefined;
  readonly node: KnowledgeGraphNodeV1;
  readonly snapshot: KnowledgeGraphSnapshotV1;
  readonly onSelectNode: (nodeId: KnowledgeGraphNodeId) => void;
  readonly onClose: () => void;
  readonly excerpts: ReadonlyArray<KnowledgeGraphSourceExcerptV1>;
}) {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation<SourceNavigation>();
  const target = knowledgeGraphSourceNavigationTarget({
    environmentId: props.environmentId,
    threadId: props.threadId,
    node: props.node,
  });
  const relationships = useMemo(() => {
    const nodesById = new Map(props.snapshot.nodes.map((node) => [node.nodeId, node] as const));
    const rows: Array<{
      readonly edge: KnowledgeGraphEdgeV1;
      readonly other: KnowledgeGraphNodeV1;
      readonly direction: "incoming" | "outgoing";
    }> = [];
    for (const edge of props.snapshot.edges) {
      if (edge.sourceNodeId === props.node.nodeId) {
        const other = nodesById.get(edge.targetNodeId);
        if (other) rows.push({ edge, other, direction: "outgoing" });
      }
      if (edge.targetNodeId === props.node.nodeId) {
        const other = nodesById.get(edge.sourceNodeId);
        if (other) rows.push({ edge, other, direction: "incoming" });
      }
    }
    return rows;
  }, [props.node.nodeId, props.snapshot.edges, props.snapshot.nodes]);

  return (
    <ScrollView
      className="bg-sheet"
      contentContainerClassName="gap-4 p-4"
      showsVerticalScrollIndicator={false}
    >
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-xl font-t3-bold text-foreground">{props.node.label}</Text>
          <Text className="text-sm text-foreground-muted">
            {translator.message(knowledgeGraphNodeKindMessageKey(props.node.kind))}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={translator.message("common.close")}
          accessibilityRole="button"
          className="size-10 items-center justify-center rounded-full bg-subtle"
          onPress={props.onClose}
        >
          <Text className="text-lg text-foreground">×</Text>
        </Pressable>
      </View>

      {props.node.summary ? (
        <Text className="text-base leading-normal text-foreground">{props.node.summary}</Text>
      ) : null}

      <View className="gap-1 rounded-2xl bg-card p-3">
        <Text className="text-sm text-foreground-muted">
          {translator.message("knowledgeGraph.provenance")}:{" "}
          {translator.message(knowledgeGraphProvenanceMessageKey(props.node.provenance))}
        </Text>
        <Text className="text-sm text-foreground-muted">
          {translator.message("knowledgeGraph.confidence")}:{" "}
          {translator.number(props.node.confidence, { style: "percent", maximumFractionDigits: 0 })}
        </Text>
        {props.node.source ? (
          <Text className="text-sm text-foreground-muted" selectable>
            {props.node.source.path}
            {props.node.source.startLine ? `:${props.node.source.startLine}` : ""}
          </Text>
        ) : null}
      </View>

      {props.node.source ? (
        <Pressable
          accessibilityRole="button"
          disabled={target === null}
          className={
            target === null
              ? "rounded-full bg-subtle px-4 py-3 opacity-50"
              : "rounded-full bg-primary px-4 py-3"
          }
          onPress={() => {
            if (target) navigation.navigate(target.screen, target.params);
          }}
        >
          <Text
            className={
              target === null
                ? "text-center font-t3-semibold text-foreground-muted"
                : "text-center font-t3-semibold text-primary-foreground"
            }
          >
            {target === null
              ? translator.message("knowledgeGraph.sourceUnavailable")
              : translator.message("knowledgeGraph.openSource")}
          </Text>
        </Pressable>
      ) : null}

      {props.excerpts.map((excerpt) => (
        <View
          key={`${excerpt.source.path}:${excerpt.source.startLine ?? 0}`}
          className="gap-2 rounded-2xl bg-card p-3"
        >
          <Text className="text-xs text-foreground-muted" selectable>
            {excerpt.source.path}
            {excerpt.source.startLine ? `:${excerpt.source.startLine}` : ""}
          </Text>
          <Text className="font-mono text-xs leading-normal text-foreground" selectable>
            {excerpt.excerpt}
          </Text>
        </View>
      ))}

      <View className="gap-2">
        <Text className="text-base font-t3-bold text-foreground">
          {translator.message("knowledgeGraph.relationships")}
        </Text>
        {relationships.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            {translator.message("knowledgeGraph.noRelationships")}
          </Text>
        ) : (
          relationships.map(({ edge, other, direction }) => (
            <Pressable
              key={edge.edgeId}
              accessibilityLabel={translator.message("knowledgeGraph.accessibility.relationship", {
                source: props.node.label,
                relationship: translator.message(knowledgeGraphEdgeKindMessageKey(edge.kind)),
                target: other.label,
              })}
              accessibilityRole="button"
              className="rounded-2xl border border-border bg-card p-3"
              onPress={() => props.onSelectNode(other.nodeId)}
            >
              <Text className="text-sm font-t3-semibold text-foreground">{other.label}</Text>
              <Text className="text-xs text-foreground-muted">
                {translator.message(knowledgeGraphDirectionMessageKey(direction))} ·{" "}
                {translator.message(knowledgeGraphEdgeKindMessageKey(edge.kind))} ·{" "}
                {translator.number(edge.confidence, {
                  style: "percent",
                  maximumFractionDigits: 0,
                })}
              </Text>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function GraphActions(props: {
  readonly snapshot: KnowledgeGraphSnapshotV1;
  readonly onRebuild: () => void;
  readonly onCancel: () => void;
  readonly onPause: (paused: boolean) => void;
  readonly onClear: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const actions = resolveMobileKnowledgeGraphActions(props.snapshot.status);
  return (
    <ScrollView
      horizontal
      contentContainerClassName="gap-2 px-3 py-2"
      showsHorizontalScrollIndicator={false}
    >
      <Pressable
        accessibilityRole="button"
        disabled={!actions.canRebuild}
        className="rounded-full border border-border bg-card px-4 py-2 disabled:opacity-40"
        onPress={props.onRebuild}
      >
        <Text className="text-sm font-t3-semibold text-foreground">
          {translator.message("knowledgeGraph.rebuild")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!actions.canPause}
        className="rounded-full border border-border bg-card px-4 py-2 disabled:opacity-40"
        onPress={() => props.onPause(actions.pauseAction === "pause")}
      >
        <Text className="text-sm font-t3-semibold text-foreground">
          {translator.message(
            actions.pauseAction === "pause" ? "knowledgeGraph.pause" : "knowledgeGraph.resume",
          )}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!actions.canCancel}
        className="rounded-full border border-border bg-card px-4 py-2 disabled:opacity-40"
        onPress={props.onCancel}
      >
        <Text className="text-sm font-t3-semibold text-foreground">
          {translator.message("knowledgeGraph.cancel")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!actions.canClear}
        className="rounded-full border border-danger-border bg-card px-4 py-2 disabled:opacity-40"
        onPress={props.onClear}
      >
        <Text className="text-sm font-t3-semibold text-danger-foreground">
          {translator.message("knowledgeGraph.clear")}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function DisabledKnowledgeGraphOwner(props: { readonly onClear: () => void }) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View className="items-center px-8 py-8">
      <Text className="text-center text-xl font-t3-bold text-foreground">
        {translator.message("knowledgeGraph.title")}
      </Text>
      <Text className="mt-2 text-center font-sans text-base leading-normal text-foreground-muted">
        {translator.message("knowledgeGraph.disabled")}
      </Text>
      <Text className="mt-2 text-center font-sans text-sm leading-normal text-foreground-muted">
        {translator.message("knowledgeGraph.clearConfirm.description")}
      </Text>
      <Pressable
        accessibilityRole="button"
        className="mt-5 rounded-full border border-danger-border bg-card px-5 py-3 active:opacity-70"
        onPress={props.onClear}
      >
        <Text className="text-sm font-t3-bold text-danger-foreground">
          {translator.message("knowledgeGraph.clear")}
        </Text>
      </Pressable>
    </View>
  );
}

export function KnowledgeGraphRouteScreen(props: KnowledgeGraphRouteScreenProps) {
  const translator = useMobileInterfaceTranslator();
  const environmentId = EnvironmentId.make(props.route.params.environmentId);
  const projectId = ProjectId.make(props.route.params.projectId);
  const threadId = props.route.params.threadId
    ? ThreadId.make(props.route.params.threadId)
    : undefined;
  const scope = useMemo<KnowledgeGraphScopeInput>(
    () => ({ projectId, ...(threadId === undefined ? {} : { threadId }) }),
    [projectId, threadId],
  );
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const enabled =
    config !== null &&
    resolveBetterT3FeatureFlag(config.settings.betterT3Environment, "knowledge.graph");
  const access = resolveMobileKnowledgeGraphAccess({
    knowledgeGraphVersion: config?.environment.capabilities.knowledgeGraphVersion,
    enabled,
  });
  const routePolicy = resolveMobileKnowledgeGraphRoutePolicy(access);
  const stateTarget = useMemo(
    () => (routePolicy.canSubscribe ? { environmentId, input: { scope } } : null),
    [environmentId, routePolicy.canSubscribe, scope],
  );
  const graph = useEnvironmentQuery(
    stateTarget === null ? null : knowledgeGraphEnvironment.state(stateTarget),
  );
  const rebuild = useAtomCommand(knowledgeGraphEnvironment.rebuild, { reportFailure: false });
  const cancel = useAtomCommand(knowledgeGraphEnvironment.cancel, { reportFailure: false });
  const pause = useAtomCommand(knowledgeGraphEnvironment.pause, { reportFailure: false });
  const clear = useAtomCommand(knowledgeGraphEnvironment.clear, { reportFailure: false });
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, KNOWLEDGE_GRAPH_SEARCH_DEBOUNCE_MS);
  const [selectedNodeId, setSelectedNodeId] = useState<KnowledgeGraphNodeId | null>(null);
  const state = graph.data;
  const snapshot = state?.snapshot ?? null;
  const searchTarget = useMemo(
    () =>
      routePolicy.canQuery && debouncedQuery.length > 0
        ? {
            environmentId,
            input: {
              scope,
              queries: [
                {
                  id: "mobile-search",
                  type: "search" as const,
                  text: debouncedQuery,
                  limit: 100,
                },
              ],
            },
          }
        : null,
    [debouncedQuery, environmentId, routePolicy.canQuery, scope],
  );
  const search = useEnvironmentQuery(
    searchTarget === null ? null : knowledgeGraphEnvironment.query(searchTarget),
  );
  const displayedSnapshot = useMemo(() => {
    const result = search.data?.results[0];
    if (
      snapshot === null ||
      result === undefined ||
      normalizedQuery.length === 0 ||
      normalizedQuery !== debouncedQuery
    ) {
      return snapshot;
    }
    return {
      ...snapshot,
      nodes: result.nodes,
      edges: result.edges,
      evidence: result.evidence,
      status: {
        ...snapshot.status,
        truncated: {
          ...snapshot.status.truncated,
          visibleNodes: result.truncated,
        },
      },
    } satisfies KnowledgeGraphSnapshotV1;
  }, [debouncedQuery, normalizedQuery, search.data?.results, snapshot]);
  const selectedNode = selectedNodeId
    ? (displayedSnapshot?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null)
    : null;
  const nodeContentTarget = useMemo(
    () =>
      routePolicy.canReadNodeContent && selectedNodeId !== null
        ? { environmentId, input: { scope, nodeId: selectedNodeId } }
        : null,
    [environmentId, routePolicy.canReadNodeContent, scope, selectedNodeId],
  );
  const nodeContent = useEnvironmentQuery(
    nodeContentTarget === null ? null : knowledgeGraphEnvironment.nodeContent(nodeContentTarget),
  );

  const runMutation = useCallback(
    async (label: string, operation: () => Promise<{ readonly _tag: string }>) => {
      const result = await operation();
      if (result._tag !== "Success") {
        Alert.alert(label, translator.message("knowledgeGraph.error"));
      }
    },
    [translator],
  );
  const requestRebuild = useCallback(() => {
    Alert.alert(translator.message("knowledgeGraph.rebuild"), undefined, [
      { text: translator.message("common.cancel"), style: "cancel" },
      {
        text: translator.message("knowledgeGraph.rebuild.incremental"),
        onPress: () =>
          void runMutation(translator.message("knowledgeGraph.rebuild"), () =>
            rebuild({ environmentId, input: { scope, mode: "incremental" } }),
          ),
      },
      {
        text: translator.message("knowledgeGraph.rebuild.full"),
        style: "destructive",
        onPress: () =>
          void runMutation(translator.message("knowledgeGraph.rebuild"), () =>
            rebuild({ environmentId, input: { scope, mode: "full" } }),
          ),
      },
    ]);
  }, [environmentId, rebuild, runMutation, scope, translator]);
  const requestClear = useCallback(() => {
    const actions = mobileKnowledgeGraphClearConfirmationActions({
      environmentId,
      scope,
      onConfirm: (target) =>
        void runMutation(translator.message("knowledgeGraph.clear"), () => clear(target)),
    });
    Alert.alert(
      translator.message("knowledgeGraph.clearConfirm.title"),
      translator.message("knowledgeGraph.clearConfirm.description"),
      [
        { text: translator.message("common.cancel"), ...actions[0] },
        {
          text: translator.message("knowledgeGraph.clear"),
          ...actions[1],
        },
      ],
    );
  }, [clear, environmentId, runMutation, scope, translator]);

  let content;
  if (access === "unsupported") {
    content = (
      <EmptyState
        title={translator.message("knowledgeGraph.title")}
        detail={translator.message("knowledgeGraph.unsupported")}
        variant="plain"
      />
    );
  } else if (access === "disabled") {
    content = <DisabledKnowledgeGraphOwner onClear={requestClear} />;
  } else if (graph.isPending && displayedSnapshot === null) {
    content = (
      <View className="flex-1 items-center justify-center gap-3">
        <ActivityIndicator size="large" />
        <Text className="text-base text-foreground-muted">
          {translator.message("knowledgeGraph.loading")}
        </Text>
      </View>
    );
  } else if (graph.error !== null) {
    content = (
      <EmptyState
        actionLabel={translator.message("knowledgeGraph.retry")}
        detail={graph.error}
        onAction={graph.refresh}
        title={translator.message("knowledgeGraph.title")}
        variant="plain"
      />
    );
  } else if (displayedSnapshot === null) {
    content = (
      <EmptyState
        actionLabel={translator.message("knowledgeGraph.rebuild")}
        detail={translator.message("knowledgeGraph.empty")}
        onAction={requestRebuild}
        title={translator.message("knowledgeGraph.title")}
        variant="plain"
      />
    );
  } else {
    content = (
      <View className="flex-1">
        <View className="px-3 pt-3">
          <TextInput
            accessibilityLabel={translator.message("knowledgeGraph.search.label")}
            autoCapitalize="none"
            autoCorrect={false}
            className="h-12 rounded-2xl border border-input-border bg-input px-4 text-base text-foreground"
            onChangeText={setQuery}
            placeholder={translator.message("knowledgeGraph.search.placeholder")}
            placeholderTextColorClassName="accent-placeholder"
            value={query}
          />
        </View>
        <GraphActions
          onCancel={() =>
            void runMutation(translator.message("knowledgeGraph.cancel"), () =>
              cancel({ environmentId, input: { scope } }),
            )
          }
          onClear={requestClear}
          onPause={(paused) =>
            void runMutation(
              translator.message(paused ? "knowledgeGraph.pause" : "knowledgeGraph.resume"),
              () => pause({ environmentId, input: { scope, paused } }),
            )
          }
          onRebuild={requestRebuild}
          snapshot={displayedSnapshot}
        />
        <View className="flex-row items-center justify-between gap-3 px-4 pb-2">
          <Text className="text-xs font-t3-semibold text-foreground-muted">
            {translator.message(knowledgeGraphStatusMessageKey(displayedSnapshot.status.state))}
          </Text>
          {displayedSnapshot.status.truncated.visibleNodes ||
          displayedSnapshot.status.truncated.nodes ? (
            <Text className="shrink text-right text-xs text-foreground-muted">
              {displayedSnapshot.status.truncated.omittedNodeCount > 0
                ? translator.message("knowledgeGraph.omittedNodes", {
                    count: displayedSnapshot.status.truncated.omittedNodeCount,
                  })
                : translator.message("knowledgeGraph.truncated")}
            </Text>
          ) : null}
        </View>
        <View className={tablet ? "flex-1 flex-row gap-3 px-3 pb-3" : "flex-1 gap-3 px-3 pb-3"}>
          <View className="min-h-[240px] flex-1">
            <KnowledgeGraphCanvas
              onSelectNode={setSelectedNodeId}
              query={query}
              selectedNodeId={selectedNodeId}
              snapshot={displayedSnapshot}
            />
          </View>
          {selectedNode ? (
            <View
              className={
                tablet
                  ? "w-[340px] overflow-hidden rounded-[24px] border border-border"
                  : "max-h-[300px] overflow-hidden rounded-[24px] border border-border"
              }
            >
              <NodeDetails
                environmentId={environmentId}
                excerpts={nodeContent.data?.excerpts ?? []}
                node={selectedNode}
                onClose={() => setSelectedNodeId(null)}
                onSelectNode={setSelectedNodeId}
                snapshot={displayedSnapshot}
                threadId={threadId}
              />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <AndroidScreenScaffold title={translator.message("knowledgeGraph.title")}>
      <NativeStackScreenOptions options={{ title: translator.message("knowledgeGraph.title") }} />
      {content}
    </AndroidScreenScaffold>
  );
}
