import {
  type IsoDateTime,
  type MessageId,
  type ModelSelection,
  type OrchestrationSubagentSummary,
  type ProviderDriverKind,
  type RuntimeSessionId,
  type ServerProviderFetchWorkerCommandExecutionPolicy,
  type SubagentId,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import type * as Deferred from "effect/Deferred";
import type * as Fiber from "effect/Fiber";
import type * as Semaphore from "effect/Semaphore";

import type { FetchExplorationPlanningOutcome } from "./FetchExplorationPlanner.ts";

export const FETCH_WORKER_FINDINGS_MAX_CHARS = 32_000;
const FINDINGS_TRUNCATION_MARKER = "\n... [worker findings truncated at 32,000 characters]";

export interface FetchWorkerAssignment {
  readonly scope: string;
  readonly questions: ReadonlyArray<string>;
}

export type FetchWorkerOutcomeStatus = "completed" | "error" | "timed-out" | "interrupted";

export interface FetchWorkerOutcome {
  readonly index: number;
  readonly scope: string;
  readonly status: FetchWorkerOutcomeStatus;
  readonly findings: string;
  readonly detail?: string;
}

export interface FetchRunInput {
  readonly threadId: ThreadId;
  readonly parentTurnId?: TurnId;
  readonly cwd: string;
  readonly userRequest: string;
  readonly modelSelection: ModelSelection;
  readonly providerDriver: ProviderDriverKind;
  readonly maxRecommendedWorkers: number;
  readonly commandExecutionPolicy: ServerProviderFetchWorkerCommandExecutionPolicy;
  /** Remaining main-provider input capacity available to Fetch context. */
  readonly contextMaxChars?: number;
  /** Present only for an Auto-selected Spark run. */
  readonly lunaFallback?: {
    readonly modelSelection: ModelSelection;
    readonly providerDriver: ProviderDriverKind;
    readonly maxRecommendedWorkers: number;
    readonly commandExecutionPolicy: ServerProviderFetchWorkerCommandExecutionPolicy;
  };
}

export interface FetchRunResult {
  readonly runId: string;
  readonly status: "skipped" | "completed" | "cancelled" | "unavailable";
  readonly context?: string;
  readonly warnings: ReadonlyArray<string>;
  readonly plannedWorkers: number;
  readonly completedWorkers: number;
  readonly successfulWorkers: number;
  readonly providerInstanceId: ModelSelection["instanceId"];
  readonly providerDriver: ProviderDriverKind;
  readonly modelSelection: ModelSelection;
}

export interface FetchHandoffInput {
  readonly threadId: ThreadId;
  readonly runId: string;
}

export interface FetchInterruptInput {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly requestedAt: IsoDateTime;
}

export interface ActiveFetchRun {
  readonly runId: string;
  readonly input: FetchRunInput;
  readonly lock: Semaphore.Semaphore;
  selection: ModelSelection;
  providerDriver: ProviderDriverKind;
  maxRecommendedWorkers: number;
  phase: "planning" | "workers" | "settled" | "cancelling" | "handoff";
  cancelled: boolean;
  forceRequested: boolean;
  abortProjected: boolean;
  abortRuntimeSessionId: RuntimeSessionId | null;
  originalMainRuntimeSessionId: RuntimeSessionId | null;
  plannerFiber: Fiber.Fiber<FetchExplorationPlanningOutcome> | null;
  watchdogFiber: Fiber.Fiber<void> | null;
  workers: ActiveFetchWorker[];
}

export interface ActiveFetchWorker {
  readonly run: ActiveFetchRun;
  readonly index: number;
  readonly assignment: FetchWorkerAssignment;
  readonly syntheticThreadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly subagentId: SubagentId;
  readonly assistantMessageId: MessageId;
  readonly terminal: Deferred.Deferred<FetchWorkerOutcome>;
  readonly finalizationLock: Semaphore.Semaphore;
  summary: OrchestrationSubagentSummary;
  turnId: TurnId | null;
  sessionStarted: boolean;
  cleanedUp: boolean;
  finalizedOutcome: FetchWorkerOutcome | null;
  findings: string;
  findingsTruncated: boolean;
  transcriptBuffer: string;
  assistantProjected: boolean;
  lastProgressFingerprint: string | null;
}

export function syntheticFetchWorkerId(
  parentThreadId: ThreadId,
  runId: string,
  index: number,
): string {
  return `fetch:${parentThreadId}:${runId}:${index}`;
}

export function appendFetchWorkerFindings(
  worker: Pick<ActiveFetchWorker, "findings" | "findingsTruncated">,
  delta: string,
): void {
  if (worker.findingsTruncated || delta.length === 0) return;
  const available = FETCH_WORKER_FINDINGS_MAX_CHARS - worker.findings.length;
  if (delta.length <= available) {
    worker.findings += delta;
    return;
  }
  const retained = Math.max(0, available - FINDINGS_TRUNCATION_MARKER.length);
  worker.findings += `${delta.slice(0, retained)}${FINDINGS_TRUNCATION_MARKER}`.slice(0, available);
  worker.findingsTruncated = true;
}
