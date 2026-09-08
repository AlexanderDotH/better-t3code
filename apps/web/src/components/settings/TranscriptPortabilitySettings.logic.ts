import type { EnvironmentId, OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";

import { isLatestTurnSettled } from "../../session-logic";

export interface TranscriptPortabilityThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly latestTurn: OrchestrationThreadShell["latestTurn"];
  readonly session: Pick<
    NonNullable<OrchestrationThreadShell["session"]>,
    "status" | "activeTurnId"
  > | null;
}

export function isTranscriptExportPending(
  thread: Pick<TranscriptPortabilityThread, "latestTurn" | "session">,
): boolean {
  return (
    thread.session?.status === "starting" || !isLatestTurnSettled(thread.latestTurn, thread.session)
  );
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
