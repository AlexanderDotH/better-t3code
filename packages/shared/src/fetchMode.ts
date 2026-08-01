import type { ServerProvider } from "@t3tools/contracts";

export const FETCH_MODE = "repository-exploration" as const;
export const FETCH_SUBAGENT_COUNT = 3;

function supportsFetch(provider: ServerProvider | null | undefined): provider is ServerProvider {
  if (!provider?.enabled || !provider.installed || provider.availability === "unavailable") {
    return false;
  }

  const capability = provider.nativeSubagents;
  return Boolean(
    capability &&
    capability.toolName.trim().length > 0 &&
    Math.floor(capability.maxRecommendedSubagents) >= FETCH_SUBAGENT_COUNT,
  );
}

export function resolveFetchModeForProvider(input: {
  readonly featureEnabled: boolean;
  readonly provider: ServerProvider | null | undefined;
}): typeof FETCH_MODE | undefined {
  return input.featureEnabled && supportsFetch(input.provider) ? FETCH_MODE : undefined;
}

export function buildFetchProviderInstructions(
  provider: ServerProvider | null | undefined,
): string | undefined {
  if (!supportsFetch(provider)) {
    return undefined;
  }

  const toolName = provider.nativeSubagents?.toolName;
  if (!toolName) {
    return undefined;
  }

  return `FETCH MODE (experimental repository exploration):
If this turn requires understanding or changing a repository, before modifying files:
- Use the native \`${toolName}\` tool to start exactly ${FETCH_SUBAGENT_COUNT} direct child subagents in one parallel batch.
- Give them concrete, non-overlapping read-only exploration scopes derived from the request, covering relevant code paths, existing tests and conventions, and cross-surface risks.
- Subagents must not modify files, run mutating commands, or make external changes. They must not spawn additional agents.
- Continue useful read-only exploration while they run, then wait for all three results before the first file modification.
- Integrate their findings yourself; you remain responsible for implementation, conflicts, and verification.
If this is not a repository task or exploration would not materially help, do not spawn subagents. If the exact batch cannot be started, continue normally and mention that Fetch was unavailable.`;
}
