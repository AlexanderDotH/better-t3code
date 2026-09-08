import { describe, expect, it } from "vite-plus/test";

import type { KnowledgeGraphStatusV1 } from "@t3tools/contracts";

import {
  resolveKnowledgeGraphLoadState,
  resolveKnowledgeGraphZeroNodeState,
} from "./knowledgeGraphPanelState";

const status = (
  state: KnowledgeGraphStatusV1["state"],
  phase?: NonNullable<KnowledgeGraphStatusV1["progress"]>["phase"],
): KnowledgeGraphStatusV1 => ({
  version: 1,
  scopeId: "scope-1" as KnowledgeGraphStatusV1["scopeId"],
  state,
  revision: 0,
  indexedFileCount: 0,
  nodeCount: 0,
  edgeCount: 0,
  evidenceCount: 0,
  semanticQueueDepth: 0,
  ...(phase
    ? {
        progress: {
          version: 1,
          phase,
          discoveredFileCount: 4,
          processedFileCount: 2,
          totalFileCount: 4,
          queuedSemanticNodeCount: 0,
        },
      }
    : {}),
  truncated: {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  },
});

describe("resolveKnowledgeGraphLoadState", () => {
  it("distinguishes a failed subscription from an empty in-flight snapshot", () => {
    expect(resolveKnowledgeGraphLoadState("Failure", false)).toBe("error");
    expect(resolveKnowledgeGraphLoadState("Initial", false)).toBe("loading");
    expect(resolveKnowledgeGraphLoadState("Success", true)).toBe("ready");
  });
});

describe("resolveKnowledgeGraphZeroNodeState", () => {
  it("uses deterministic progress to distinguish discovery, extraction, and commit", () => {
    expect(resolveKnowledgeGraphZeroNodeState(status("indexing", "discovering")).messageKey).toBe(
      "knowledgeGraph.empty.indexing",
    );
    expect(resolveKnowledgeGraphZeroNodeState(status("indexing", "extracting")).messageKey).toBe(
      "knowledgeGraph.empty.extracting",
    );
    expect(resolveKnowledgeGraphZeroNodeState(status("indexing", "persisting")).messageKey).toBe(
      "knowledgeGraph.empty.persisting",
    );
    expect(resolveKnowledgeGraphZeroNodeState(status("indexing", "finalizing")).messageKey).toBe(
      "knowledgeGraph.empty.persisting",
    );
  });

  it("distinguishes cancelled/idle, failure, and a successfully ready empty graph", () => {
    expect(resolveKnowledgeGraphZeroNodeState(status("idle"))).toEqual({
      messageKey: "knowledgeGraph.empty.idle",
      role: "status",
    });
    expect(resolveKnowledgeGraphZeroNodeState(status("error"))).toEqual({
      messageKey: "knowledgeGraph.empty.error",
      role: "alert",
    });
    expect(resolveKnowledgeGraphZeroNodeState(status("ready"))).toEqual({
      messageKey: "knowledgeGraph.empty.ready",
      role: "status",
    });
  });
});
