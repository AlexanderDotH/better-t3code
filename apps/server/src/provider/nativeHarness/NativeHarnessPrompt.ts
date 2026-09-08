import {
  type ProviderInteractionMode,
  type ProviderSandboxMode,
  WORKSPACE_CONTEXT_MAX_QUERIES,
  WORKSPACE_CONTEXT_MAX_READS,
} from "@t3tools/contracts";

export function nativeHarnessWorkspaceInstructions(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
}): string {
  const canEdit =
    input.interactionMode !== "plan" && input.sandboxMode !== "read-only" && !input.fetchWorker;
  const reads = `Prefer workspace_find for path or content searches and workspace_read for bounded line reads. Batch at most ${WORKSPACE_CONTEXT_MAX_QUERIES} queries or ${WORKSPACE_CONTEXT_MAX_READS} reads per call; split larger sets and use workspace_context only for mixed batches. Do not use shell text readers or searchers.`;
  return canEdit
    ? `${reads} Prefer workspace_edit for small UTF-8 edits; create new files with write mode create and prefer exact replacements for existing text. Use an available command tool for large edits, formatters, generators, binaries, large files, or permissions.`
    : reads;
}
