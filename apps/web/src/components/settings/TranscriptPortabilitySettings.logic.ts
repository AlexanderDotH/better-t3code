import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

export interface TranscriptPortabilityThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly session?: { readonly status: string } | null;
}

export function buildTranscriptPortabilityOptions(
  threads: ReadonlyArray<TranscriptPortabilityThread>,
  supportedEnvironmentIds: ReadonlySet<EnvironmentId>,
): ReadonlyArray<TranscriptPortabilityThread> {
  return threads
    .filter(
      (thread) => thread.archivedAt === null && supportedEnvironmentIds.has(thread.environmentId),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
