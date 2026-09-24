import type {
  ProjectCallsiteV1,
  ProjectEntityV1,
  ProjectIndexQueryResultV1,
} from "@t3tools/contracts";

import { useInterfaceTranslator } from "../../hooks/useInterfaceTranslator";
import { Button } from "../ui/button";
import { ProjectIndexSourceLink } from "./ProjectIndexSourceLink";
import { ProjectIndexVerification } from "./ProjectIndexVerification";
import { ProjectIndexFacts } from "./ProjectIndexFacts";
import { isSourceDerivedFact } from "./isSourceDerivedFact";
import { ProjectIndexGraph } from "../knowledge-graph/ProjectIndexGraph";

export interface ProjectCallsitePage {
  readonly cursor: string | null;
  readonly pending: boolean;
  readonly onChange: (cursor: string | null) => void;
}

function ProjectCallsites({
  title,
  callsites,
  entities,
  direction,
  onSelectEntity,
  onOpenSource,
  nextCursor,
  page,
}: {
  readonly title: string;
  readonly callsites: ReadonlyArray<ProjectCallsiteV1>;
  readonly entities: ReadonlyMap<string, ProjectEntityV1>;
  readonly direction: "callers" | "callees";
  readonly onSelectEntity: (entityId: string) => void;
  readonly onOpenSource: (path: string, line: number | null) => void;
  readonly nextCursor: string | null;
  readonly page?: ProjectCallsitePage | undefined;
}) {
  const { message } = useInterfaceTranslator();

  return (
    <section className="space-y-2" aria-label={title} aria-busy={page?.pending ?? false}>
      <h4 className="text-xs font-medium">{title}</h4>
      {callsites.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {message(`projectIndexing.no.${direction}`)}
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
          {callsites.map((callsite) => {
            const linkedIds =
              direction === "callers"
                ? callsite.callerEntityId
                  ? [callsite.callerEntityId]
                  : []
                : callsite.targetEntityIds;
            return (
              <li key={callsite.id} className="space-y-1.5 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <code className="min-w-0 break-all text-xs">{callsite.expression}</code>
                  <span className="text-[11px] text-muted-foreground">
                    {message(`projectIndexing.resolution.${callsite.resolution}`)} ·{" "}
                    {message(`projectIndexing.freshness.${callsite.freshness}`)}
                  </span>
                </div>
                {callsite.reason ? (
                  <p className="text-xs text-muted-foreground">{callsite.reason}</p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {linkedIds.map((id) => (
                    <Button
                      key={id}
                      size="xs"
                      variant="outline"
                      className="max-w-full"
                      onClick={() => onSelectEntity(id)}
                    >
                      <span className="truncate">{entities.get(id)?.qualifiedName ?? id}</span>
                    </Button>
                  ))}
                </div>
                <ProjectIndexSourceLink
                  path={callsite.filePath}
                  range={callsite.range}
                  onOpenSource={onOpenSource}
                />
              </li>
            );
          })}
        </ul>
      )}
      {page?.pending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message("common.loading")}
        </p>
      ) : null}
      {page ? (
        <div className="flex flex-wrap gap-2">
          {page.cursor !== null ? (
            <Button
              size="xs"
              variant="outline"
              disabled={page.pending}
              onClick={() => page.onChange(null)}
            >
              {message("projectIndexing.firstPage")}
            </Button>
          ) : null}
          {nextCursor !== null && nextCursor !== page.cursor ? (
            <Button
              size="xs"
              variant="outline"
              disabled={page.pending}
              onClick={() => page.onChange(nextCursor)}
            >
              {message("projectIndexing.nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function ProjectIndexEntityDetail({
  entity,
  detail,
  callers,
  callees,
  onSelectEntity,
  onOpenSource,
  callersPage,
  calleesPage,
}: {
  readonly entity: ProjectEntityV1;
  readonly detail: ProjectIndexQueryResultV1;
  readonly callers: ProjectIndexQueryResultV1;
  readonly callees: ProjectIndexQueryResultV1;
  readonly onSelectEntity: (entityId: string) => void;
  readonly onOpenSource: (path: string, line: number | null) => void;
  readonly callersPage?: ProjectCallsitePage;
  readonly calleesPage?: ProjectCallsitePage;
}) {
  const { message } = useInterfaceTranslator();
  const containerId = entity.containerId;
  const relatedEntities = new Map(
    [...callers.entities, ...callees.entities, ...detail.entities, entity]
      .filter(isSourceDerivedFact)
      .map((related) => [related.id, related]),
  );
  const container = containerId ? relatedEntities.get(containerId) : undefined;
  const graphCallsites = new Map(
    [...callers.callsites, ...callees.callsites, ...detail.callsites]
      .filter(isSourceDerivedFact)
      .map((callsite) => [callsite.id, callsite] as const),
  );
  const incoming = callers.callsites.filter(
    (callsite) => isSourceDerivedFact(callsite) && callsite.targetEntityIds.includes(entity.id),
  );
  const outgoing = callees.callsites.filter(
    (callsite) => isSourceDerivedFact(callsite) && callsite.callerEntityId === entity.id,
  );

  return (
    <article
      className="space-y-5 rounded-lg border border-border/60 bg-card/30 p-4"
      aria-label={entity.qualifiedName}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="min-w-0 break-all text-sm font-semibold">{entity.qualifiedName}</h3>
          <span className="text-xs text-muted-foreground">
            {message(`projectIndexing.kind.${entity.kind}`)}
          </span>
        </div>
        <ProjectIndexSourceLink
          path={entity.filePath}
          range={entity.range}
          onOpenSource={onOpenSource}
        />
        <p className="text-xs text-muted-foreground">
          {message(`projectIndexing.freshness.${entity.freshness}`)} ·{" "}
          {message(`projectIndexing.provenance.${entity.provenance}`)} · {entity.language}
        </p>
        {entity.signature ? (
          <pre className="max-h-36 overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap">
            {entity.signature}
          </pre>
        ) : null}
        {containerId ? (
          <Button
            size="xs"
            variant="link"
            className="max-w-full px-0"
            onClick={() => onSelectEntity(containerId)}
          >
            <span className="truncate">
              {container
                ? message("projectIndexing.container", { name: container.qualifiedName })
                : message("projectIndexing.loadContainer")}
            </span>
          </Button>
        ) : null}
      </div>
      <ProjectIndexVerification verification={detail.verification} />
      <ProjectIndexGraph
        entities={Array.from(relatedEntities.values())}
        callsites={Array.from(graphCallsites.values())}
        imports={detail.imports?.filter(isSourceDerivedFact)}
        selectedEntityId={entity.id}
        onSelectEntity={onSelectEntity}
      />
      <ProjectIndexFacts result={detail} onOpenSource={onOpenSource} />
      <ProjectCallsites
        title={message("projectIndexing.callers")}
        callsites={incoming}
        entities={relatedEntities}
        direction="callers"
        onSelectEntity={onSelectEntity}
        onOpenSource={onOpenSource}
        nextCursor={callers.nextCursor}
        page={callersPage}
      />
      <ProjectCallsites
        title={message("projectIndexing.callees")}
        callsites={outgoing}
        entities={relatedEntities}
        direction="callees"
        onSelectEntity={onSelectEntity}
        onOpenSource={onOpenSource}
        nextCursor={callees.nextCursor}
        page={calleesPage}
      />
      {[detail, callers, callees].some((result) => result.truncated) ? (
        <p className="text-xs text-muted-foreground">
          {message("projectIndexing.detailTruncated")}
        </p>
      ) : null}
      {detail.evidence.some((evidence) => evidence.provenance !== "llm") ? (
        <details className="space-y-2 text-xs">
          <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">
            {message("projectIndexing.evidence")}
          </summary>
          {detail.evidence
            .filter((evidence) => evidence.provenance !== "llm")
            .map((evidence) => (
              <div key={evidence.id} className="mt-3 space-y-1">
                <ProjectIndexSourceLink
                  path={evidence.filePath}
                  range={evidence.range}
                  onOpenSource={onOpenSource}
                />
                {evidence.excerpt ? (
                  <pre className="max-h-36 overflow-auto rounded-md bg-muted/50 p-2 whitespace-pre-wrap">
                    {evidence.excerpt}
                  </pre>
                ) : null}
              </div>
            ))}
        </details>
      ) : null}
    </article>
  );
}
