import {
  type ChatAttachment,
  CommandId,
  EventId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationReadModel,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderDriverKind,
  type ProjectId,
  type OrchestrationSession,
  ThreadId,
  type ProviderSession,
  type RuntimeMode,
  type TurnId,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
import { resolveFetchLunaFallback, resolveFetchModelSelection } from "@t3tools/shared/fetchMode";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import { increment, orchestrationEventsProcessedTotal } from "../../observability/Metrics.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { TurnAbortCoordinator } from "../Services/TurnAbortCoordinator.ts";
import { forkParked, ServerActivation } from "../../serverActivation.ts";
import {
  resolveSourceControlWriterModelSelection,
  ServerSettingsService,
} from "../../serverSettings.ts";
import { SkillEngine } from "../../skills/Services/SkillEngine.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import {
  buildProviderTranscriptHandoff,
  prependProviderTranscriptHandoff,
} from "../providerTranscriptHandoff.ts";
import { normalizeCodexModelSelectionServiceTier } from "../../codexModelOptions.ts";
import { isActiveSubagentStatus, settleSubagentAfterRuntimeLoss } from "../subagentLifecycle.ts";
import {
  FETCH_CONTEXT_MAX_CHARS,
  FetchWorkerCoordinator,
} from "../../fetch/FetchWorkerCoordinator.ts";
import { applyProjectAgentInstructionsToProviderInput } from "../../projectAgent/ProjectAgentInstructions.ts";
const isProviderAdapterRequestError = Schema.is(ProviderAdapterRequestError);
const isProviderDriverKind = Schema.is(ProviderDriverKind);

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.meta-updated"
      | "thread.runtime-mode-set"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.session-stop-requested";
  }
>;

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): OrchestrationSession["status"] {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
const DEFAULT_THREAD_TITLE = "New thread";
const MAX_REGENERATION_ATTACHMENTS = 4;
const MAX_THREAD_TITLE_CONTEXT_CHARS = 8_000;
const MAX_FIRST_USER_TITLE_CONTEXT_CHARS = 2_000;
const THREAD_TITLE_CONTEXT_TRUNCATION_MARKER = "[Earlier content truncated]\n\n";
const FETCH_CONTEXT_TRUNCATION_MARKER = "\n[T3 Fetch context truncated]";
const FIRST_USER_CONTEXT_TRUNCATION_MARKER = "\n[First user message truncated]";

export function applyFetchContextToProviderInput(input: {
  readonly providerInput?: string;
  readonly fetchContext?: string;
}): {
  readonly providerInput?: string;
  readonly outcome: "not-requested" | "included" | "truncated" | "omitted";
} {
  const fetchContext = input.fetchContext?.trim();
  if (!fetchContext) {
    return {
      ...(input.providerInput !== undefined ? { providerInput: input.providerInput } : {}),
      outcome: "not-requested",
    };
  }

  const providerInput = input.providerInput ?? "";
  const separator = providerInput.length > 0 ? "\n\n" : "";
  const available = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - providerInput.length - separator.length;
  if (available <= FETCH_CONTEXT_TRUNCATION_MARKER.length) {
    return {
      ...(input.providerInput !== undefined ? { providerInput: input.providerInput } : {}),
      outcome: "omitted",
    };
  }
  if (fetchContext.length <= available) {
    return {
      providerInput: `${providerInput}${separator}${fetchContext}`,
      outcome: "included",
    };
  }

  const retainedContext = fetchContext.slice(0, available - FETCH_CONTEXT_TRUNCATION_MARKER.length);
  return {
    providerInput: `${providerInput}${separator}${retainedContext}${FETCH_CONTEXT_TRUNCATION_MARKER}`,
    outcome: "truncated",
  };
}

export function remainingFetchContextChars(providerInput: string | undefined): number {
  const inputLength = providerInput?.length ?? 0;
  const separatorLength = inputLength > 0 ? 2 : 0;
  return Math.min(
    FETCH_CONTEXT_MAX_CHARS,
    Math.max(0, PROVIDER_SEND_TURN_MAX_INPUT_CHARS - inputLength - separatorLength),
  );
}

type ThreadTitleMessage = {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
};

function formatThreadTitleSection(message: ThreadTitleMessage): string | undefined {
  if (message.role === "system") {
    return undefined;
  }
  const text = message.text.trim();
  const attachmentSummary = (message.attachments ?? [])
    .map((attachment) => attachment.name)
    .join(", ");
  const contents = [
    ...(text.length > 0 ? [text] : []),
    ...(attachmentSummary.length > 0 ? [`[Attachments: ${attachmentSummary}]`] : []),
  ].join("\n");
  return contents.length > 0 ? `${message.role.toUpperCase()}:\n${contents}` : undefined;
}

function limitFirstUserSection(section: string): string {
  if (section.length <= MAX_FIRST_USER_TITLE_CONTEXT_CHARS) {
    return section;
  }
  return `${section.slice(
    0,
    MAX_FIRST_USER_TITLE_CONTEXT_CHARS - FIRST_USER_CONTEXT_TRUNCATION_MARKER.length,
  )}${FIRST_USER_CONTEXT_TRUNCATION_MARKER}`;
}

function collectRecentThreadTitleContext(
  messages: ReadonlyArray<ThreadTitleMessage>,
  maxChars: number,
): {
  readonly context: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly truncated: boolean;
} {
  let context = "";
  let truncated = false;
  const retainedAttachments: Array<ChatAttachment> = [];

  for (const message of messages.toReversed()) {
    const section = formatThreadTitleSection(message);
    if (section === undefined) {
      continue;
    }

    const separator = context.length > 0 ? "\n\n" : "";
    const available = maxChars - context.length - separator.length;
    if (section.length > available) {
      if (available > 0) {
        context = `${section.slice(-available)}${separator}${context}`;
        retainedAttachments.unshift(...(message.attachments ?? []));
      }
      truncated = true;
      break;
    }
    context = `${section}${separator}${context}`;
    retainedAttachments.unshift(...(message.attachments ?? []));
  }

  return { context, attachments: retainedAttachments, truncated };
}

function formatThreadTitleContext(messages: ReadonlyArray<ThreadTitleMessage>): {
  readonly message: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
} {
  const recent = collectRecentThreadTitleContext(messages, MAX_THREAD_TITLE_CONTEXT_CHARS);
  if (!recent.truncated) {
    return {
      message: recent.context,
      attachments: recent.attachments.slice(-MAX_REGENERATION_ATTACHMENTS),
    };
  }

  const firstUserMessage = messages.find(
    (message) => message.role === "user" && formatThreadTitleSection(message),
  );
  const firstUserSection = firstUserMessage
    ? formatThreadTitleSection(firstUserMessage)
    : undefined;
  if (!firstUserMessage || !firstUserSection) {
    return {
      message: `${THREAD_TITLE_CONTEXT_TRUNCATION_MARKER}${recent.context}`,
      attachments: recent.attachments.slice(-MAX_REGENERATION_ATTACHMENTS),
    };
  }

  const pinnedSection = limitFirstUserSection(firstUserSection);
  const recentContextBudget =
    MAX_THREAD_TITLE_CONTEXT_CHARS -
    pinnedSection.length -
    "\n\n".length -
    THREAD_TITLE_CONTEXT_TRUNCATION_MARKER.length;
  const retainedRecent = collectRecentThreadTitleContext(messages, recentContextBudget);
  const pinnedAttachment = firstUserMessage.attachments?.[0];
  const recentAttachments = retainedRecent.attachments.filter(
    (attachment) => attachment.id !== pinnedAttachment?.id,
  );

  return {
    message: `${pinnedSection}\n\n${THREAD_TITLE_CONTEXT_TRUNCATION_MARKER}${retainedRecent.context}`,
    attachments: [
      ...(pinnedAttachment ? [pinnedAttachment] : []),
      ...recentAttachments.slice(
        -(MAX_REGENERATION_ATTACHMENTS - (pinnedAttachment === undefined ? 0 : 1)),
      ),
    ],
  };
}

export function providerErrorLabel(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

export function providerErrorLabelFromInstanceHint(input: {
  readonly instanceId?: string | undefined;
  readonly modelSelectionInstanceId?: string | undefined;
  readonly sessionProvider?: string | undefined;
}): string {
  return providerErrorLabel(
    input.instanceId ?? input.modelSelectionInstanceId ?? input.sessionProvider,
  );
}

function canReplaceThreadTitle(currentTitle: string, titleSeed?: string): boolean {
  const trimmedCurrentTitle = currentTitle.trim();
  if (trimmedCurrentTitle === DEFAULT_THREAD_TITLE) {
    return true;
  }

  const trimmedTitleSeed = titleSeed?.trim();
  return trimmedTitleSeed !== undefined && trimmedTitleSeed.length > 0
    ? trimmedCurrentTitle === trimmedTitleSeed
    : false;
}

function findProviderAdapterRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): ProviderAdapterRequestError | undefined {
  const failReason = cause.reasons.find(Cause.isFailReason);
  return isProviderAdapterRequestError(failReason?.error) ? failReason.error : undefined;
}

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request")
    );
  }
  const message = Cause.pretty(cause);
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending user-input request") ||
      detail.includes("unknown pending user input request") ||
      detail.includes("unknown pending codex user input request")
    );
  }
  const message = Cause.pretty(cause).toLowerCase();
  return (
    message.includes("unknown pending user-input request") ||
    message.includes("unknown pending user input request") ||
    message.includes("unknown pending codex user input request")
  );
}

function stalePendingRequestDetail(
  requestKind: "approval" | "user-input",
  requestId: string,
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized;

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const fetchWorkerCoordinator = yield* FetchWorkerCoordinator;
  const turnAbortCoordinator = yield* TurnAbortCoordinator;
  const providerRegistry = yield* ProviderRegistry;
  const gitWorkflow = yield* GitWorkflowService;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const skillEngine = yield* SkillEngine;
  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const threadModelSelections = new Map<string, ModelSelection>();

  const appendProviderFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("provider-failure-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "error",
            kind: input.kind,
            summary: input.summary,
            payload: {
              detail: input.detail,
              ...(input.requestId ? { requestId: input.requestId } : {}),
            },
            turnId: input.turnId,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const appendFetchWarningActivity = (input: {
    readonly threadId: ThreadId;
    readonly summary: string;
    readonly detail: string;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("fetch-warning-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "error",
            kind: "fetch.warning",
            summary: input.summary,
            payload: { detail: input.detail },
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const appendCoordinationWarningActivity = (input: {
    readonly threadId: ThreadId;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("coordination-warning-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "info",
            kind: "coordination.warning",
            summary: "Project-agent coordination instructions omitted",
            payload: {
              detail:
                "The user request and required transcript handoff consumed the provider input limit, so T3 could not include the project-agent coordination contract for this turn.",
            },
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const formatFailureDetail = (cause: Cause.Cause<unknown>): string => {
    const failReason = cause.reasons.find(Cause.isFailReason);
    const providerError = isProviderAdapterRequestError(failReason?.error)
      ? failReason.error
      : undefined;
    if (providerError) {
      return providerError.detail;
    }
    return Cause.pretty(cause);
  };

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) =>
    serverCommandId("provider-session-set").pipe(
      Effect.flatMap((commandId) =>
        orchestrationEngine.dispatch({
          type: "thread.session.set",
          commandId,
          threadId: input.threadId,
          session: input.session,
          createdAt: input.createdAt,
        }),
      ),
    );

  const settleActiveSubagents = Effect.fn("settleActiveSubagents")(function* (
    thread: OrchestrationReadModel["threads"][number],
    settledAt: string,
    commandTag: string,
  ) {
    yield* Effect.forEach(
      thread.subagents,
      (subagent) => {
        if (!isActiveSubagentStatus(subagent.status)) {
          return Effect.void;
        }
        const settled = settleSubagentAfterRuntimeLoss(subagent, settledAt);
        return serverCommandId(commandTag).pipe(
          Effect.flatMap((commandId) =>
            orchestrationEngine.dispatch({
              type: "thread.subagent.upsert",
              commandId,
              threadId: thread.id,
              subagent: settled,
              createdAt: settledAt,
            }),
          ),
        );
      },
      { concurrency: 1, discard: true },
    );
  });

  const setThreadSessionErrorOnTurnStartFailure = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly detail: string;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }
    const session = thread.session;
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        ...(session ?? {
          threadId: input.threadId,
          providerName: null,
          providerInstanceId: thread.modelSelection.instanceId,
          runtimeSessionId: null,
          runtimeMode: thread.runtimeMode,
          abortState: null,
        }),
        status: session?.status === "stopped" ? "stopped" : "error",
        activeTurnId: null,
        lastError: input.detail,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const resolveProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    return yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const ensureSessionForThread = Effect.fn("ensureSessionForThread")(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
      readonly pendingTurnStart?: boolean;
    },
  ) {
    const thread = yield* resolveThread(threadId);
    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${threadId}' was not found in read model.`));
    }

    const desiredRuntimeMode = thread.runtimeMode;
    const requestedModelSelection = options?.modelSelection;
    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const activeSession = yield* resolveActiveSession(threadId);
    const activeThreadSession =
      thread.session !== null && thread.session.status !== "stopped" && activeSession
        ? thread.session
        : null;
    if (
      activeThreadSession !== null &&
      activeSession !== undefined &&
      (activeThreadSession.providerInstanceId === undefined ||
        activeSession.providerInstanceId === undefined)
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(activeThreadSession.providerName ?? undefined),
        method: "thread.turn.start",
        detail: `Thread '${threadId}' has an active provider session without a provider instance id.`,
      });
    }
    const currentInstanceId =
      activeThreadSession !== null &&
      activeSession !== undefined &&
      activeSession.providerInstanceId !== undefined
        ? activeSession.providerInstanceId
        : thread.modelSelection.instanceId;
    const unnormalizedDesiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const desiredInstanceId = unnormalizedDesiredModelSelection.instanceId;
    const currentInfo = yield* providerService.getInstanceInfo(currentInstanceId).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: providerErrorLabelFromInstanceHint({
              instanceId: String(currentInstanceId),
              modelSelectionInstanceId: String(thread.modelSelection.instanceId),
              sessionProvider: thread.session?.providerName ?? undefined,
            }),
            method: "thread.turn.start",
            detail: `Thread '${threadId}' references unknown provider instance '${currentInstanceId}'. The instance is not configured in this build.`,
          }),
      ),
    );
    const desiredInfo = yield* providerService.getInstanceInfo(desiredInstanceId).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: providerErrorLabelFromInstanceHint({
              instanceId: String(unnormalizedDesiredModelSelection.instanceId),
            }),
            method: "thread.turn.start",
            detail: `Requested provider instance '${desiredInstanceId}' is not configured in this build.`,
          }),
      ),
    );
    const desiredDriverKind = desiredInfo.driverKind;
    if (!isProviderDriverKind(desiredDriverKind)) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(String(desiredDriverKind)),
        method: "thread.turn.start",
        detail: `Requested provider instance '${desiredInstanceId}' uses unknown provider driver '${desiredDriverKind}'. The driver is not installed in this build.`,
      });
    }
    const preferredProvider: ProviderDriverKind = desiredDriverKind;
    if (options?.pendingTurnStart === true && thread.session?.status !== "running") {
      // Clear the previous runtime generation so pre-bind events from a
      // replacement lease can be adopted while status is "starting". Pinning
      // the old runtimeSessionId hard-drops those events until bind lands.
      const pendingProviderName =
        requestedModelSelection !== undefined
          ? preferredProvider
          : (activeSession?.provider ?? preferredProvider);
      const pendingProviderInstanceId =
        requestedModelSelection !== undefined
          ? desiredInstanceId
          : (activeSession?.providerInstanceId ?? desiredInstanceId);
      yield* setThreadSession({
        threadId,
        session: {
          threadId,
          status: "starting",
          providerName: pendingProviderName,
          providerInstanceId: pendingProviderInstanceId,
          runtimeSessionId: null,
          runtimeMode: desiredRuntimeMode,
          activeTurnId: null,
          abortState: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      });
    }
    const providerSnapshots = yield* providerRegistry.getProviders;
    const desiredProviderSnapshot = providerSnapshots.find(
      (snapshot) => snapshot.instanceId === desiredInstanceId,
    );
    const selectedCatalogModel = desiredProviderSnapshot?.models?.find(
      (model) => model.slug === unnormalizedDesiredModelSelection.model,
    );
    const desiredModelSelection =
      desiredDriverKind === ProviderDriverKind.make("codex")
        ? normalizeCodexModelSelectionServiceTier(
            unnormalizedDesiredModelSelection,
            selectedCatalogModel?.capabilities,
          )
        : unnormalizedDesiredModelSelection;
    const currentModel = activeSession?.model ?? thread.modelSelection.model;
    const modelChanged =
      requestedModelSelection !== undefined && requestedModelSelection.model !== currentModel;
    const requiresFreshSessionForModelChange =
      thread.session !== null &&
      modelChanged &&
      (providerSnapshots.find((snapshot) => snapshot.instanceId === currentInstanceId)
        ?.requiresNewThreadForModelChange === true ||
        providerSnapshots.find((snapshot) => snapshot.instanceId === desiredInstanceId)
          ?.requiresNewThreadForModelChange === true);
    const instanceChanged =
      thread.session !== null &&
      requestedModelSelection !== undefined &&
      requestedModelSelection.instanceId !== currentInstanceId;
    const continuationIncompatible =
      instanceChanged &&
      (currentInfo.driverKind !== desiredInfo.driverKind ||
        currentInfo.continuationIdentity.continuationKey !==
          desiredInfo.continuationIdentity.continuationKey);
    const project = yield* resolveProject(thread.projectId);
    const effectiveCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: project ? [project] : [],
    });

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly freshSession?: boolean;
    }) =>
      providerService.startSession(threadId, {
        threadId,
        ...(preferredProvider ? { provider: preferredProvider } : {}),
        providerInstanceId: desiredInstanceId,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        modelSelection: desiredModelSelection,
        ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        ...(input?.freshSession === true ? { freshSession: true } : {}),
        runtimeMode: desiredRuntimeMode,
      });

    const bindSessionToThread = (session: ProviderSession) =>
      Effect.gen(function* () {
        if (session.providerInstanceId === undefined) {
          return yield* new ProviderAdapterRequestError({
            provider: providerErrorLabel(session.provider),
            method: "thread.turn.start",
            detail: `Provider session '${session.threadId}' started without a provider instance id.`,
          });
        }
        yield* setThreadSession({
          threadId,
          session: {
            threadId,
            status:
              options?.pendingTurnStart === true && session.status === "ready"
                ? "starting"
                : mapProviderSessionStatusToOrchestrationStatus(session.status),
            providerName: session.provider,
            providerInstanceId: session.providerInstanceId,
            runtimeSessionId: session.runtimeSessionId ?? null,
            runtimeMode: desiredRuntimeMode,
            // Provider turn ids are not orchestration turn ids.
            activeTurnId: null,
            abortState: null,
            lastError: session.lastError ?? null,
            updatedAt: session.updatedAt,
          },
          createdAt,
        });
      });

    const existingSessionThreadId =
      thread.session && thread.session.status !== "stopped" && activeSession ? thread.id : null;
    if (existingSessionThreadId) {
      const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
      const cwdChanged = effectiveCwd !== activeSession?.cwd;
      const sessionModelSwitch = (yield* providerService.getCapabilities(desiredInstanceId))
        .sessionModelSwitch;
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "unsupported";
      const shouldStartFresh =
        continuationIncompatible ||
        shouldRestartForModelChange ||
        requiresFreshSessionForModelChange;
      const previousModelSelection = threadModelSelections.get(threadId);
      const shouldRestartForModelSelectionChange =
        preferredProvider === "claudeAgent" &&
        requestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection, requestedModelSelection);

      if (
        !runtimeModeChanged &&
        !cwdChanged &&
        !instanceChanged &&
        !shouldRestartForModelChange &&
        !requiresFreshSessionForModelChange &&
        !shouldRestartForModelSelectionChange
      ) {
        return {
          sessionThreadId: existingSessionThreadId,
          transcriptHandoffRequired: false,
          modelSelection: desiredModelSelection,
        };
      }

      const resumeCursor = shouldStartFresh
        ? undefined
        : (activeSession?.resumeCursor ?? undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider: activeSession?.provider,
        currentInstanceId,
        desiredInstanceId,
        desiredProvider: desiredModelSelection.instanceId,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode: thread.runtimeMode,
        runtimeModeChanged,
        previousCwd: activeSession?.cwd,
        desiredCwd: effectiveCwd,
        cwdChanged,
        modelChanged,
        instanceChanged,
        shouldRestartForModelChange,
        requiresFreshSessionForModelChange,
        continuationIncompatible,
        shouldRestartForModelSelectionChange,
        hasResumeCursor: resumeCursor !== undefined,
      });
      const restartedSession = yield* startProviderSession(
        shouldStartFresh
          ? { freshSession: true }
          : resumeCursor !== undefined
            ? { resumeCursor }
            : undefined,
      );
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
        cwd: restartedSession.cwd,
      });
      yield* bindSessionToThread(restartedSession);
      return {
        sessionThreadId: restartedSession.threadId,
        transcriptHandoffRequired: shouldStartFresh,
        modelSelection: desiredModelSelection,
      };
    }

    const shouldStartFresh = continuationIncompatible || requiresFreshSessionForModelChange;
    const startedSession = yield* startProviderSession(
      shouldStartFresh ? { freshSession: true } : undefined,
    );
    yield* bindSessionToThread(startedSession);
    return {
      sessionThreadId: startedSession.threadId,
      transcriptHandoffRequired: shouldStartFresh,
      modelSelection: desiredModelSelection,
    };
  });

  const buildSendTurnRequestForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageText: string;
    readonly boundaryMessageId: OrchestrationMessage["id"];
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: "default" | "plan";
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return yield* Effect.die(
        new Error(`Thread '${input.threadId}' was not found in read model.`),
      );
    }
    const sessionPreparation = yield* ensureSessionForThread(input.threadId, input.createdAt, {
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      pendingTurnStart: true,
    });
    if (input.modelSelection !== undefined) {
      threadModelSelections.set(input.threadId, sessionPreparation.modelSelection);
    }
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    const project = yield* resolveProject(thread.projectId);
    const providerMessageText =
      activeSession?.providerInstanceId === undefined
        ? input.messageText
        : yield* skillEngine.rewritePromptForProvider({
            providerInstanceId: activeSession.providerInstanceId,
            ...(project ? { projectCwd: project.workspaceRoot } : {}),
            prompt: input.messageText,
          });
    const providerInputWithHandoff = sessionPreparation.transcriptHandoffRequired
      ? prependProviderTranscriptHandoff({
          handoff: buildProviderTranscriptHandoff({
            messages: thread.messages,
            boundaryMessageId: input.boundaryMessageId,
          }),
          providerInput: providerMessageText,
        })
      : providerMessageText;
    if (providerInputWithHandoff.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(activeSession?.provider),
        method: "thread.turn.start",
        detail: `Full transcript handoff for thread '${input.threadId}' is ${providerInputWithHandoff.length} characters, exceeding the provider input limit of ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS}. The transcript was not truncated.`,
      });
    }
    let providerInput = providerInputWithHandoff;
    if (yield* projectionSnapshotQuery.hasActiveProjectAgentPeer(input.threadId)) {
      const coordinationApplication = applyProjectAgentInstructionsToProviderInput({
        providerInput,
      });
      providerInput = coordinationApplication.providerInput ?? "";
      if (coordinationApplication.outcome === "omitted") {
        yield* appendCoordinationWarningActivity({
          threadId: input.threadId,
          createdAt: input.createdAt,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("provider command reactor failed to append coordination warning", {
              threadId: input.threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      }
    }
    const normalizedInput = toNonEmptyProviderInput(providerInput);
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : activeSession.providerInstanceId === undefined
          ? yield* new ProviderAdapterRequestError({
              provider: providerErrorLabel(activeSession.provider),
              method: "thread.turn.start",
              detail: `Active provider session '${activeSession.threadId}' is missing a provider instance id.`,
            })
          : (yield* providerService.getCapabilities(activeSession.providerInstanceId))
              .sessionModelSwitch;
    const requestedModelSelection =
      input.modelSelection !== undefined
        ? sessionPreparation.modelSelection
        : (threadModelSelections.get(input.threadId) ?? thread.modelSelection);
    const modelForTurn =
      sessionModelSwitch === "unsupported" && input.modelSelection === undefined
        ? activeSession?.model !== undefined
          ? {
              ...requestedModelSelection,
              model: activeSession.model,
            }
          : requestedModelSelection
        : input.modelSelection !== undefined
          ? requestedModelSelection
          : undefined;

    if (input.modelSelection !== undefined) {
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("model-selection-commit"),
        threadId: input.threadId,
        modelSelection: sessionPreparation.modelSelection,
      });
      threadModelSelections.set(input.threadId, sessionPreparation.modelSelection);
    }

    return {
      threadId: input.threadId,
      ...(normalizedInput ? { input: normalizedInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    };
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fn(
    "maybeGenerateAndRenameWorktreeBranchForFirstTurn",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const settings = yield* serverSettingsService.getSettings;
      const modelSelection =
        settings.sourceControlWriterModelSelection === null
          ? settings.textGenerationModelSelection
          : resolveSourceControlWriterModelSelection(
              settings,
              yield* providerRegistry.getProviders,
            );

      const generated = yield* textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
      if (targetBranch === oldBranch) return;

      const renamed = yield* gitWorkflow.renameBranch({ cwd, oldBranch, newBranch: targetBranch });
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("worktree-branch-rename"),
        threadId: input.threadId,
        branch: renamed.branch,
        worktreePath: cwd,
      });
      yield* vcsStatusBroadcaster.refreshStatus(cwd).pipe(Effect.ignoreCause({ log: true }));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const maybeGenerateThreadTitleForFirstTurn = Effect.fn("maybeGenerateThreadTitleForFirstTurn")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly cwd: string;
      readonly messageText: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
      readonly titleSeed?: string;
    }) {
      const attachments = input.attachments ?? [];
      yield* Effect.gen(function* () {
        const { textGenerationModelSelection: modelSelection } =
          yield* serverSettingsService.getSettings;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: input.cwd,
          message: input.messageText,
          ...(attachments.length > 0 ? { attachments } : {}),
          modelSelection,
        });
        if (!generated) return;

        const thread = yield* resolveThread(input.threadId);
        if (!thread) return;
        if (!canReplaceThreadTitle(thread.title, input.titleSeed)) {
          return;
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: yield* serverCommandId("thread-title-rename"),
          threadId: input.threadId,
          title: generated.title,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to generate or rename thread title", {
            threadId: input.threadId,
            cwd: input.cwd,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    },
  );

  const regenerateThreadTitle = Effect.fn("regenerateThreadTitle")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>,
    requestId: CommandId,
  ) {
    if (event.payload.regenerateTitle !== true) {
      return { _tag: "Superseded" } as const;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread || thread.titleRegeneration?.requestId !== requestId) {
      return { _tag: "Superseded" } as const;
    }

    const { message, attachments } = formatThreadTitleContext(thread.messages);
    if (message.length === 0) {
      return { _tag: "Completed", title: undefined } as const;
    }

    const previousTitle = event.payload.previousTitle ?? thread.title;
    if (thread.title !== previousTitle) {
      return { _tag: "Superseded" } as const;
    }
    const project = yield* resolveProject(thread.projectId);
    const cwd =
      resolveThreadWorkspaceCwd({
        thread,
        projects: project ? [project] : [],
      }) ?? process.cwd();
    const { textGenerationModelSelection: modelSelection } =
      yield* serverSettingsService.getSettings;
    const generated = yield* textGeneration.generateThreadTitle({
      cwd,
      message,
      previousTitle,
      ...(attachments.length > 0 ? { attachments } : {}),
      modelSelection,
    });
    if (generated.title === DEFAULT_THREAD_TITLE || generated.title === previousTitle) {
      return { _tag: "Completed", title: undefined } as const;
    }

    const latestThread = yield* resolveThread(event.payload.threadId);
    if (
      !latestThread ||
      latestThread.titleRegeneration?.requestId !== requestId ||
      latestThread.title !== previousTitle
    ) {
      return { _tag: "Superseded" } as const;
    }

    return { _tag: "Completed", title: generated.title } as const;
  });
  const dispatchThreadTitleRegenerationCompletion = Effect.fn(
    "dispatchThreadTitleRegenerationCompletion",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly title?: string;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.title.regeneration.complete",
      commandId: yield* serverCommandId("thread-title-regeneration-complete"),
      threadId: input.threadId,
      requestId: input.requestId,
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
  });
  const reconcileOrphanedSessionAtStartup = Effect.fn("reconcileOrphanedSessionAtStartup")(
    function* (thread: OrchestrationReadModel["threads"][number], reconciledAt: string) {
      const session = thread.session;
      if (session === null) {
        return;
      }

      yield* setThreadSession({
        threadId: thread.id,
        session: {
          ...session,
          status: "interrupted",
          runtimeSessionId: null,
          activeTurnId: null,
          abortState: null,
          lastError: null,
          updatedAt: reconciledAt,
        },
        createdAt: reconciledAt,
      });

      const threadDetail = yield* resolveThread(thread.id);
      if (!threadDetail) {
        return;
      }
      yield* Effect.forEach(
        threadDetail.messages.filter(
          (message) => message.role === "assistant" && message.streaming,
        ),
        (message) =>
          serverCommandId("startup-assistant-message-complete").pipe(
            Effect.flatMap((commandId) =>
              orchestrationEngine.dispatch({
                type: "thread.message.assistant.complete",
                commandId,
                threadId: thread.id,
                messageId: message.id,
                ...(message.turnId !== null ? { turnId: message.turnId } : {}),
                createdAt: reconciledAt,
              }),
            ),
          ),
        { concurrency: 1, discard: true },
      );
    },
  );
  const reconcileOrphanedSessionsAtStartup = Effect.fn("reconcileOrphanedSessionsAtStartup")(
    function* (readModel: OrchestrationReadModel) {
      const projectedInFlightThreads = readModel.threads.filter(
        (thread) =>
          thread.deletedAt === null &&
          (thread.session?.status === "starting" || thread.session?.status === "running"),
      );
      const liveSessions = yield* providerService.listSessions();
      const liveThreadIds = new Set(liveSessions.map((session) => session.threadId));
      const projectedInFlightThreadIds = new Set(
        projectedInFlightThreads.map((thread) => thread.id),
      );
      const orphanedThreads = readModel.threads.filter(
        (thread) =>
          thread.deletedAt === null &&
          !liveThreadIds.has(thread.id) &&
          (projectedInFlightThreadIds.has(thread.id) ||
            thread.subagents.some((subagent) => isActiveSubagentStatus(subagent.status))),
      );
      const reconciledAt = DateTime.formatIso(yield* DateTime.now);
      const outcomes = yield* Effect.forEach(
        orphanedThreads,
        (thread) =>
          Effect.gen(function* () {
            if (projectedInFlightThreadIds.has(thread.id)) {
              yield* reconcileOrphanedSessionAtStartup(thread, reconciledAt);
            }
            yield* settleActiveSubagents(
              thread,
              reconciledAt,
              "startup-subagent-runtime-loss-upsert",
            );
          }).pipe(
            Effect.as(true),
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) {
                return Effect.interrupt;
              }
              return Effect.logWarning(
                "provider command reactor failed to reconcile orphaned startup session",
                {
                  threadId: thread.id,
                  cause: Cause.pretty(cause),
                },
              ).pipe(Effect.as(false));
            }),
          ),
        { concurrency: 1 },
      );

      yield* Effect.logInfo("provider command reactor reconciled startup sessions", {
        projectedInFlightSessionCount: projectedInFlightThreads.length,
        liveProviderSessionCount: liveSessions.length,
        orphanedSessionCount: orphanedThreads.length,
        reconciledSessionCount: outcomes.filter(Boolean).length,
      });
    },
  );
  const findInterruptedThreadTitleRegenerations = Effect.fn(
    "findInterruptedThreadTitleRegenerations",
  )(function* () {
    const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
    return readModel.threads.flatMap((thread) => {
      const requestId = thread.titleRegeneration?.requestId;
      return requestId === undefined ? [] : [{ threadId: thread.id, requestId }];
    });
  });
  const clearInterruptedThreadTitleRegenerations = Effect.fn(
    "clearInterruptedThreadTitleRegenerations",
  )(function* (
    interrupted: ReadonlyArray<{ readonly threadId: ThreadId; readonly requestId: CommandId }>,
  ) {
    yield* Effect.forEach(
      interrupted,
      ({ threadId, requestId }) => {
        return dispatchThreadTitleRegenerationCompletion({
          threadId,
          requestId,
        }).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.interrupt;
            }
            return Effect.logWarning(
              "provider command reactor failed to clear interrupted title regeneration",
              {
                threadId,
                cause: Cause.pretty(cause),
              },
            );
          }),
        );
      },
      { discard: true },
    );
  });
  const processThreadTitleRegenerationSafely = Effect.fn("processThreadTitleRegenerationSafely")(
    function* (event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>) {
      if (event.payload.regenerateTitle !== true) {
        return;
      }

      const requestId = event.payload.titleRegeneration?.requestId ?? event.commandId;
      if (requestId === null) {
        return;
      }
      const result = yield* regenerateThreadTitle(event, requestId).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("provider command reactor failed to regenerate thread title", {
            threadId: event.payload.threadId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as({ _tag: "Completed", title: undefined } as const));
        }),
      );
      if (result._tag === "Superseded") {
        return;
      }

      const completion = {
        threadId: event.payload.threadId,
        requestId,
        ...(result.title !== undefined ? { title: result.title } : {}),
      };
      yield* dispatchThreadTitleRegenerationCompletion(completion).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning(
            "provider command reactor retrying title regeneration completion",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          ).pipe(Effect.andThen(dispatchThreadTitleRegenerationCompletion(completion)));
        }),
      );
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning(
            "provider command reactor failed to complete title regeneration",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          );
        }),
      ),
  );
  const threadTitleRegenerationWorker = yield* makeDrainableWorker(
    processThreadTitleRegenerationSafely,
  );

  const processTurnStartRequested = Effect.fn("processTurnStartRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const key = turnStartKeyForEvent(event);
    if (yield* hasHandledTurnStartRecently(key)) {
      return;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    const isFirstUserMessageTurn =
      thread.messages.filter((entry) => entry.role === "user").length === 1;
    if (isFirstUserMessageTurn) {
      const project = yield* resolveProject(thread.projectId);
      const generationCwd =
        resolveThreadWorkspaceCwd({
          thread,
          projects: project ? [project] : [],
        }) ?? process.cwd();
      const generationInput = {
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.titleSeed !== undefined ? { titleSeed: event.payload.titleSeed } : {}),
      };

      yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        ...generationInput,
      }).pipe(Effect.forkScoped);

      if (canReplaceThreadTitle(thread.title, event.payload.titleSeed)) {
        yield* maybeGenerateThreadTitleForFirstTurn({
          threadId: event.payload.threadId,
          cwd: generationCwd,
          ...generationInput,
        }).pipe(Effect.forkScoped);
      }
    }

    const handleTurnStartFailure = (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.void;
      }
      const detail = formatFailureDetail(cause);
      return setThreadSessionErrorOnTurnStartFailure({
        threadId: event.payload.threadId,
        detail,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.flatMap(() =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.turn.start.failed",
            summary: "Provider turn start failed",
            detail,
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
        Effect.asVoid,
      );
    };

    const recoverTurnStartFailure = (cause: Cause.Cause<unknown>) =>
      handleTurnStartFailure(cause).pipe(
        Effect.catchCause((recoveryCause) =>
          Effect.logWarning("provider command reactor failed to recover turn start failure", {
            eventType: event.type,
            threadId: event.payload.threadId,
            cause: Cause.pretty(recoveryCause),
            originalCause: Cause.pretty(cause),
          }),
        ),
      );

    const startProviderTurn = Effect.gen(function* () {
      const sendTurnRequest = yield* buildSendTurnRequestForThread({
        threadId: event.payload.threadId,
        messageText: message.text,
        boundaryMessageId: message.id,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        interactionMode: event.payload.interactionMode,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.map(Option.some),
        Effect.catchCause((cause) => handleTurnStartFailure(cause).pipe(Effect.as(Option.none()))),
      );

      if (Option.isNone(sendTurnRequest)) {
        return;
      }

      const sendMainTurn = (request: typeof sendTurnRequest.value) =>
        providerService.sendTurn(request).pipe(Effect.catchCause(recoverTurnStartFailure));

      if (event.payload.fetchMode === undefined) {
        yield* sendMainTurn(sendTurnRequest.value);
        return;
      }

      const settings = yield* serverSettingsService.getSettings;
      const providers = yield* providerRegistry.getProviders;
      const resolution = resolveFetchModelSelection({
        providers,
        fetchModelSelection: settings.fetchModelSelection,
        textGenerationModelSelection: settings.textGenerationModelSelection,
      });
      if (resolution.status === "unavailable") {
        const requested = resolution.requestedSelection;
        const detail =
          resolution.source === "manual" && requested !== null
            ? `The configured Fetch model '${requested.instanceId}/${requested.model}' is unavailable. T3 did not substitute another model.`
            : "No enabled and available provider model can run Fetch workers in this environment.";
        yield* appendFetchWarningActivity({
          threadId: event.payload.threadId,
          summary: "Fetch unavailable",
          detail,
          createdAt: event.payload.createdAt,
        });
        yield* sendMainTurn(sendTurnRequest.value);
        return;
      }

      const fetchWorkers = resolution.provider.fetchWorkers;
      if (fetchWorkers === undefined) {
        yield* appendFetchWarningActivity({
          threadId: event.payload.threadId,
          summary: "Fetch unavailable",
          detail: `Provider '${resolution.provider.instanceId}' does not advertise Fetch worker support.`,
          createdAt: event.payload.createdAt,
        });
        yield* sendMainTurn(sendTurnRequest.value);
        return;
      }

      const project = yield* resolveProject(thread.projectId);
      const cwd =
        resolveThreadWorkspaceCwd({
          thread,
          projects: project ? [project] : [],
        }) ??
        project?.workspaceRoot ??
        process.cwd();
      const lunaFallback =
        resolution.source === "auto-spark" ? resolveFetchLunaFallback(providers) : undefined;
      const contextMaxChars = remainingFetchContextChars(sendTurnRequest.value.input);
      const fetchResult = yield* fetchWorkerCoordinator.run({
        threadId: event.payload.threadId,
        cwd,
        userRequest: message.text,
        modelSelection: resolution.selection,
        providerDriver: resolution.provider.driver,
        maxRecommendedWorkers: fetchWorkers.maxRecommendedWorkers,
        commandExecutionPolicy: fetchWorkers.commandExecutionPolicy,
        contextMaxChars,
        ...(lunaFallback?.status === "resolved" && lunaFallback.provider.fetchWorkers !== undefined
          ? {
              lunaFallback: {
                modelSelection: lunaFallback.selection,
                providerDriver: lunaFallback.provider.driver,
                maxRecommendedWorkers: lunaFallback.provider.fetchWorkers.maxRecommendedWorkers,
                commandExecutionPolicy: lunaFallback.provider.fetchWorkers.commandExecutionPolicy,
              },
            }
          : {}),
      });

      yield* Effect.forEach(
        fetchResult.warnings,
        (warning) =>
          appendFetchWarningActivity({
            threadId: event.payload.threadId,
            summary: "Fetch warning",
            detail: warning,
            createdAt: event.payload.createdAt,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("provider command reactor failed to append Fetch warning", {
                threadId: event.payload.threadId,
                warning,
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        { concurrency: 1, discard: true },
      );

      const contextApplication = applyFetchContextToProviderInput({
        ...(sendTurnRequest.value.input !== undefined
          ? { providerInput: sendTurnRequest.value.input }
          : {}),
        ...(fetchResult.context !== undefined ? { fetchContext: fetchResult.context } : {}),
      });
      if (
        contextApplication.outcome === "omitted" ||
        (fetchResult.successfulWorkers > 0 && fetchResult.context === undefined)
      ) {
        yield* appendFetchWarningActivity({
          threadId: event.payload.threadId,
          summary: "Fetch context omitted",
          detail:
            "The main request and required transcript handoff consumed the provider input limit, so collected Fetch evidence was not sent to the main provider.",
          createdAt: event.payload.createdAt,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("provider command reactor failed to append Fetch context warning", {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      }
      const requestWithFetchContext =
        contextApplication.providerInput === sendTurnRequest.value.input
          ? sendTurnRequest.value
          : {
              ...sendTurnRequest.value,
              ...(contextApplication.providerInput !== undefined
                ? { input: contextApplication.providerInput }
                : {}),
            };

      yield* fetchWorkerCoordinator.handoffToMain(
        {
          threadId: event.payload.threadId,
          runId: fetchResult.runId,
        },
        sendMainTurn(requestWithFetchContext),
      );
    });

    yield* startProviderTurn.pipe(Effect.catchCause(recoverTurnStartFailure), Effect.forkScoped);
  });

  const processTurnInterruptRequested = Effect.fn("processTurnInterruptRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-interrupt-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const abortRequest = {
      threadId: event.payload.threadId,
      ...(event.payload.turnId !== undefined ? { turnId: event.payload.turnId } : {}),
      requestedAt: event.payload.createdAt,
    };
    const handledByFetch = yield* fetchWorkerCoordinator.requestInterrupt(abortRequest).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to interrupt Fetch preflight", {
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(false)),
      ),
    );
    if (handledByFetch) {
      return;
    }
    yield* turnAbortCoordinator.requestAbort(abortRequest).pipe(
      Effect.catchCause((cause) =>
        appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.turn.interrupt.failed",
          summary: "Provider turn interrupt failed",
          detail: formatFailureDetail(cause),
          turnId: event.payload.turnId ?? null,
          createdAt: event.payload.createdAt,
        }),
      ),
    );
  });

  const processApprovalResponseRequested = Effect.fn("processApprovalResponseRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    yield* providerService
      .respondToRequest({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            detail: isUnknownPendingApprovalRequestError(cause)
              ? stalePendingRequestDetail("approval", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fn("processUserInputResponseRequested")(
    function* (
      event: Extract<ProviderIntentEvent, { type: "thread.user-input-response-requested" }>,
    ) {
      const thread = yield* resolveThread(event.payload.threadId);
      if (!thread) {
        return;
      }
      const hasSession = thread.session && thread.session.status !== "stopped";
      if (!hasSession) {
        return yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.user-input.respond.failed",
          summary: "Provider user input response failed",
          detail: "No active provider session is bound to this thread.",
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
        });
      }

      yield* providerService
        .respondToUserInput({
          threadId: event.payload.threadId,
          requestId: event.payload.requestId,
          answers: event.payload.answers,
        })
        .pipe(
          Effect.catchCause((cause) =>
            appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.user-input.respond.failed",
              summary: "Provider user input response failed",
              detail: isUnknownPendingUserInputRequestError(cause)
                ? stalePendingRequestDetail("user-input", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            }),
          ),
        );
    },
  );

  const processSessionStopRequested = Effect.fn("processSessionStopRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.session-stop-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const now = event.payload.createdAt;
    if (thread.session && thread.session.status !== "stopped") {
      yield* providerService.stopSession({ threadId: thread.id });
    }

    yield* settleActiveSubagents(thread, now, "session-stop-subagent-runtime-loss-upsert");

    yield* setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        ...(thread.session?.providerInstanceId !== undefined
          ? { providerInstanceId: thread.session.providerInstanceId }
          : {}),
        runtimeSessionId: null,
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        abortState: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: now,
      },
      createdAt: now,
    });
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (
    event: ProviderIntentEvent,
  ) {
    yield* Effect.annotateCurrentSpan({
      "orchestration.event_type": event.type,
      "orchestration.thread_id": event.payload.threadId,
      ...(event.commandId ? { "orchestration.command_id": event.commandId } : {}),
    });
    yield* increment(orchestrationEventsProcessedTotal, {
      eventType: event.type,
    });
    switch (event.type) {
      case "thread.meta-updated":
        yield* threadTitleRegenerationWorker.enqueue(event);
        return;
      case "thread.runtime-mode-set": {
        const thread = yield* resolveThread(event.payload.threadId);
        if (!thread?.session || thread.session.status === "stopped") {
          return;
        }
        const cachedModelSelection = threadModelSelections.get(event.payload.threadId);
        yield* ensureSessionForThread(
          event.payload.threadId,
          event.occurredAt,
          cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {},
        );
        return;
      }
      case "thread.turn-start-requested":
        yield* processTurnStartRequested(event);
        return;
      case "thread.turn-interrupt-requested":
        yield* processTurnInterruptRequested(event);
        return;
      case "thread.approval-response-requested":
        yield* processApprovalResponseRequested(event);
        return;
      case "thread.user-input-response-requested":
        yield* processUserInputResponseRequested(event);
        return;
      case "thread.session-stop-requested":
        yield* processSessionStopRequested(event);
        return;
    }
  });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = Effect.fn("start")(function* () {
    const interruptedTitleRegenerations = yield* findInterruptedThreadTitleRegenerations().pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to find interrupted title regenerations",
          { cause: Cause.pretty(cause) },
        ).pipe(Effect.as([]));
      }),
    );
    const processEvent = Effect.fn("processEvent")(function* (event: OrchestrationEvent) {
      if (
        (event.type === "thread.meta-updated" && event.payload.regenerateTitle === true) ||
        event.type === "thread.runtime-mode-set" ||
        event.type === "thread.turn-start-requested" ||
        event.type === "thread.turn-interrupt-requested" ||
        event.type === "thread.approval-response-requested" ||
        event.type === "thread.user-input-response-requested" ||
        event.type === "thread.session-stop-requested"
      ) {
        return yield* worker.enqueue(event);
      }
    });

    yield* forkParked(Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent));

    const startupReadModel = yield* projectionSnapshotQuery.getCommandReadModel().pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to load startup reconciliation state",
          {
            cause: Cause.pretty(cause),
          },
        ).pipe(Effect.as(Option.none<OrchestrationReadModel>()));
      }),
    );
    if (Option.isNone(startupReadModel)) {
      return;
    }

    yield* reconcileOrphanedSessionsAtStartup(startupReadModel.value).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to reconcile orphaned startup sessions",
          {
            cause: Cause.pretty(cause),
          },
        );
      }),
    );

    // The domain event stream is hot, so work pending before this reactor
    // starts cannot be resumed. Correlated completions only clear the request
    // captured here, leaving any newer request untouched.
    const clearInterrupted = clearInterruptedThreadTitleRegenerations(
      interruptedTitleRegenerations,
    ).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to clear interrupted title regenerations",
          {
            cause: Cause.pretty(cause),
          },
        );
      }),
    );
    const activation = yield* ServerActivation;
    if (activation === undefined) {
      yield* clearInterrupted;
    } else {
      yield* forkParked(clearInterrupted);
    }
  });

  return {
    start,
    drain: Effect.gen(function* () {
      yield* worker.drain;
      yield* threadTitleRegenerationWorker.drain;
    }),
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make);
