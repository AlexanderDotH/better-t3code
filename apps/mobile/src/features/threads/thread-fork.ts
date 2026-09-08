import type { ForkThreadInput } from "@t3tools/client-runtime/operations";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ThreadId,
  ThreadForkBoundary,
  ThreadForkHandoffState,
  ThreadForkWorkspace,
  VcsRef,
} from "@t3tools/contracts";
import {
  MessageId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@t3tools/contracts";
import { resolveDefaultThreadEnvMode } from "@t3tools/shared/threadEnvMode";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

type ForkSourceThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "modelSelection" | "runtimeMode" | "interactionMode"
>;

export const MOBILE_THREAD_FORK_MESSAGE_KEYS = {
  forkHere: "mobile.thread.forkHere",
  forkedFrom: "mobile.thread.forkedFrom",
  forkStarts: "mobile.thread.forkStarts",
} as const satisfies Record<string, InterfaceMessageKey>;

export function mobileThreadForkingSupported(capabilities: {
  readonly threadForking?: boolean;
}): boolean {
  return capabilities.threadForking === true;
}

export function buildMobileThreadForkCommand(input: {
  readonly thread: ForkSourceThread;
  readonly destinationThreadId: ThreadId;
  readonly boundary: ThreadForkBoundary;
  readonly workspace: ThreadForkWorkspace;
}): { readonly environmentId: EnvironmentId; readonly input: ForkThreadInput } {
  return {
    environmentId: input.thread.environmentId,
    input: {
      threadId: input.destinationThreadId,
      sourceThreadId: input.thread.id,
      boundary: input.boundary,
      modelSelection: input.thread.modelSelection,
      runtimeMode: input.thread.runtimeMode,
      interactionMode: input.thread.interactionMode,
      workspace: input.workspace,
    },
  };
}

export function mobileForkedThreadRoute(input: {
  readonly environmentId: EnvironmentId;
  readonly destinationThreadId: ThreadId;
}) {
  return {
    screen: "Thread",
    params: {
      environmentId: String(input.environmentId),
      threadId: String(input.destinationThreadId),
      focusComposer: true,
    },
  } as const;
}

type ForkableFeedEntry =
  | {
      readonly type: "message";
      readonly message: {
        readonly id: string;
        readonly role: string;
        readonly streaming: boolean;
        readonly historyOrigin?: unknown;
      };
    }
  | {
      readonly type: "proposed-plan";
      readonly proposedPlan: { readonly id: string };
    }
  | { readonly type: string };

export function resolveForkBoundary(entry: ForkableFeedEntry): ThreadForkBoundary | null {
  if (entry.type === "proposed-plan" && "proposedPlan" in entry) {
    return { kind: "proposed-plan", planId: entry.proposedPlan.id };
  }
  if (entry.type !== "message" || !("message" in entry)) {
    return null;
  }
  if (entry.message.streaming) {
    return null;
  }
  if (entry.message.role !== "user" && entry.message.role !== "assistant") {
    return null;
  }
  return { kind: "message", messageId: MessageId.make(entry.message.id) };
}

export function forkBoundaryKey(boundary: ThreadForkBoundary): string {
  return boundary.kind === "message"
    ? `message:${boundary.messageId}`
    : `proposed-plan:${boundary.planId}`;
}

export function resolveForkActionPresentation(input: {
  readonly boundary: ThreadForkBoundary;
  readonly supported: boolean;
  readonly connected: boolean;
  readonly pendingBoundaryKey: string | null;
}): { readonly visible: boolean; readonly disabled: boolean; readonly busy: boolean } {
  const visible = input.supported;
  const busy = input.pendingBoundaryKey === forkBoundaryKey(input.boundary);
  return {
    visible,
    disabled: !visible || !input.connected || input.pendingBoundaryKey !== null,
    busy,
  };
}

export function resolveForkWorkspace(input: {
  readonly projectSetting: "local" | "worktree" | null | undefined;
  readonly projectFile: "local" | "worktree" | null | undefined;
  readonly globalDefault: "local" | "worktree";
  readonly startFromOrigin: boolean;
  readonly refs: ReadonlyArray<
    Pick<VcsRef, "name" | "current" | "isDefault" | "worktreePath"> &
      Partial<Pick<VcsRef, "isRemote" | "remoteName">>
  >;
}): ThreadForkWorkspace {
  const mode = resolveDefaultThreadEnvMode({
    projectSetting: input.projectSetting,
    projectFile: input.projectFile,
    globalDefault: input.globalDefault,
  });
  const baseBranch =
    mode === "worktree"
      ? (input.refs.find((ref) => ref.isDefault)?.name ??
        input.refs.find((ref) => ref.current)?.name ??
        null)
      : null;
  return {
    mode,
    baseBranch,
    startFromOrigin: input.startFromOrigin,
    runSetupScript: mode === "worktree",
  };
}

interface HistoryOriginLike {
  readonly ordinal?: number;
}

interface HistoricalEntryLike {
  readonly id: string;
  readonly historyOrigin?: HistoryOriginLike;
  readonly message?: { readonly historyOrigin?: HistoryOriginLike };
  readonly proposedPlan?: { readonly historyOrigin?: HistoryOriginLike };
  readonly activities?: ReadonlyArray<{ readonly historyOrigin?: HistoryOriginLike }>;
}

function entryHistoryOrdinal(entry: HistoricalEntryLike): number | null {
  const direct = entry.historyOrigin?.ordinal;
  const message = entry.message?.historyOrigin?.ordinal;
  const plan = entry.proposedPlan?.historyOrigin?.ordinal;
  const activityOrdinals = (entry.activities ?? []).flatMap((activity) =>
    activity.historyOrigin?.ordinal === undefined ? [] : [activity.historyOrigin.ordinal],
  );
  const ordinals = [direct, message, plan, ...activityOrdinals].filter(
    (ordinal): ordinal is number => ordinal !== undefined && Number.isFinite(ordinal),
  );
  return ordinals.length > 0 ? Math.max(...ordinals) : null;
}

export function threadFeedEntryIsInherited(entry: HistoricalEntryLike): boolean {
  return entryHistoryOrdinal(entry) !== null;
}

export function findForkDividerEntryId(entries: ReadonlyArray<HistoricalEntryLike>): string | null {
  let candidate: { readonly id: string; readonly ordinal: number } | null = null;
  for (const entry of entries) {
    const ordinal = entryHistoryOrdinal(entry);
    if (ordinal === null || (candidate !== null && ordinal < candidate.ordinal)) {
      continue;
    }
    candidate = { id: entry.id, ordinal };
  }
  return candidate?.id ?? null;
}

export interface ForkComposerBudget {
  readonly active: true;
  readonly promptRemaining: number;
  readonly attachmentRemaining: number;
  readonly promptExceededBy: number;
  readonly attachmentsExceededBy: number;
  readonly canSend: boolean;
  readonly canAddAttachment: boolean;
}

export function resolveForkComposerBudget(input: {
  readonly handoff: Pick<
    ThreadForkHandoffState,
    "status" | "remainingInputChars" | "remainingAttachmentCount"
  > | null;
  readonly draftMessage: string;
  readonly draftAttachmentCount: number;
}): ForkComposerBudget | null {
  if (input.handoff === null || input.handoff.status !== "pending") {
    return null;
  }
  const promptRemaining = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - input.draftMessage.trim().length;
  const attachmentRemaining = PROVIDER_SEND_TURN_MAX_ATTACHMENTS - input.draftAttachmentCount;
  const promptExceededBy = Math.max(0, -promptRemaining);
  const attachmentsExceededBy = Math.max(0, -attachmentRemaining);
  return {
    active: true,
    promptRemaining,
    attachmentRemaining,
    promptExceededBy,
    attachmentsExceededBy,
    canSend: promptExceededBy === 0 && attachmentsExceededBy === 0,
    canAddAttachment: attachmentRemaining > 0,
  };
}
