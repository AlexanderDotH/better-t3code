import type { ProviderInteractionMode, ProviderSandboxMode } from "@t3tools/contracts";

export function nativeHarnessWorkspaceInstructions(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
}): string {
  const canEdit =
    input.interactionMode !== "plan" && input.sandboxMode !== "read-only" && !input.fetchWorker;
  return canEdit
    ? "Use workspace_context for repository discovery. Searches or reads spanning multiple regular UTF-8 files MUST use batched `workspace_context` calls, using the fewest calls its limits allow; do not use shell text readers/searchers. Prefer workspace_edit for ordinary UTF-8 text changes and batch related files in one call. Use an available command tool only for formatters, generators, binaries, large files, or permission changes."
    : "Use workspace_context for repository discovery. Searches or reads spanning multiple regular UTF-8 files MUST use batched `workspace_context` calls, using the fewest calls its limits allow; do not use shell text readers/searchers.";
}
