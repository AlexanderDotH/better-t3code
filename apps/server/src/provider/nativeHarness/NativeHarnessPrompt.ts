import type { ProviderInteractionMode, ProviderSandboxMode } from "@t3tools/contracts";

export function nativeHarnessWorkspaceInstructions(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly sandboxMode: ProviderSandboxMode | undefined;
  readonly fetchWorker: boolean;
}): string {
  const canEdit =
    input.interactionMode !== "plan" && input.sandboxMode !== "read-only" && !input.fetchWorker;
  return canEdit
    ? "Prefer workspace_context for batched repository discovery. Prefer workspace_edit for ordinary UTF-8 text changes and batch related files in one call. Use an available command tool only for formatters, generators, binaries, large files, or permission changes."
    : "Prefer workspace_context for batched repository discovery.";
}
