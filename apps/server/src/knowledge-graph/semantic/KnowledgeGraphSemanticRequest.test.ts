import { describe, expect, it } from "@effect/vitest";
import type { KnowledgeGraphSemanticClaimV1, KnowledgeGraphSnapshotV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { buildKnowledgeGraphSemanticModelRequest } from "./KnowledgeGraphSemanticRequest.ts";

describe("Knowledge Graph semantic request", () => {
  it.effect("rejects a corrupted empty claim as a typed claim error", () =>
    Effect.gen(function* () {
      const claim = {
        version: 1,
        claimToken: "claim-empty",
        environmentId: "environment-empty",
        claimedAt: 1_788_000_000_000,
        items: [],
      } as unknown as KnowledgeGraphSemanticClaimV1;
      const snapshot = {
        scope: {
          scopeId: "scope-empty",
          environmentId: "environment-empty",
        },
        revision: 0,
        nodes: [],
        evidence: [],
      } as unknown as KnowledgeGraphSnapshotV1;

      const error = yield* Effect.flip(
        buildKnowledgeGraphSemanticModelRequest({ claim, snapshot }),
      );

      expect(error.reason).toBe("claim");
      expect(error.detail).toContain("empty");
    }),
  );
});
