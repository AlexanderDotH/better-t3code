import {
  PROJECT_INDEX_DEFAULT_QUERY_TOKENS,
  type EnvironmentId,
  type ProjectContextInput,
  type ProjectCallsiteV1,
  type ProjectEntityV1,
  type ProjectIndexQueryResultV1,
  type ProjectIndexStatusV1,
  type ProjectIndexScopeInput,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useDebouncedValue } from "../../state/queries";
import { KnowledgeGraphCanvas } from "../knowledge-graph/KnowledgeGraphCanvas";
import { SettingsSection } from "../settings/components/SettingsSection";
import { ProjectIndexActionButton } from "./ProjectIndexControls";
import { ProjectIndexSourceButton } from "./ProjectIndexSourceButton";
import { ProjectIndexFacts } from "./ProjectIndexFacts";
import { ProjectIndexVerification } from "./ProjectIndexVerification";
import { mobileProjectIndexGraphView } from "./mobile-project-index-graph";
import { mobileProjectIndexQuery } from "./mobile-project-indexing";
import {
  captureMobileProjectIndexEntity,
  nextMobileProjectIndexEntityContext,
  resolveMobileProjectIndexEntity,
  type MobileProjectIndexEntityAnchor,
} from "./mobile-project-index-detail";
import { mobileStaticProjectIndexResult } from "./mobile-project-index-facts";

const SEARCH_DEBOUNCE_MS = 180;
const MAX_VISIBLE_CALLSITES = 40;
const MAX_VISIBLE_UNRESOLVED_CALLSITES = 8;
const MAX_VISIBLE_EVIDENCE = 6;

function CallsiteCard(props: {
  readonly callsite: ProjectCallsiteV1;
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
}) {
  const translator = useMobileInterfaceTranslator();
  const { callsite } = props;
  return (
    <View className="gap-1 rounded-xl bg-subtle p-3">
      <Text className="font-mono text-xs text-foreground" selectable>
        {callsite.expression}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {translator.message(`projectIndexing.resolution.${callsite.resolution}`)} ·{" "}
        {translator.message(`projectIndexing.freshness.${callsite.freshness}`)}
      </Text>
      <Text className="text-xs text-foreground-muted" selectable>
        {callsite.filePath}:{callsite.range.startLine}
      </Text>
      {callsite.reason ? (
        <Text className="text-sm text-foreground-muted">{callsite.reason}</Text>
      ) : null}
      <ProjectIndexSourceButton
        environmentId={props.environmentId}
        scope={props.scope}
        source={callsite}
      />
    </View>
  );
}

function EntityDetails(props: {
  readonly entity: ProjectEntityV1;
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly result: ProjectIndexQueryResultV1;
  readonly loading: boolean;
  readonly canLoadMoreContext: boolean;
  readonly onLoadMoreContext: () => void;
  readonly onLoadEntity: (entityId: string) => void;
  readonly onExplore: (
    entity: ProjectEntityV1,
    operation: "entity" | "callers" | "callees",
  ) => void;
  readonly onClose: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  const entity = props.entity;
  const evidence = props.result.evidence.filter((entry) => entity.evidenceIds.includes(entry.id));
  const container = entity.containerId
    ? props.result.entities.find((candidate) => candidate.id === entity.containerId)
    : null;

  return (
    <View className="gap-4 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-lg font-t3-semibold text-foreground" selectable>
            {entity.qualifiedName}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {translator.message(`projectIndexing.kind.${entity.kind}`)} ·{" "}
            {translator.message(`projectIndexing.freshness.${entity.freshness}`)}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {translator.message(`projectIndexing.provenance.${entity.provenance}`)}
          </Text>
        </View>
        <ProjectIndexActionButton
          label={translator.message("common.close")}
          onPress={props.onClose}
        />
      </View>
      <Text className="text-xs text-foreground-muted" selectable>
        {entity.filePath}:{entity.range.startLine}–{entity.range.endLine}
      </Text>
      {entity.signature ? (
        <Text className="font-mono text-sm text-foreground" selectable>
          {entity.signature}
        </Text>
      ) : null}
      {entity.containerId ? (
        <ProjectIndexActionButton
          label={
            container
              ? translator.message("projectIndexing.container", { name: container.qualifiedName })
              : translator.message("projectIndexing.loadContainer")
          }
          disabled={props.loading}
          onPress={() => {
            if (entity.containerId) props.onLoadEntity(entity.containerId);
          }}
        />
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <ProjectIndexSourceButton
          environmentId={props.environmentId}
          scope={props.scope}
          source={entity}
        />
        <ProjectIndexActionButton
          label={translator.message("projectIndexing.callers")}
          disabled={props.loading}
          onPress={() => props.onExplore(entity, "callers")}
        />
        <ProjectIndexActionButton
          label={translator.message("projectIndexing.callees")}
          disabled={props.loading}
          onPress={() => props.onExplore(entity, "callees")}
        />
      </View>
      {evidence.length > 0 ? (
        <View className="gap-2">
          <Text className="font-t3-semibold text-foreground">
            {translator.message("projectIndexing.evidence")}
          </Text>
          {evidence.slice(0, MAX_VISIBLE_EVIDENCE).map((entry) => (
            <View key={entry.id} className="gap-2 rounded-xl bg-subtle p-3">
              <Text className="text-xs text-foreground-muted" selectable>
                {entry.filePath}:{entry.range.startLine}
              </Text>
              {entry.excerpt ? (
                <Text className="font-mono text-xs text-foreground" selectable>
                  {entry.excerpt}
                </Text>
              ) : null}
              <ProjectIndexSourceButton
                environmentId={props.environmentId}
                scope={props.scope}
                source={entry}
              />
            </View>
          ))}
        </View>
      ) : null}
      {props.result.truncated || evidence.length > MAX_VISIBLE_EVIDENCE ? (
        <Text className="text-xs text-foreground-muted">
          {translator.message("projectIndexing.detailTruncated")}
        </Text>
      ) : null}
      {props.canLoadMoreContext ? (
        <ProjectIndexActionButton
          label={translator.message("projectIndexing.loadMoreContext")}
          disabled={props.loading}
          onPress={props.onLoadMoreContext}
        />
      ) : null}
    </View>
  );
}

export function ProjectIndexExplorer(props: {
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly status: ProjectIndexStatusV1;
  readonly result: ProjectIndexQueryResultV1 | null;
  readonly invalidated: boolean;
  readonly refreshEpoch: number;
  readonly onQuery: (input: ProjectContextInput) => Promise<ProjectIndexQueryResultV1>;
}) {
  const translator = useMobileInterfaceTranslator();
  const { onQuery } = props;
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const [text, setText] = useState("");
  const normalizedText = text.trim();
  const debouncedText = useDebouncedValue(normalizedText, SEARCH_DEBOUNCE_MS);
  const [selection, setSelection] = useState<{
    readonly entityId: string;
    readonly operation: "entity" | "callers" | "callees";
    readonly maxTokens: number;
    readonly anchor: MobileProjectIndexEntityAnchor | null;
  } | null>(null);
  const selectedId = selection?.entityId ?? null;
  const operation = selection?.operation ?? "entity";
  const maxTokens = selection?.maxTokens ?? PROJECT_INDEX_DEFAULT_QUERY_TOKENS;
  const anchor = selection?.anchor ?? null;
  const contextKey = JSON.stringify([
    props.status.scope.scopeId,
    props.status.scope.workspaceFingerprint,
    props.status.revision,
  ]);
  const [cursorPage, setCursor] = useState<
    { readonly value: string; readonly contextKey: string } | undefined
  >();
  const cursor = cursorPage?.contextKey === contextKey ? cursorPage.value : undefined;
  const [settledQuery, setSettledQuery] = useState<{
    readonly key: string;
    readonly displayedViewKey: string | null;
    readonly continuation: boolean;
    readonly error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const request = useMemo(
    () =>
      mobileProjectIndexQuery({
        text: debouncedText,
        selection: selectedId ? { entityId: selectedId, operation } : null,
        maxTokens,
        ...(cursor ? { cursor } : {}),
      }),
    [cursor, debouncedText, maxTokens, operation, selectedId],
  );
  const busyJob = props.status.job?.state === "running" || props.status.job?.state === "queued";
  const settledRevision = busyJob ? null : props.status.revision;
  const queryKey = JSON.stringify([request, settledRevision, props.refreshEpoch, retry]);
  const viewKey = JSON.stringify([
    props.status.scope.scopeId,
    props.status.scope.workspaceFingerprint,
    operation,
    selectedId,
    debouncedText,
  ]);
  const loading = normalizedText !== debouncedText || settledQuery?.key !== queryKey;
  const queryError = settledQuery?.key === queryKey ? settledQuery.error : null;

  useEffect(() => {
    if (normalizedText !== debouncedText) return;
    let active = true;
    void onQuery(request).then(
      (response) => {
        if (!active) return;
        if (request.entityId) {
          const updatedAnchor = captureMobileProjectIndexEntity(
            mobileStaticProjectIndexResult(response),
            request.entityId,
          );
          if (updatedAnchor)
            setSelection((current) =>
              current !== null && current.entityId === request.entityId
                ? { ...current, anchor: updatedAnchor }
                : current,
            );
        }
        setSettledQuery({
          key: queryKey,
          displayedViewKey: viewKey,
          continuation: request.cursor !== undefined,
          error: null,
        });
      },
      (error: unknown) => {
        if (active)
          setSettledQuery((current) => ({
            key: queryKey,
            displayedViewKey: current?.displayedViewKey ?? null,
            continuation: current?.continuation ?? false,
            error:
              error instanceof Error ? error.message : translator.message("knowledgeGraph.error"),
          }));
      },
    );
    return () => {
      active = false;
    };
  }, [debouncedText, normalizedText, onQuery, queryKey, request, translator, viewKey]);

  const queryResult =
    !props.invalidated &&
    settledQuery?.displayedViewKey === viewKey &&
    props.result?.operation === request.operation &&
    props.result.revision === props.status.revision &&
    props.result.scope.scopeId === props.status.scope.scopeId &&
    props.result.scope.workspaceFingerprint === props.status.scope.workspaceFingerprint &&
    normalizedText === debouncedText
      ? props.result
      : null;
  const result = useMemo(
    () => (queryResult ? mobileStaticProjectIndexResult(queryResult) : null),
    [queryResult],
  );
  const noPublishedIndex =
    !props.invalidated &&
    settledQuery?.key === queryKey &&
    settledQuery?.displayedViewKey === viewKey &&
    queryError === null &&
    props.result?.revision === 0 &&
    props.result.scope.scopeId === props.status.scope.scopeId &&
    props.result.scope.workspaceFingerprint === props.status.scope.workspaceFingerprint;
  const selectedEntity = useMemo(
    () =>
      result && selectedId ? resolveMobileProjectIndexEntity(result, selectedId, anchor) : null,
    [anchor, result, selectedId],
  );
  const graph = useMemo(() => {
    if (!result) return null;
    return mobileProjectIndexGraphView(result, selectedId ?? undefined, anchor);
  }, [anchor, result, selectedId]);
  const selectEntity = useCallback(
    (entityId: string, nextOperation: "entity" | "callers" | "callees" = "entity") => {
      setSelection((current) => ({
        entityId,
        operation: nextOperation,
        maxTokens: PROJECT_INDEX_DEFAULT_QUERY_TOKENS,
        anchor:
          (result ? captureMobileProjectIndexEntity(result, entityId) : null) ??
          (current?.entityId === entityId ? current.anchor : null),
      }));
      setCursor(undefined);
    },
    [result],
  );
  const explore = useCallback(
    (entity: ProjectEntityV1, nextOperation: "entity" | "callers" | "callees") => {
      selectEntity(entity.id, nextOperation);
    },
    [selectEntity],
  );
  const nextContext =
    selectedId && result
      ? nextMobileProjectIndexEntityContext({ entityId: selectedId, request, result })
      : null;
  const confirmedCallsites =
    result?.callsites.filter((callsite) => callsite.resolution === "resolved") ?? [];
  const unresolvedCallsites =
    result?.callsites.filter((callsite) => callsite.resolution !== "resolved") ?? [];
  const loadMoreContext = () => {
    if (!nextContext || loading) return;
    setSelection((current) =>
      current ? { ...current, operation: "entity", maxTokens: nextContext.maxTokens } : current,
    );
    setCursor(nextContext.cursor ? { value: nextContext.cursor, contextKey } : undefined);
  };

  return (
    <SettingsSection title={translator.message("projectIndexing.graph")}>
      <View className="gap-4 p-4">
        {noPublishedIndex ? (
          <View className="gap-1 rounded-2xl bg-subtle p-4">
            <Text className="text-sm font-t3-semibold text-foreground">
              {translator.message("projectIndexing.noSearchableIndex")}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {translator.message("projectIndexing.noSearchableIndexHint")}
            </Text>
          </View>
        ) : (
          <>
            <TextInput
              accessibilityLabel={translator.message("projectIndexing.search")}
              placeholder={translator.message("projectIndexing.searchPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              value={text}
              onChangeText={(value) => {
                setText(value);
                setSelection(null);
                setCursor(undefined);
              }}
            />
            {loading || props.invalidated ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator />
                <Text className="text-sm text-foreground-muted">
                  {translator.message("projectIndexing.loadingEntities")}
                </Text>
              </View>
            ) : null}
            {queryError ? (
              <View className="gap-2">
                <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                  {queryError}
                </Text>
                <ProjectIndexActionButton
                  label={translator.message("projectIndexing.refreshResults")}
                  onPress={() => {
                    setCursor(undefined);
                    setRetry((value) => value + 1);
                  }}
                />
              </View>
            ) : null}
            {result && graph ? (
              <>
                {result.verification ? (
                  <ProjectIndexVerification verification={result.verification} />
                ) : null}
                <View className={tablet ? "flex-row gap-4" : "gap-4"}>
                  <View className={tablet ? "h-[340px] min-w-0 flex-1" : "h-[340px]"}>
                    <KnowledgeGraphCanvas
                      view={graph.view}
                      query=""
                      selectedNodeId={
                        selectedId ? (graph.entityNodeIds.get(selectedId) ?? null) : null
                      }
                      onSelectNode={(nodeId) => {
                        if (nodeId === null) {
                          setSelection(null);
                          setCursor(undefined);
                          return;
                        }
                        const entityId = graph.nodeEntityIds.get(nodeId);
                        if (entityId) selectEntity(entityId);
                      }}
                    />
                  </View>
                  <ScrollView
                    nestedScrollEnabled
                    className={tablet ? "max-h-[340px] w-[280px]" : "max-h-[280px]"}
                    contentContainerClassName="gap-2"
                  >
                    {result.entities.map((entity) => (
                      <Pressable
                        key={entity.id}
                        accessibilityRole="button"
                        className="min-h-12 gap-1 rounded-2xl border border-border bg-card p-3"
                        onPress={() => explore(entity, "entity")}
                      >
                        <Text className="text-sm font-t3-semibold text-foreground">
                          {entity.qualifiedName}
                        </Text>
                        <Text className="text-xs text-foreground-muted">
                          {translator.message(`projectIndexing.kind.${entity.kind}`)} ·{" "}
                          {translator.message(`projectIndexing.freshness.${entity.freshness}`)}
                        </Text>
                        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                          {entity.filePath}:{entity.range.startLine}
                        </Text>
                      </Pressable>
                    ))}
                    {result.entities.length === 0 ? (
                      <Text className="text-sm text-foreground-muted">
                        {translator.message(
                          selectedId
                            ? "projectIndexing.detailTruncated"
                            : debouncedText
                              ? "projectIndexing.noResults"
                              : "projectIndexing.noEntities",
                        )}
                      </Text>
                    ) : null}
                  </ScrollView>
                </View>
                <Text className="text-xs text-foreground-muted">
                  {translator.message("projectIndexing.graphLegend")}
                </Text>
                {result.truncated || graph.truncated ? (
                  <Text className="text-xs text-foreground-muted">
                    {translator.message("projectIndexing.queryTruncated")}
                  </Text>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  {cursor || maxTokens > PROJECT_INDEX_DEFAULT_QUERY_TOKENS ? (
                    <ProjectIndexActionButton
                      label={translator.message("projectIndexing.firstPage")}
                      onPress={() => {
                        setCursor(undefined);
                        setSelection((current) =>
                          current
                            ? { ...current, maxTokens: PROJECT_INDEX_DEFAULT_QUERY_TOKENS }
                            : current,
                        );
                      }}
                    />
                  ) : null}
                  {result.nextCursor && result.nextCursor !== cursor ? (
                    <ProjectIndexActionButton
                      label={translator.message("projectIndexing.nextPage")}
                      disabled={loading}
                      onPress={() =>
                        setCursor(
                          result.nextCursor ? { value: result.nextCursor, contextKey } : undefined,
                        )
                      }
                    />
                  ) : null}
                </View>
                {selectedEntity ? (
                  <EntityDetails
                    entity={selectedEntity}
                    result={result}
                    environmentId={props.environmentId}
                    scope={props.scope}
                    loading={loading}
                    canLoadMoreContext={nextContext !== null}
                    onLoadMoreContext={loadMoreContext}
                    onLoadEntity={selectEntity}
                    onExplore={explore}
                    onClose={() => {
                      setSelection(null);
                      setCursor(undefined);
                    }}
                  />
                ) : null}
                {selectedId && selectedEntity === null ? (
                  <View className="gap-2">
                    <Text className="text-sm text-foreground-muted">
                      {translator.message(
                        result.truncated || settledQuery?.continuation
                          ? "projectIndexing.detailTruncated"
                          : "projectIndexing.entityUnavailable",
                      )}
                    </Text>
                    {nextContext ? (
                      <ProjectIndexActionButton
                        label={translator.message("projectIndexing.loadMoreContext")}
                        disabled={loading}
                        onPress={loadMoreContext}
                      />
                    ) : null}
                    <ProjectIndexActionButton
                      label={translator.message("projectIndexing.firstPage")}
                      onPress={() => {
                        setSelection(null);
                        setCursor(undefined);
                      }}
                    />
                  </View>
                ) : null}
                <ProjectIndexFacts
                  result={result}
                  environmentId={props.environmentId}
                  scope={props.scope}
                />
                {selectedEntity && (operation === "callers" || operation === "callees") ? (
                  <View className="gap-2">
                    <Text className="font-t3-semibold text-foreground">
                      {translator.message("projectIndexing.staticRelationships")}
                    </Text>
                    <Text className="text-xs text-foreground-muted">
                      {translator.message("projectIndexing.staticRelationshipsHint")}
                    </Text>
                    {confirmedCallsites.length === 0 ? (
                      <Text className="text-sm text-foreground-muted">
                        {translator.message(`projectIndexing.no.${operation}`)}
                      </Text>
                    ) : null}
                    {confirmedCallsites.slice(0, MAX_VISIBLE_CALLSITES).map((callsite) => (
                      <CallsiteCard
                        key={callsite.id}
                        callsite={callsite}
                        environmentId={props.environmentId}
                        scope={props.scope}
                      />
                    ))}
                    {unresolvedCallsites.length > 0 ? (
                      <Text className="font-t3-semibold text-foreground">
                        {translator.message("projectIndexing.gaps", {
                          count: unresolvedCallsites.length,
                        })}
                      </Text>
                    ) : null}
                    {unresolvedCallsites
                      .slice(0, MAX_VISIBLE_UNRESOLVED_CALLSITES)
                      .map((callsite) => (
                        <CallsiteCard
                          key={callsite.id}
                          callsite={callsite}
                          environmentId={props.environmentId}
                          scope={props.scope}
                        />
                      ))}
                    {confirmedCallsites.length > MAX_VISIBLE_CALLSITES ||
                    unresolvedCallsites.length > MAX_VISIBLE_UNRESOLVED_CALLSITES ? (
                      <Text className="text-xs text-foreground-muted">
                        {translator.message("projectIndexing.detailTruncated")}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </View>
    </SettingsSection>
  );
}
