export type KnowledgeGraphLoadState = "loading" | "error" | "ready";

export function resolveKnowledgeGraphLoadState(
  resultTag: string,
  hasSnapshot: boolean,
): KnowledgeGraphLoadState {
  if (resultTag === "Failure") return "error";
  return hasSnapshot ? "ready" : "loading";
}
