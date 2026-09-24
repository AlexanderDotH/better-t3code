import { ProjectId, type ProjectContextInput, type ProjectEntityV1 } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  captureMobileProjectIndexEntity,
  nextMobileProjectIndexEntityContext,
  resolveMobileProjectIndexEntity,
} from "./mobile-project-index-detail";
import { mobileProjectIndexQuery } from "./mobile-project-indexing";

const entity: ProjectEntityV1 = {
  id: "method-1",
  containerId: "container-hash-123",
  name: "run",
  qualifiedName: "Service.run",
  filePath: "src/service.ts",
  kind: "method",
  language: "typescript",
  range: { startLine: 8, startColumn: 1, endLine: 20, endColumn: 2 },
  sourceHash: "source-hash",
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
};
const context = {
  scope: {
    scopeId: "scope-1",
    projectId: ProjectId.make("project-1"),
    workspaceFingerprint: "workspace-1",
  },
  revision: 4,
  entities: [entity],
};
const request: ProjectContextInput = {
  operation: "entity",
  entityId: entity.id,
  maxTokens: 6_000,
  limit: 80,
  includeStale: true,
  scopes: ["src"],
};

describe("mobile project index detail continuation", () => {
  it("prefers a real next page before larger explicit requests and drops old cursors on restart", () => {
    const nextPage = nextMobileProjectIndexEntityContext({
      entityId: entity.id,
      request,
      result: { truncated: true, nextCursor: "modules-page" },
    });
    expect(nextPage).toEqual({ ...request, cursor: "modules-page" });
    const expanded = nextMobileProjectIndexEntityContext({
      entityId: entity.id,
      request: nextPage!,
      result: { truncated: true, nextCursor: null },
    });
    expect(expanded).toEqual({ ...request, maxTokens: 12_000 });
    const maximum = nextMobileProjectIndexEntityContext({
      entityId: entity.id,
      request: expanded!,
      result: { truncated: true, nextCursor: null },
    });
    expect(maximum).toEqual({ ...request, maxTokens: 24_000 });
    expect(
      nextMobileProjectIndexEntityContext({
        entityId: entity.id,
        request: maximum!,
        result: { truncated: true, nextCursor: null },
      }),
    ).toBeNull();
    expect(
      nextMobileProjectIndexEntityContext({
        entityId: entity.id,
        request,
        result: { truncated: false, nextCursor: null },
      }),
    ).toBeNull();
  });

  it("does not loop a non-advancing cursor or reuse it for a different containing entity", () => {
    expect(
      nextMobileProjectIndexEntityContext({
        entityId: entity.id,
        request: { ...request, cursor: "same-page" },
        result: { truncated: true, nextCursor: "same-page" },
      }),
    ).toEqual({ ...request, maxTokens: 12_000 });
    const containerId = entity.containerId!;
    expect(captureMobileProjectIndexEntity(context, containerId)).toBeNull();
    expect(
      nextMobileProjectIndexEntityContext({
        entityId: containerId,
        request: { ...request, cursor: "old-page" },
        result: { truncated: true, nextCursor: "next-old-page" },
      }),
    ).toEqual({ ...request, entityId: containerId });
  });

  it("uses the requested bounded entity budget while search stays at its normal limit", () => {
    expect(
      mobileProjectIndexQuery({
        text: "",
        selection: { entityId: entity.id, operation: "entity" },
        maxTokens: 12_000,
      }).maxTokens,
    ).toBe(12_000);
    expect(
      mobileProjectIndexQuery({
        text: "",
        selection: { entityId: entity.id, operation: "entity" },
        maxTokens: 100_000,
      }).maxTokens,
    ).toBe(24_000);
    expect(
      mobileProjectIndexQuery({ text: "Service", selection: null, maxTokens: 24_000 }).maxTokens,
    ).toBe(6_000);
  });
});

describe("mobile project index retained root", () => {
  it("retains only the real selected entity from the same scope, fingerprint and revision", () => {
    const anchor = captureMobileProjectIndexEntity(context, entity.id);
    const page = { ...context, entities: [] };
    expect(resolveMobileProjectIndexEntity(page, entity.id, anchor)).toEqual({
      ...entity,
      freshness: "unknown",
    });
    expect(anchor?.entity.freshness).toBe("current");
    expect(resolveMobileProjectIndexEntity({ ...page, revision: 5 }, entity.id, anchor)).toBeNull();
    expect(
      resolveMobileProjectIndexEntity(
        { ...page, scope: { ...page.scope, scopeId: "other-scope" } },
        entity.id,
        anchor,
      ),
    ).toBeNull();
    expect(
      resolveMobileProjectIndexEntity(
        { ...page, scope: { ...page.scope, workspaceFingerprint: "other-workspace" } },
        entity.id,
        anchor,
      ),
    ).toBeNull();
    expect(resolveMobileProjectIndexEntity(page, entity.containerId!, anchor)).toBeNull();
    expect(resolveMobileProjectIndexEntity(page, entity.id, null)).toBeNull();
  });

  it("uses a current page's entity instead of retained metadata", () => {
    const anchor = captureMobileProjectIndexEntity(context, entity.id);
    const updated = {
      ...entity,
      signature: "run(request: Request): Response",
      freshness: "stale" as const,
    };
    expect(
      resolveMobileProjectIndexEntity({ ...context, entities: [updated] }, entity.id, anchor),
    ).toBe(updated);
  });
});
