import type { KnowledgeGraphStatusV1 } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

export type KnowledgeGraphLoadState = "loading" | "error" | "ready";

export function resolveKnowledgeGraphLoadState(
  resultTag: string,
  hasSnapshot: boolean,
): KnowledgeGraphLoadState {
  if (resultTag === "Failure") return "error";
  return hasSnapshot ? "ready" : "loading";
}

export type KnowledgeGraphZeroNodeState = {
  readonly messageKey: InterfaceMessageKey;
  readonly role: "status" | "alert";
};

export function resolveKnowledgeGraphZeroNodeState(
  status: KnowledgeGraphStatusV1,
): KnowledgeGraphZeroNodeState {
  if (status.state === "error") {
    return { messageKey: "knowledgeGraph.empty.error", role: "alert" };
  }
  if (status.state === "idle") {
    return { messageKey: "knowledgeGraph.empty.idle", role: "status" };
  }
  if (status.state === "ready") {
    return { messageKey: "knowledgeGraph.empty.ready", role: "status" };
  }
  if (status.state === "paused") {
    return { messageKey: "knowledgeGraph.empty.paused", role: "status" };
  }
  if (status.state === "cancelling") {
    return { messageKey: "knowledgeGraph.empty.cancelling", role: "status" };
  }
  if (status.state === "rate-limited") {
    return { messageKey: "knowledgeGraph.empty.rateLimited", role: "status" };
  }
  if (status.progress?.phase === "extracting") {
    return { messageKey: "knowledgeGraph.empty.extracting", role: "status" };
  }
  if (status.progress?.phase === "persisting" || status.progress?.phase === "finalizing") {
    return { messageKey: "knowledgeGraph.empty.persisting", role: "status" };
  }
  if (status.state === "semantic" || status.progress?.phase === "semantic") {
    return { messageKey: "knowledgeGraph.empty.semantic", role: "status" };
  }
  return { messageKey: "knowledgeGraph.empty.indexing", role: "status" };
}
