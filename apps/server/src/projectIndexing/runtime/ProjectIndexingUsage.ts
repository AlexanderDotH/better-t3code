import type { ProjectIndexUsageV1 } from "@t3tools/contracts";

export function recordProjectIndexRequest(
  previous: ProjectIndexUsageV1,
  counters?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  },
): ProjectIndexUsageV1 {
  const inputTokens =
    counters?.inputTokens === undefined
      ? previous.inputTokens
      : (previous.inputTokens ?? 0) + counters.inputTokens;
  const outputTokens =
    counters?.outputTokens === undefined
      ? previous.outputTokens
      : (previous.outputTokens ?? 0) + counters.outputTokens;
  const complete =
    counters?.inputTokens !== undefined &&
    counters.outputTokens !== undefined &&
    (previous.requests === 0 || previous.usageStatus === "complete");
  return {
    requests: previous.requests + 1,
    usageStatus: complete
      ? "complete"
      : inputTokens === undefined && outputTokens === undefined
        ? "unavailable"
        : "partial",
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(previous.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: previous.cachedInputTokens }),
  };
}
