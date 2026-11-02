import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isLatestRunSettled } from "../../session-logic";

export interface TranscriptPortabilityThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly latestRun: EnvironmentThreadShell["latestRun"];
  readonly runtime: EnvironmentThreadShell["runtime"];
}

export function isTranscriptExportPending(
  thread: Pick<TranscriptPortabilityThread, "latestRun" | "runtime">,
): boolean {
  return !isLatestRunSettled(thread.latestRun, thread.runtime);
}

export function buildTranscriptPortabilityOptions(
  threads: ReadonlyArray<TranscriptPortabilityThread>,
  supportedEnvironmentIds: ReadonlySet<EnvironmentId>,
  environmentId: EnvironmentId | null,
): ReadonlyArray<TranscriptPortabilityThread> {
  return threads
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        supportedEnvironmentIds.has(thread.environmentId) &&
        (environmentId === null || thread.environmentId === environmentId),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
