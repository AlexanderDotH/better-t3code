import { describe, expect, it } from "@effect/vitest";
import { KnowledgeGraphSemanticClaimV1, KnowledgeGraphSnapshotV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { validateKnowledgeGraphSemanticOutput } from "./KnowledgeGraphSemanticValidation.ts";

const snapshot = Schema.decodeUnknownSync(KnowledgeGraphSnapshotV1)({
  version: 1,
  type: "snapshot",
  scope: {
    version: 1,
    scopeId: "scope-validation",
    environmentId: "environment-validation",
    projectId: "project-validation",
    effectiveWorkspaceRoot: "/workspace/validation",
    isWorktree: false,
  },
  revision: 9,
  nodes: [
    {
      version: 1,
      nodeId: "node-source",
      scopeId: "scope-validation",
      kind: "file",
      label: "source.ts",
      source: { path: "src/source.ts" },
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: ["evidence-source"],
      nodeRevision: 4,
    },
    {
      version: 1,
      nodeId: "node-target",
      scopeId: "scope-validation",
      kind: "file",
      label: "target.ts",
      source: { path: "src/target.ts" },
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: ["evidence-target"],
      nodeRevision: 3,
    },
    {
      version: 1,
      nodeId: "node-not-candidate",
      scopeId: "scope-validation",
      kind: "file",
      label: "other.ts",
      source: { path: "other/other.ts" },
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: ["evidence-other"],
      nodeRevision: 2,
    },
  ],
  edges: [],
  evidence: [
    {
      version: 1,
      evidenceId: "evidence-source",
      scopeId: "scope-validation",
      kind: "source",
      source: { path: "src/source.ts" },
      excerpt: "export const source = target;",
      fingerprint: "sha256:source",
      confidence: 1,
      evidenceRevision: 4,
    },
    {
      version: 1,
      evidenceId: "evidence-target",
      scopeId: "scope-validation",
      kind: "source",
      source: { path: "src/target.ts" },
      excerpt: "export const target = true;",
      fingerprint: "sha256:target",
      confidence: 1,
      evidenceRevision: 3,
    },
    {
      version: 1,
      evidenceId: "evidence-other",
      scopeId: "scope-validation",
      kind: "source",
      source: { path: "other/other.ts" },
      fingerprint: "sha256:other",
      confidence: 1,
      evidenceRevision: 2,
    },
  ],
  status: {
    version: 1,
    scopeId: "scope-validation",
    state: "ready",
    revision: 9,
    indexedFileCount: 3,
    nodeCount: 3,
    edgeCount: 0,
    evidenceCount: 3,
    semanticQueueDepth: 1,
    truncated: {
      eligibleFiles: false,
      nodes: false,
      visibleNodes: false,
      omittedFileCount: 0,
      omittedNodeCount: 0,
    },
  },
  generatedAt: "2026-08-29T12:00:00.000Z",
});

const claim = Schema.decodeUnknownSync(KnowledgeGraphSemanticClaimV1)({
  version: 1,
  claimToken: "claim-validation",
  environmentId: snapshot.scope.environmentId,
  claimedAt: 1_788_000_000_000,
  items: [
    {
      version: 1,
      jobId: "job-validation",
      environmentId: snapshot.scope.environmentId,
      scopeId: snapshot.scope.scopeId,
      nodeId: "node-source",
      desiredNodeRevision: 4,
      modelGeneration: 6,
      candidates: [
        {
          sourceNodeId: "node-source",
          candidateNodeId: "node-target",
          evidenceIds: ["evidence-source", "evidence-target"],
          score: 0.9,
        },
      ],
      attemptCount: 0,
      availableAt: 1_788_000_000_000,
      createdAt: 1_788_000_000_000,
      updatedAt: 1_788_000_000_000,
    },
  ],
});

const validOutput = {
  version: 1,
  edges: [
    {
      kind: "relates-to",
      sourceNodeId: "node-source",
      targetNodeId: "node-target",
      confidence: 0.82,
      summary: "Source uses the target abstraction.",
      evidenceIds: ["evidence-source", "evidence-target"],
    },
  ],
};

describe("Knowledge Graph semantic output validation", () => {
  it.effect("builds a revision-fenced patch from exact candidate and evidence references", () =>
    Effect.gen(function* () {
      const patch = yield* validateKnowledgeGraphSemanticOutput({
        claim,
        snapshot,
        output: validOutput,
        committedAt: "2026-08-29T12:01:00.000Z",
      });

      expect(patch).toMatchObject({
        version: 1,
        scopeId: snapshot.scope.scopeId,
        baseRevision: 9,
        modelGeneration: 6,
        nodes: [],
        evidence: [],
        changedNodeIds: ["node-source", "node-target"],
        committedAt: "2026-08-29T12:01:00.000Z",
      });
      expect(patch.edges).toEqual(validOutput.edges);
    }),
  );

  it.effect("rejects extra output fields instead of silently dropping them", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateKnowledgeGraphSemanticOutput({
          claim,
          snapshot,
          output: { ...validOutput, explanation: "untrusted extra data" },
          committedAt: "2026-08-29T12:01:00.000Z",
        }),
      );

      expect(error.reason).toBe("schema");
    }),
  );

  it.effect("rejects graph nodes and evidence outside the claimed candidate pair", () =>
    Effect.gen(function* () {
      const unknownNode = yield* Effect.flip(
        validateKnowledgeGraphSemanticOutput({
          claim,
          snapshot,
          output: {
            ...validOutput,
            edges: [
              {
                ...validOutput.edges[0],
                targetNodeId: "node-not-candidate",
                evidenceIds: ["evidence-other"],
              },
            ],
          },
          committedAt: "2026-08-29T12:01:00.000Z",
        }),
      );
      const unknownEvidence = yield* Effect.flip(
        validateKnowledgeGraphSemanticOutput({
          claim,
          snapshot,
          output: {
            ...validOutput,
            edges: [{ ...validOutput.edges[0], evidenceIds: ["evidence-other"] }],
          },
          committedAt: "2026-08-29T12:01:00.000Z",
        }),
      );

      expect(unknownNode.reason).toBe("reference");
      expect(unknownEvidence.reason).toBe("reference");
    }),
  );

  it.effect("rejects relations without at least one claimed evidence reference", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateKnowledgeGraphSemanticOutput({
          claim,
          snapshot,
          output: {
            ...validOutput,
            edges: [{ ...validOutput.edges[0], evidenceIds: [] }],
          },
          committedAt: "2026-08-29T12:01:00.000Z",
        }),
      );

      expect(error.reason).toBe("reference");
    }),
  );

  it.effect("rejects duplicate relations and stale claimed node revisions", () =>
    Effect.gen(function* () {
      const duplicate = yield* Effect.flip(
        validateKnowledgeGraphSemanticOutput({
          claim,
          snapshot,
          output: { ...validOutput, edges: [...validOutput.edges, ...validOutput.edges] },
          committedAt: "2026-08-29T12:01:00.000Z",
        }),
      );
      const staleClaim = {
        ...claim,
        items: [{ ...claim.items[0], desiredNodeRevision: 3 }] as typeof claim.items,
      };
      const stale = yield* Effect.flip(
        validateKnowledgeGraphSemanticOutput({
          claim: staleClaim,
          snapshot,
          output: validOutput,
          committedAt: "2026-08-29T12:01:00.000Z",
        }),
      );

      expect(duplicate.reason).toBe("bounds");
      expect(stale.reason).toBe("claim");
    }),
  );
});
