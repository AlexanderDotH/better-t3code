import type { ProjectIndexModelSelection, ServerProvider } from "@t3tools/contracts";

export function projectIndexModelLabel(
  selection: ProjectIndexModelSelection | null,
  providers: ReadonlyArray<ServerProvider>,
): string | null {
  if (!selection) return null;
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  return `${provider?.displayName ?? selection.instanceId} · ${selection.model}`;
}
