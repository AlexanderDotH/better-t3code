/**
 * CodexAdapterLive - Scoped live implementation for the Codex provider adapter.
 *
 * Wraps the typed Codex session runtime behind the `CodexAdapter` service
 * contract and maps runtime failures into the shared `ProviderAdapterError`
 * algebra.
 *
 * @module CodexAdapterLive
 */
import {
  type CodexSettings,
  ProviderDriverKind,
  type McpServerDefinition,
  type ProviderEvent,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  RuntimeSessionId,
  ThreadId,
  ProviderSendTurnInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  getModelSelectionStringOptionValue,
  resolveCodexContextWindowTokens,
} from "@t3tools/shared/model";
import { getCodexServiceTierOptionValue } from "../../codexModelOptions.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import * as ResourceProtection from "../../resourceProtection/SubagentResourceGovernor.ts";
import {
  codexResourceGovernorHookLaunchConfiguration,
  RESOURCE_PROTECTION_CONFIGURATION_ENV,
  RESOURCE_PROTECTION_URL_ENV,
} from "../../resourceProtection/CodexResourceGovernorHook.ts";

import {
  ProviderAdapterRequestError,
  ProviderAdapterProcessError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { type CodexAdapterShape } from "../Services/CodexAdapter.ts";
import type { ProviderNativeThreadForkInput } from "../Services/ProviderAdapter.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  CodexResumeCursorSchema,
  CodexSessionRuntimeThreadIdMissingError,
  makeCodexSessionRuntime,
  type CodexSessionRuntimeError,
  type CodexSessionRuntimeOptions,
  type CodexSessionRuntimeShape,
} from "./CodexSessionRuntime.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { resolveCodexLaunchArgs } from "./codexLaunchArgs.ts";
import { stampProviderRuntimeEventOrigin } from "../runtimeEventOrigin.ts";
import {
  makeBoundedProviderEventQueue,
  providerEventEncodedBytes,
  PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
  PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
} from "../boundedEventQueue.ts";
import {
  type CodexMcpStartupObservation,
  codexManagedMcpServers,
  observeCodexMcpEvent,
  sanitizeCodexMcpNativeEvent,
} from "./CodexMcpRuntimeView.ts";
import { makeCodexRuntimeEventMapper } from "./CodexRuntimeEventMapper.ts";
import { makeCodexMcpRuntime } from "./CodexMcpRuntime.ts";
import { makeCodexAdapterSessionStore } from "./CodexAdapterSession.ts";

export { sanitizeCodexMcpNativeEvent } from "./CodexMcpRuntimeView.ts";
export {
  makeCodexRuntimeEventMapper,
  normalizeCodexCollabAgentStatus,
} from "./CodexRuntimeEventMapper.ts";
const isCodexAppServerProcessExitedError = Schema.is(CodexErrors.CodexAppServerProcessExitedError);
const isCodexAppServerTransportError = Schema.is(CodexErrors.CodexAppServerTransportError);
const isCodexSessionRuntimeThreadIdMissingError = Schema.is(
  CodexSessionRuntimeThreadIdMissingError,
);
const isCodexResumeCursorSchema = Schema.is(CodexResumeCursorSchema);

const PROVIDER = ProviderDriverKind.make("codex");

export interface CodexAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly makeRuntime?: (
    options: CodexSessionRuntimeOptions,
  ) => Effect.Effect<
    CodexSessionRuntimeShape,
    CodexSessionRuntimeError,
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  >;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly resolveMcpServers?: (input: {
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<McpServerDefinition>>;
}

export function mapCodexRuntimeError(
  threadId: ThreadId,
  method: string,
  error: CodexSessionRuntimeError,
): ProviderAdapterError {
  if (isCodexAppServerProcessExitedError(error) || isCodexAppServerTransportError(error)) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause: error,
    });
  }

  if (isCodexSessionRuntimeThreadIdMissingError(error)) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause: error,
    });
  }

  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: error.message,
    cause: error,
  });
}

export const makeCodexAdapter = Effect.fn("makeCodexAdapter")(function* (
  codexConfig: CodexSettings,
  options?: CodexAdapterLiveOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("codex");
  const fileSystem = yield* FileSystem.FileSystem;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const resourceGovernor = Option.getOrUndefined(
    yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor),
  );
  const serverConfig = yield* Effect.service(ServerConfig);
  const nativeEventLogger =
    options?.nativeEventLogger ??
    (options?.nativeEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
          stream: "native",
        })
      : undefined);
  const managedNativeEventLogger =
    options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;
  const runtimeEventQueue = yield* makeBoundedProviderEventQueue<ProviderRuntimeEvent>({
    capacity: PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
    byteCapacity: PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
    sizeOf: providerEventEncodedBytes,
  });
  const sessionStore = makeCodexAdapterSessionStore({
    boundInstanceId,
    ...(resourceGovernor ? { resourceGovernor } : {}),
  });
  const {
    forceStopSession,
    hasSession,
    listSessions,
    requireMcpRuntimeSession,
    requireSession,
    stopAll,
    stopSession,
  } = sessionStore;

  const startSession: CodexAdapterShape["startSession"] = (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          });
        }

        yield* sessionStore.stopExisting(input.threadId);
        const runtimeSessionId =
          input.runtimeSessionId ??
          RuntimeSessionId.make(
            yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "crypto/randomUUIDv4",
                    detail: "Failed to generate Codex runtime identifier.",
                    cause,
                  }),
              ),
            ),
          );

        const serviceTier =
          input.modelSelection?.instanceId === boundInstanceId
            ? getCodexServiceTierOptionValue(input.modelSelection)
            : undefined;
        const reasoningEffort =
          input.modelSelection?.instanceId === boundInstanceId
            ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
            : undefined;
        const contextWindow =
          input.modelSelection?.instanceId === boundInstanceId
            ? resolveCodexContextWindowTokens(input.modelSelection)
            : undefined;
        const fetchWorker = input.purpose === "fetch-worker";
        const transientWorker = fetchWorker || input.purpose === "subagent-worker";
        const runtimeMode = fetchWorker ? "approval-required" : input.runtimeMode;
        const cwd = input.cwd ?? process.cwd();
        const resolvedMcpServers =
          !fetchWorker && options?.resolveMcpServers
            ? yield* options.resolveMcpServers({ cwd })
            : [];
        const mcpSession = McpProviderSession.readMcpProviderSession(input.threadId);
        const resourceHook =
          !transientWorker && resourceGovernor && mcpSession
            ? codexResourceGovernorHookLaunchConfiguration({})
            : undefined;
        const resourceConfigurationKey = ResourceProtection.resourceConfigurationKey([
          PROVIDER,
          boundInstanceId,
          input.modelSelection ?? null,
          resolvedMcpServers,
          mcpSession ? "t3-code" : "",
        ]);
        const appServerArgs = [
          ...(transientWorker ? ["--disable", "multi_agent"] : []),
          ...(input.projectMemoryMode === "project" || input.projectMemoryMode === "off"
            ? ["-c", "memories.use_memories=false", "-c", "memories.generate_memories=false"]
            : []),
          ...(fetchWorker && mcpSession === undefined ? ["-c", "mcp_servers={}"] : []),
          ...(mcpSession
            ? [
                "-c",
                `mcp_servers.t3-code.url=${mcpSession.endpoint}`,
                "-c",
                'mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"',
              ]
            : []),
          ...(resourceHook?.appServerArgs ?? []),
        ];
        const runtimeInput: CodexSessionRuntimeOptions = {
          threadId: input.threadId,
          providerInstanceId: boundInstanceId,
          cwd,
          binaryPath: codexConfig.binaryPath,
          launchArgs: resolveCodexLaunchArgs(codexConfig.launchArgs, options?.environment),
          ...(options?.environment ? { environment: options.environment } : {}),
          ...(codexConfig.homePath ? { homePath: codexConfig.homePath } : {}),
          ...(!transientWorker &&
          !input.freshSession &&
          isCodexResumeCursorSchema(input.resumeCursor)
            ? { resumeCursor: input.resumeCursor }
            : {}),
          runtimeMode,
          ...(input.modelSelection?.instanceId === boundInstanceId
            ? { model: input.modelSelection.model }
            : {}),
          ...(reasoningEffort
            ? {
                reasoningEffort:
                  reasoningEffort as EffectCodexSchema.V2TurnStartParams__ReasoningEffort,
              }
            : {}),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(serviceTier ? { serviceTier } : {}),
          ...(mcpSession
            ? {
                environment: {
                  ...(options?.environment ?? process.env),
                  T3_MCP_BEARER_TOKEN: mcpSession.authorizationHeader.replace(/^Bearer\s+/, ""),
                  ...(resourceHook
                    ? {
                        [RESOURCE_PROTECTION_URL_ENV]: new URL(
                          "/internal/resource-protection/codex-admit",
                          mcpSession.endpoint,
                        ).toString(),
                        [RESOURCE_PROTECTION_CONFIGURATION_ENV]: resourceConfigurationKey,
                      }
                    : {}),
                },
                internalMcpServer: {
                  url: mcpSession.endpoint,
                  bearerTokenEnvVar: "T3_MCP_BEARER_TOKEN",
                },
              }
            : {}),
          ...(appServerArgs.length > 0 ? { appServerArgs } : {}),
          ...(resourceHook ? { appServerGlobalArgs: resourceHook.globalArgs } : {}),
          ...(options?.resolveMcpServers ? { mcpServers: resolvedMcpServers } : {}),
        };
        const sessionScope = yield* Scope.make("sequential");
        let sessionScopeTransferred = false;
        yield* Effect.addFinalizer(() =>
          sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
        );
        const createRuntime = options?.makeRuntime ?? makeCodexSessionRuntime;
        const runtime = yield* createRuntime(runtimeInput).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );
        const mapRuntimeEvent = makeCodexRuntimeEventMapper(runtimeInput.resumeCursor?.threadId);
        const mcpStartupStatuses = new Map<string, CodexMcpStartupObservation>();

        // Fork into the session scope, not the calling fiber. `forkChild` makes
        // this a child of `startSession`, and Effect interrupts a fiber's
        // children when it completes, so the consumer died on return and every
        // runtime event the session emitted afterwards was dropped.
        const eventFiber = yield* Stream.runForEach(runtime.events, (event) =>
          Effect.gen(function* () {
            yield* writeNativeEvent(sanitizeCodexMcpNativeEvent(event));
            observeCodexMcpEvent(event, mcpStartupStatuses);
            const runtimeEvents = mapRuntimeEvent(event, event.threadId);
            if (runtimeEvents.length === 0) {
              yield* Effect.logDebug("ignoring unhandled Codex provider event", {
                method: event.method,
                threadId: event.threadId,
                turnId: event.turnId,
                itemId: event.itemId,
              });
              return;
            }
            yield* runtimeEventQueue.offerAll(
              runtimeEvents.map((runtimeEvent) =>
                stampProviderRuntimeEventOrigin(runtimeSessionId, runtimeEvent),
              ),
            );
          }),
        ).pipe(Effect.forkIn(sessionScope));

        const started = yield* runtime.start().pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: cause.message,
                cause,
              }),
          ),
          Effect.onError(() =>
            runtime.close.pipe(
              Effect.andThen(Effect.ignore(Scope.close(sessionScope, Exit.void))),
              Effect.andThen(Fiber.interrupt(eventFiber)),
              Effect.ignore,
            ),
          ),
        );

        sessionStore.install({
          threadId: input.threadId,
          runtimeSessionId,
          cwd,
          scope: sessionScope,
          runtime,
          eventFiber,
          managedMcpServers: codexManagedMcpServers(resolvedMcpServers),
          mcpStartupStatuses,
          builtInMcpExpected: mcpSession !== undefined,
          stopped: false,
        });
        sessionScopeTransferred = true;

        return {
          ...started,
          runtimeSessionId,
        };
      }),
    );

  const resolveAttachment = Effect.fn("resolveAttachment")(function* (
    input: ProviderSendTurnInput,
    attachment: NonNullable<ProviderSendTurnInput["attachments"]>[number],
  ) {
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: serverConfig.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: "turn/start",
        detail: `Invalid attachment id '${attachment.id}'.`,
      });
    }
    const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "turn/start",
            detail: `Failed to read attachment file: ${cause.message}.`,
            cause,
          }),
      ),
    );
    return {
      type: "image" as const,
      url: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    };
  });

  const sendTurn: CodexAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
    // Codex ingests images only. Anything else would be base64-encoded as an
    // image and rejected or misread; generic files reach the agent through the
    // path line ProviderService puts in the prompt.
    const codexAttachments = yield* Effect.forEach(
      (input.attachments ?? []).filter((attachment) => attachment.type === "image"),
      (attachment) => resolveAttachment(input, attachment),
      { concurrency: 1 },
    );

    const session = yield* requireSession(input.threadId);
    const reasoningEffort =
      input.modelSelection?.instanceId === boundInstanceId
        ? getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort")
        : undefined;
    const serviceTier =
      input.modelSelection?.instanceId === boundInstanceId
        ? getCodexServiceTierOptionValue(input.modelSelection)
        : undefined;
    return yield* session.runtime
      .sendTurn({
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.modelSelection?.instanceId === boundInstanceId
          ? { model: input.modelSelection.model }
          : {}),
        ...(reasoningEffort
          ? {
              effort: reasoningEffort as EffectCodexSchema.V2TurnStartParams__ReasoningEffort,
            }
          : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
        ...(codexAttachments.length > 0 ? { attachments: codexAttachments } : {}),
      })
      .pipe(Effect.mapError((cause) => mapCodexRuntimeError(input.threadId, "turn/start", cause)));
  });

  const mcpRuntime = makeCodexMcpRuntime({
    boundInstanceId,
    requireSession: requireMcpRuntimeSession,
    mapRuntimeError: mapCodexRuntimeError,
    ...(options?.resolveMcpServers ? { resolveMcpServers: options.resolveMcpServers } : {}),
  });
  const forkSession: CodexAdapterShape["forkSession"] = Effect.fn("forkSession")(function* (
    input: ProviderNativeThreadForkInput,
  ) {
    const source = yield* requireSession(input.sourceThreadId);
    const forked = yield* source.runtime
      .forkThread({
        sourceProviderThreadId: input.sourceProviderThreadId,
        ...(input.lastProviderTurnId !== undefined
          ? { lastProviderTurnId: input.lastProviderTurnId }
          : {}),
      })
      .pipe(
        Effect.mapError((cause) =>
          mapCodexRuntimeError(input.sourceThreadId, "thread/fork", cause),
        ),
      );
    return yield* startSession({
      ...input.session,
      provider: PROVIDER,
      providerInstanceId: boundInstanceId,
      threadId: input.destinationThreadId,
      freshSession: false,
      resumeCursor: { threadId: forked.threadId },
    });
  });

  const compactThread: CodexAdapterShape["compactThread"] = (threadId, expectedRuntimeSessionId) =>
    Effect.gen(function* () {
      const current = sessionStore.get(threadId);
      if (
        expectedRuntimeSessionId !== undefined &&
        (!current || current.stopped || current.runtimeSessionId !== expectedRuntimeSessionId)
      ) {
        return;
      }
      const session = yield* requireSession(threadId);
      yield* session.runtime.compactThread;
    }).pipe(
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/compact/start", cause),
      ),
    );

  const interruptTurn: CodexAdapterShape["interruptTurn"] = (
    threadId,
    turnId,
    expectedRuntimeSessionId,
  ) =>
    Effect.gen(function* () {
      const current = sessionStore.get(threadId);
      if (
        expectedRuntimeSessionId !== undefined &&
        (!current || current.stopped || current.runtimeSessionId !== expectedRuntimeSessionId)
      ) {
        return;
      }
      const session = yield* requireSession(threadId);
      yield* session.runtime.interruptTurn(turnId);
    }).pipe(
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "turn/interrupt", cause),
      ),
    );

  const readThread: CodexAdapterShape["readThread"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.readThread),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/read", cause),
      ),
      Effect.map((snapshot) => ({
        threadId,
        turns: snapshot.turns,
      })),
    );

  const rollbackThread: CodexAdapterShape["rollbackThread"] = (threadId, numTurns) => {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        }),
      );
    }

    return requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.rollbackThread(numTurns)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "thread/rollback", cause),
      ),
      Effect.map((snapshot) => ({
        threadId,
        turns: snapshot.turns,
      })),
    );
  };

  const uploadFeedback: CodexAdapterShape["uploadFeedback"] = (input) =>
    requireSession(input.threadId).pipe(
      Effect.flatMap((session) => session.runtime.uploadFeedback(input.reason)),
      Effect.map(({ threadId }) => ({ feedbackId: threadId })),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(input.threadId, "feedback/upload", cause),
      ),
    );

  const respondToRequest: CodexAdapterShape["respondToRequest"] = (threadId, requestId, decision) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.respondToRequest(requestId, decision)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "item/requestApproval/decision", cause),
      ),
    );

  const respondToUserInput: CodexAdapterShape["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    requireSession(threadId).pipe(
      Effect.flatMap((session) => session.runtime.respondToUserInput(requestId, answers)),
      Effect.mapError((cause) =>
        cause._tag === "ProviderAdapterSessionNotFoundError"
          ? cause
          : mapCodexRuntimeError(threadId, "item/tool/requestUserInput", cause),
      ),
    );

  const writeNativeEvent = Effect.fnUntraced(function* (event: ProviderEvent) {
    if (!nativeEventLogger) {
      return;
    }
    yield* nativeEventLogger.write(event, event.threadId);
  });

  yield* Effect.acquireRelease(Effect.void, () =>
    stopAll().pipe(
      Effect.andThen(runtimeEventQueue.shutdown),
      Effect.andThen(managedNativeEventLogger?.close() ?? Effect.void),
      Effect.ignore,
    ),
  );

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "in-session",
      mcp: "nativeConfig",
      nativeThreadFork: true,
      manualCompaction: true,
    },
    mcpRuntime,
    startSession,
    forkSession,
    sendTurn,
    compactThread,
    interruptTurn,
    forceStopSession,
    readThread,
    rollbackThread,
    uploadFeedback,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
    get streamEvents() {
      return runtimeEventQueue.stream;
    },
  } satisfies CodexAdapterShape;
});

// NOTE: the old `CodexAdapterLive` / `makeCodexAdapterLive` singleton Layer
// exports have been removed as part of the per-instance-driver refactor.
// `makeCodexAdapter(codexConfig, options?)` is now invoked directly by
// `CodexDriver.create()` for each configured instance; downstream consumers
// (server bootstrap, integration harness, this module's tests) will be
// migrated to the registry in a follow-up pass.
