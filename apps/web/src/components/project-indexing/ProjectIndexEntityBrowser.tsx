import {
  PROJECT_INDEX_MAX_QUERY_TOKENS,
  PROJECT_INDEX_MAX_QUERY_RECORDS,
  type EnvironmentId,
  ProjectContextInput,
  type ProjectId,
  type ThreadId,
  type ProjectEntityV1,
  type ProjectIndexQueryResultV1,
  type ProjectIndexScopeInput,
} from "@t3tools/contracts";
import type {
  ProjectIndexClientApi,
  ProjectIndexController,
} from "@t3tools/client-runtime/project-indexing";
import { useDeferredValue, useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { ProjectIndexGraph } from "../knowledge-graph/ProjectIndexGraph";
import { ProjectIndexOverviewGraph } from "../knowledge-graph/ProjectIndexOverviewGraph";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { ProjectIndexEntityDetail } from "./ProjectIndexEntityDetail";
import { ProjectIndexFacts } from "./ProjectIndexFacts";
import { ProjectIndexVerification } from "./ProjectIndexVerification";
import { isSourceDerivedFact } from "./isSourceDerivedFact";

const ENTITY_PAGE_SIZE = 48;
const ENTITY_QUERY_TOKEN_BUDGET = 6_000;
const GRAPH_QUERY_TOKEN_BUDGET = PROJECT_INDEX_MAX_QUERY_TOKENS;

interface QueryState {
  readonly key: string;
  readonly resourceKey: string;
  readonly result: ProjectIndexQueryResultV1 | null;
  readonly error: string | null;
  readonly scopeChanged: boolean;
  readonly pending: boolean;
  readonly continuation: boolean;
}

function queryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ProjectIndexQueryKey extends Data.Class<{
  readonly owner: string;
  readonly generation: number;
  readonly api: ProjectIndexClientApi;
  readonly query: ProjectIndexController["query"] | undefined;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | undefined;
  readonly requestJson: string;
  readonly workspaceFingerprint: string;
  readonly key: string;
  readonly resourceKey: string;
}> {}
const requestJsonCodec = Schema.fromJsonString(ProjectContextInput);
const decodeRequest = Schema.decodeUnknownSync(requestJsonCodec);
const encodeRequest = Schema.encodeSync(requestJsonCodec);
const projectIndexQueries = Atom.family((input: ProjectIndexQueryKey) => {
  const request = decodeRequest(input.requestJson);
  const scope = {
    projectId: input.projectId,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
  };
  const continuation = request.cursor !== undefined;
  return Atom.make(
    Effect.tryPromise(() =>
      input.query ? input.query(request) : input.api.query({ ...scope, ...request }),
    ).pipe(
      Effect.match({
        onSuccess: (result): QueryState | null => {
          const scopeChanged =
            result.scope.projectId !== scope.projectId ||
            (scope.threadId !== undefined && result.scope.threadId !== scope.threadId) ||
            result.scope.workspaceFingerprint !== input.workspaceFingerprint;
          return {
            key: input.key,
            resourceKey: input.resourceKey,
            result: scopeChanged ? null : result,
            error: null,
            scopeChanged,
            pending: false,
            continuation,
          };
        },
        onFailure: (failure): QueryState | null => ({
          key: input.key,
          resourceKey: input.resourceKey,
          result: null,
          error: queryError(failure.cause),
          scopeChanged: false,
          pending: false,
          continuation,
        }),
      }),
    ),
  );
});
const emptyQuery = Atom.make(Effect.succeed<QueryState | null>(null));

function useProjectIndexQuery({
  api,
  environmentId,
  scope,
  request,
  revision,
  workspaceFingerprint,
  refreshToken,
  query,
  retainPrevious = false,
  enabled = true,
}: {
  readonly api: ProjectIndexClientApi;
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly request: ProjectContextInput;
  readonly revision: number;
  readonly workspaceFingerprint: string;
  readonly refreshToken: string;
  readonly query?: ProjectIndexController["query"];
  readonly retainPrevious?: boolean;
  readonly enabled?: boolean;
}) {
  const resourceKey = JSON.stringify([
    environmentId,
    scope,
    workspaceFingerprint,
    revision,
    refreshToken,
    request.operation,
    request.entityId,
    request.text,
    request.scopes,
    request.includeStale,
  ]);
  const key = JSON.stringify([
    environmentId,
    scope,
    workspaceFingerprint,
    request,
    revision,
    refreshToken,
  ]);
  const owner = useId();
  const requestKey = `${enabled}\u0000${key}`;
  const [requestVersion, setRequestVersion] = useState({ key: requestKey, generation: 0 });
  const generation = requestVersion.generation + (requestVersion.key === requestKey ? 0 : 1);
  if (requestVersion.key !== requestKey) setRequestVersion({ key: requestKey, generation });
  const result = useAtomValue(
    enabled
      ? projectIndexQueries(
          new ProjectIndexQueryKey({
            owner,
            generation,
            api,
            query,
            projectId: scope.projectId,
            threadId: scope.threadId,
            requestJson: encodeRequest(request),
            workspaceFingerprint,
            key,
            resourceKey,
          }),
        )
      : emptyQuery,
  );
  const current = result._tag === "Success" ? result.value : null;
  const [previous, setPrevious] = useState<QueryState | null>(null);
  if (current !== null && current !== previous) setPrevious(current);
  const state = current ?? previous;

  if (!enabled) return null;
  if (state?.key === key) return state;
  return retainPrevious && state?.resourceKey === resourceKey && state.result !== null
    ? { ...state, pending: true }
    : null;
}

function EntityDetailsLoader({
  entityId,
  api,
  environmentId,
  scope,
  revision,
  workspaceFingerprint,
  refreshToken,
  onSelectEntity,
  onOpenSource,
}: {
  readonly entityId: string;
  readonly api: ProjectIndexClientApi;
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly revision: number;
  readonly workspaceFingerprint: string;
  readonly refreshToken: string;
  readonly onSelectEntity: (entityId: string) => void;
  readonly onOpenSource: (path: string, line: number | null) => void;
}) {
  const { message } = useInterfaceTranslator();
  const contextKey = JSON.stringify([
    environmentId,
    scope,
    entityId,
    revision,
    workspaceFingerprint,
    refreshToken,
  ]);
  const [contextRequest, setContextRequest] = useState<{
    readonly key: string;
    readonly maxTokens: number;
    readonly cursor: string | null;
  }>({ key: contextKey, maxTokens: ENTITY_QUERY_TOKEN_BUDGET, cursor: null });
  const currentCursor = contextRequest.key === contextKey ? contextRequest.cursor : null;
  const [callersPage, setCallersPage] = useState<{
    readonly key: string;
    readonly cursor: string | null;
  } | null>(null);
  const [calleesPage, setCalleesPage] = useState<{
    readonly key: string;
    readonly cursor: string | null;
  } | null>(null);
  const callersCursor = callersPage?.key === contextKey ? callersPage.cursor : null;
  const calleesCursor = calleesPage?.key === contextKey ? calleesPage.cursor : null;
  const [anchor, setAnchor] = useState<{
    readonly key: string;
    readonly entity: ProjectEntityV1;
  } | null>(null);
  const entityRequest = {
    operation: "entity" as const,
    entityId,
    maxTokens: contextRequest.maxTokens,
    limit: Math.min(
      PROJECT_INDEX_MAX_QUERY_RECORDS,
      (ENTITY_PAGE_SIZE * contextRequest.maxTokens) / ENTITY_QUERY_TOKEN_BUDGET,
    ),
    ...(currentCursor === null ? {} : { cursor: currentCursor }),
    includeStale: true,
  };
  const callersRequest = {
    operation: "callers" as const,
    entityId,
    maxTokens: ENTITY_QUERY_TOKEN_BUDGET,
    limit: ENTITY_PAGE_SIZE,
    includeStale: true,
    ...(callersCursor === null ? {} : { cursor: callersCursor }),
  };
  const calleesRequest = {
    operation: "callees" as const,
    entityId,
    maxTokens: ENTITY_QUERY_TOKEN_BUDGET,
    limit: ENTITY_PAGE_SIZE,
    includeStale: true,
    ...(calleesCursor === null ? {} : { cursor: calleesCursor }),
  };
  const detail = useProjectIndexQuery({
    api,
    environmentId,
    scope,
    revision,
    workspaceFingerprint,
    refreshToken,
    request: entityRequest,
    retainPrevious: true,
  });
  const callers = useProjectIndexQuery({
    api,
    environmentId,
    scope,
    revision,
    workspaceFingerprint,
    refreshToken,
    request: callersRequest,
    retainPrevious: true,
  });
  const callees = useProjectIndexQuery({
    api,
    environmentId,
    scope,
    revision,
    workspaceFingerprint,
    refreshToken,
    request: calleesRequest,
    retainPrevious: true,
  });
  const error = [detail, callers, callees].some((result) => result?.scopeChanged)
    ? message("projectIndexing.scopeChanged")
    : (detail?.error ?? callers?.error ?? callees?.error);
  const pageEntity = detail?.result?.entities.find(
    (candidate) => candidate.id === entityId && isSourceDerivedFact(candidate),
  );
  if (pageEntity && (anchor?.key !== contextKey || anchor.entity !== pageEntity))
    setAnchor({ key: contextKey, entity: pageEntity });
  const entity =
    pageEntity ??
    (anchor?.key === contextKey ? { ...anchor.entity, freshness: "unknown" as const } : undefined);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!detail?.result || !callers?.result || !callees?.result) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {message("projectIndexing.loadingEntity")}
      </p>
    );
  }
  const nextCursor = detail.result.nextCursor;
  const canContinue = nextCursor !== null && nextCursor !== currentCursor;
  const canIncreaseBudget =
    (detail.result.truncated || detail.continuation) &&
    contextRequest.maxTokens < PROJECT_INDEX_MAX_QUERY_TOKENS;
  return (
    <>
      {entity ? (
        <ProjectIndexEntityDetail
          entity={entity}
          detail={detail.result}
          callers={callers.result}
          callees={callees.result}
          onSelectEntity={onSelectEntity}
          onOpenSource={onOpenSource}
          callersPage={{
            cursor: callersCursor,
            pending: callers.pending,
            onChange: (cursor) => setCallersPage({ key: contextKey, cursor }),
          }}
          calleesPage={{
            cursor: calleesCursor,
            pending: callees.pending,
            onChange: (cursor) => setCalleesPage({ key: contextKey, cursor }),
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {message(
            detail.result.truncated
              ? "projectIndexing.queryTruncated"
              : "projectIndexing.entityUnavailable",
          )}
        </p>
      )}
      {detail.pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message("common.loading")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {currentCursor !== null ? (
          <Button
            size="xs"
            variant="outline"
            disabled={detail.pending}
            onClick={() =>
              setContextRequest((current) => ({ ...current, key: contextKey, cursor: null }))
            }
          >
            {message("projectIndexing.firstPage")}
          </Button>
        ) : null}
        {canContinue ? (
          <Button
            size="xs"
            variant="outline"
            disabled={detail.pending}
            onClick={() => {
              if (nextCursor !== null)
                setContextRequest((current) => ({
                  ...current,
                  key: contextKey,
                  cursor: nextCursor,
                }));
            }}
          >
            {message("projectIndexing.nextPage")}
          </Button>
        ) : canIncreaseBudget ? (
          <Button
            size="xs"
            variant="outline"
            disabled={detail.pending}
            onClick={() =>
              setContextRequest((current) => ({
                key: contextKey,
                maxTokens: Math.min(PROJECT_INDEX_MAX_QUERY_TOKENS, current.maxTokens * 2),
                cursor: null,
              }))
            }
          >
            {message("projectIndexing.loadMoreContext")}
          </Button>
        ) : null}
      </div>
    </>
  );
}

export function ProjectIndexEntityBrowser({
  api,
  environmentId,
  scope,
  revision,
  workspaceFingerprint,
  invalidationEpoch,
  query: queryIndex,
  onRefresh,
  onOpenSource,
}: {
  readonly api: ProjectIndexClientApi;
  readonly environmentId: EnvironmentId;
  readonly scope: ProjectIndexScopeInput;
  readonly revision: number;
  readonly workspaceFingerprint: string;
  readonly invalidationEpoch: number;
  readonly query: ProjectIndexController["query"];
  readonly onRefresh?: () => void;
  readonly onOpenSource: (path: string, line: number | null) => void;
}) {
  const { message } = useInterfaceTranslator();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const text = search.trim() ? deferredSearch : "";
  const [includeStale, setIncludeStale] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const workspaceKey = JSON.stringify([environmentId, scope, workspaceFingerprint]);
  const refreshToken = JSON.stringify([invalidationEpoch, refreshCount]);
  const searchKey = JSON.stringify([
    text,
    includeStale,
    workspaceFingerprint,
    revision,
    refreshToken,
  ]);
  const [page, setPage] = useState<{ readonly key: string; readonly cursor: string } | null>(null);
  const cursor = page?.key === searchKey ? page.cursor : undefined;
  const overviewCursor = text ? undefined : cursor;
  const overviewRequest: ProjectContextInput = {
    operation: "overview",
    maxTokens: GRAPH_QUERY_TOKEN_BUDGET,
    limit: ENTITY_PAGE_SIZE,
    includeStale,
    ...(overviewCursor ? { cursor: overviewCursor } : {}),
  };
  const searchRequest: ProjectContextInput = {
    operation: "search",
    text,
    maxTokens: ENTITY_QUERY_TOKEN_BUDGET,
    limit: ENTITY_PAGE_SIZE,
    includeStale,
    ...(cursor ? { cursor } : {}),
  };
  const context = {
    api,
    environmentId,
    scope,
    revision,
    workspaceFingerprint,
    refreshToken,
    query: queryIndex,
  };
  const overview = useProjectIndexQuery({ ...context, request: overviewRequest });
  const graphKey = JSON.stringify([workspaceKey, revision, refreshToken, includeStale]);
  const [graphSnapshot, setGraphSnapshot] = useState<{
    readonly key: string;
    readonly result: ProjectIndexQueryResultV1;
  } | null>(null);
  const currentGraph = overview?.result?.graph;
  if (
    currentGraph &&
    (graphSnapshot?.key !== graphKey || graphSnapshot.result.graph !== currentGraph)
  )
    setGraphSnapshot({ key: graphKey, result: overview.result! });
  const graphSnapshotResult = currentGraph
    ? overview.result
    : graphSnapshot?.key === graphKey
      ? graphSnapshot.result
      : undefined;
  const publishedGraph = graphSnapshotResult?.graph;
  const searchResult = useProjectIndexQuery({
    ...context,
    request: searchRequest,
    enabled: text.length > 0,
  });
  const query = text ? searchResult : overview;
  const result = query?.result;
  const noPublishedIndex = result?.revision === 0 || overview?.result?.revision === 0;
  const entities = result?.entities.filter(isSourceDerivedFact) ?? [];
  const graphResult = entities.length > 0 ? result : overview?.result;
  const graphOverview = !text || entities.length === 0 ? publishedGraph : undefined;
  const graphEntities = graphResult?.entities.filter(isSourceDerivedFact) ?? [];
  const graphCallsites = graphResult?.callsites.filter(isSourceDerivedFact) ?? [];
  const graphImports = graphResult?.imports?.filter(isSourceDerivedFact) ?? [];
  const hasFacts =
    result?.modules.some(isSourceDerivedFact) === true ||
    result?.imports?.some(isSourceDerivedFact) === true ||
    result?.rules.some((entry) => entry.source === "explicit" && entry.provenance !== "llm") ===
      true;
  const error = query?.scopeChanged ? message("projectIndexing.scopeChanged") : query?.error;

  return (
    <section className="space-y-4" aria-label={message("projectIndexing.entities")}>
      {noPublishedIndex ? (
        <div role="status" className="rounded-lg border border-border/60 bg-muted/20 px-4 py-5">
          <p className="text-sm font-medium">{message("projectIndexing.noSearchableIndex")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {message("projectIndexing.noSearchableIndexHint")}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-40 flex-1">
              <Input
                type="search"
                size="sm"
                aria-label={message("projectIndexing.search")}
                placeholder={message("projectIndexing.searchPlaceholder")}
                value={search}
                onChange={(event) => {
                  setSearch(event.currentTarget.value);
                  setSelectedEntityId(null);
                }}
              />
            </div>
            {search ? (
              <Button
                size="xs"
                variant="ghost-muted"
                onClick={() => {
                  setSearch("");
                  setSelectedEntityId(null);
                  setPage(null);
                }}
              >
                {message("projectIndexing.clearSearch")}
              </Button>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={includeStale} onCheckedChange={setIncludeStale} />
              {message("projectIndexing.includeStale")}
            </label>
            <Button
              size="xs"
              variant="outline"
              disabled={!query}
              onClick={() => {
                onRefresh?.();
                setRefreshCount((count) => count + 1);
              }}
            >
              {message("projectIndexing.refreshResults")}
            </Button>
          </div>
          {graphOverview && graphSnapshotResult ? (
            <ProjectIndexOverviewGraph
              key={graphKey}
              snapshot={graphSnapshotResult}
              query={queryIndex}
              includeStale={includeStale}
              selectedEntityId={selectedEntityId}
              onSelectEntity={setSelectedEntityId}
            />
          ) : (
            <ProjectIndexGraph
              key={JSON.stringify([workspaceKey, text, cursor])}
              entities={graphEntities}
              callsites={graphCallsites}
              imports={graphImports}
              selectedEntityId={selectedEntityId}
              onSelectEntity={setSelectedEntityId}
            />
          )}
          {!query ? (
            <p role="status" className="text-sm text-muted-foreground">
              {message("projectIndexing.loadingEntities")}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {result ? (
            <>
              {entities.length === 0 ? (
                !hasFacts && (!graphOverview?.nodes.length || text) ? (
                  <div
                    role="status"
                    className="rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground"
                  >
                    <p>
                      {message(text ? "projectIndexing.noResults" : "projectIndexing.noEntities")}
                    </p>
                    {text ? (
                      <p className="mt-1 text-xs">{message("projectIndexing.searchHelp")}</p>
                    ) : null}
                    {text &&
                    (graphEntities.length > 0 || (graphOverview?.nodes.length ?? 0) > 0) ? (
                      <p className="mt-1 text-xs">{message("projectIndexing.showingOverview")}</p>
                    ) : null}
                  </div>
                ) : null
              ) : (
                <>
                  <details
                    open={text.length > 0}
                    className="space-y-2 rounded-lg border border-border/60"
                  >
                    <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
                      {message("projectIndexing.graphResults", { count: entities.length })}
                    </summary>
                    <ul className="max-h-72 divide-y divide-border/50 overflow-auto rounded-lg border border-border/60">
                      {entities.map((entity) => (
                        <li key={entity.id}>
                          <button
                            type="button"
                            aria-pressed={selectedEntityId === entity.id}
                            className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-start hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-accent"
                            onClick={() => setSelectedEntityId(entity.id)}
                          >
                            <span className="min-w-0 flex-1 space-y-1">
                              <span className="block break-all text-xs font-medium">
                                {entity.qualifiedName}
                              </span>
                              <span className="block break-all font-mono text-2xs text-muted-foreground">
                                {entity.filePath}:{entity.range.startLine}
                              </span>
                            </span>
                            <span className="text-2xs text-muted-foreground">
                              {message(`projectIndexing.kind.${entity.kind}`)} ·{" "}
                              {message(`projectIndexing.freshness.${entity.freshness}`)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
              {hasFacts || result.verification ? (
                <details className="space-y-3 rounded-lg border border-border/60 p-3">
                  <summary className="cursor-pointer text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    {message("projectIndexing.indexDetails")}
                  </summary>
                  {result.verification ? (
                    <ProjectIndexVerification verification={result.verification} />
                  ) : null}
                  <ProjectIndexFacts result={result} onOpenSource={onOpenSource} />
                </details>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {result.truncated ? (
                  <p className="flex-1 text-xs text-muted-foreground">
                    {message("projectIndexing.queryTruncated")}
                  </p>
                ) : null}
                {cursor ? (
                  <Button size="xs" variant="outline" onClick={() => setPage(null)}>
                    {message("projectIndexing.firstPage")}
                  </Button>
                ) : null}
                {result.nextCursor ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      if (result.nextCursor) setPage({ key: searchKey, cursor: result.nextCursor });
                    }}
                  >
                    {message("projectIndexing.nextPage")}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
          {selectedEntityId ? (
            <div className="space-y-2">
              <div className="flex justify-end">
                <Button size="xs" variant="ghost-muted" onClick={() => setSelectedEntityId(null)}>
                  {message("common.close")}
                </Button>
              </div>
              <EntityDetailsLoader
                key={selectedEntityId}
                entityId={selectedEntityId}
                api={api}
                environmentId={environmentId}
                scope={scope}
                revision={revision}
                workspaceFingerprint={workspaceFingerprint}
                refreshToken={refreshToken}
                onSelectEntity={setSelectedEntityId}
                onOpenSource={onOpenSource}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
