import type { ProviderInteractionMode, ProviderSandboxMode } from "@t3tools/contracts";

export function nativeHarnessWorkspaceInstructions(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
}): string {
  const canEdit =
    input.interactionMode !== "plan" && input.sandboxMode !== "read-only" && !input.fetchWorker;
  const reads =
    "Prefer workspace_find for path or content searches and workspace_read for bounded line reads. Batch independent operations into the fewest calls; use workspace_context only for mixed search-and-read batches. Do not use shell text readers or searchers.";
  return canEdit
    ? `${reads} Prefer workspace_edit for ordinary UTF-8 text changes and batch related files in one call. Use an available command tool only for formatters, generators, binaries, large files, or permission changes.`
    : reads;
}
