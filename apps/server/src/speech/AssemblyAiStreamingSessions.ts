import {
  SpeechStreamingProxyError,
  SpeechStreamingSessionId,
  type AssemblyAiStreamingTokenResult,
  type SpeechStreamingAudioInput,
  type SpeechStreamingSessionInput,
  type SpeechStreamingStartInput,
  type SpeechStreamingSessionStartResult,
  type SpeechStreamingTranscriptResult,
  type SpeechDictationError,
  type ProjectSpeechProfileError,
  type AssemblyAiStreamingTokenError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { AssemblyAiDictation } from "./AssemblyAiDictation.ts";
import { createAssemblyAiStreamingProxy } from "./AssemblyAiStreamingProxy.ts";

// Sync STT accepts both pinned models; separate requests avoid the async API's fallback-list semantics.
const ADDITIONAL_MODELS = ["universal-3-5-pro", "universal-3-6-pro"] as const;
const MAX_SESSIONS = 4;
const SESSION_LIFETIME = "7 minutes";

interface Session {
  readonly input: SpeechStreamingStartInput;
  readonly config: AssemblyAiStreamingTokenResult;
  readonly cancelled: Deferred.Deferred<void>;
  readonly expiration: Fiber.Fiber<void>;
  finishing: boolean;
}

class AssemblyAiStreamingSessions extends Context.Service<
  AssemblyAiStreamingSessions,
  {
    readonly start: (
      input: SpeechStreamingStartInput,
    ) => Effect.Effect<
      SpeechStreamingSessionStartResult,
      | SpeechStreamingProxyError
      | SpeechDictationError
      | ProjectSpeechProfileError
      | AssemblyAiStreamingTokenError
    >;
    readonly push: (
      input: SpeechStreamingAudioInput,
    ) => Effect.Effect<SpeechStreamingTranscriptResult, SpeechStreamingProxyError>;
    readonly finish: (
      input: SpeechStreamingSessionInput,
    ) => Effect.Effect<SpeechStreamingTranscriptResult, SpeechStreamingProxyError>;
    readonly cancel: (input: SpeechStreamingSessionInput) => Effect.Effect<void>;
  }
>()("t3/speech/AssemblyAiStreamingSessions") {}

export const make = Effect.fn("AssemblyAiStreamingSessions.make")(function* (
  options: Parameters<typeof createAssemblyAiStreamingProxy>[0] = {},
) {
  const dictation = yield* AssemblyAiDictation;
  const scope = yield* Scope.Scope;
  const proxy = createAssemblyAiStreamingProxy(options);
  const sessions = new Map<SpeechStreamingSessionId, Session>();

  const release = Effect.fn("AssemblyAiStreamingSessions.release")(function* (
    sessionId: SpeechStreamingSessionId,
  ) {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    proxy.cancel(sessionId);
    yield* Deferred.succeed(session.cancelled, undefined);
    yield* Fiber.interrupt(session.expiration);
  });
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...sessions.keys()], release, { discard: true }).pipe(
      Effect.andThen(Effect.sync(() => proxy.dispose())),
    ),
  );

  const start = Effect.fn("AssemblyAiStreamingSessions.start")(function* (
    input: SpeechStreamingStartInput,
  ) {
    if (sessions.size >= MAX_SESSIONS)
      return yield* new SpeechStreamingProxyError({ reason: "Too many active voice sessions." });
    const configured = yield* dictation.createStreamingConfiguration(input);
    const config =
      configured.options && input.supportsAdvancedMode !== true
        ? { ...configured, options: { ...configured.options, advancedMode: false } }
        : configured;
    const started = yield* Effect.tryPromise({
      try: (signal) => proxy.start(config, signal),
      catch: () => new SpeechStreamingProxyError({ reason: "Could not start voice streaming." }),
    });
    const sessionId = SpeechStreamingSessionId.make(started.sessionId);
    const cancelled = yield* Deferred.make<void>();
    const expiration = yield* Effect.sleep(SESSION_LIFETIME).pipe(
      Effect.andThen(() => {
        sessions.delete(sessionId);
        proxy.cancel(sessionId);
        return Deferred.succeed(cancelled, undefined);
      }),
      Effect.asVoid,
      Effect.forkIn(scope),
    );
    sessions.set(sessionId, { input, config, cancelled, expiration, finishing: false });
    return { sessionId, advancedMode: config.options?.advancedMode === true };
  });

  // The enclosing session spans already cover each PCM chunk.
  const push = Effect.fnUntraced(function* (input: SpeechStreamingAudioInput) {
    const session = sessions.get(input.sessionId);
    if (!session || session.finishing)
      return yield* new SpeechStreamingProxyError({
        reason: "Voice streaming session is not active.",
      });
    return yield* Effect.tryPromise({
      try: () => proxy.push(input),
      catch: (cause) =>
        new SpeechStreamingProxyError({
          reason: cause instanceof Error ? cause.message : "Could not stream microphone audio.",
        }),
    }).pipe(Effect.onError(() => release(input.sessionId)));
  });

  const finish = Effect.fn("AssemblyAiStreamingSessions.finish")(function* ({
    sessionId,
  }: SpeechStreamingSessionInput) {
    const session = sessions.get(sessionId);
    if (!session || session.finishing)
      return yield* new SpeechStreamingProxyError({
        reason: "Voice streaming session is not active.",
      });
    session.finishing = true;
    return yield* Effect.gen(function* () {
      const finished = yield* Effect.tryPromise({
        try: () => proxy.finish(sessionId),
        catch: () => new SpeechStreamingProxyError({ reason: "Could not finish voice streaming." }),
      });
      if (!finished.audio || !finished.transcript.trim())
        return { transcript: finished.transcript };
      const audio = finished.audio;
      return yield* Effect.gen(function* () {
        const alternatives = yield* Effect.forEach(
          ADDITIONAL_MODELS,
          (model) => dictation.transcribeRecording({ model, audio, config: session.config }),
          { concurrency: 2 },
        ).pipe(Effect.timeout("30 seconds"), Effect.option);
        const first = Option.isSome(alternatives) ? alternatives.value[0] : undefined;
        const second = Option.isSome(alternatives) ? alternatives.value[1] : undefined;
        const processed = yield* dictation.process({
          projectId: session.input.projectId,
          ...(session.input.threadId ? { threadId: session.input.threadId } : {}),
          transcript: finished.transcript,
          ...(first && second ? { additionalTranscripts: [first, second] as const } : {}),
        });
        return {
          transcript: finished.transcript,
          processed:
            first && second
              ? processed
              : {
                  ...processed,
                  warning: [
                    "Advanced transcription failed or timed out. The live transcript was used for cleanup.",
                    processed.warning,
                  ]
                    .filter(Boolean)
                    .join(" "),
                },
        };
      }).pipe(Effect.ensuring(Effect.sync(() => audio.fill(0))));
    }).pipe(
      Effect.raceFirst(
        Deferred.await(session.cancelled).pipe(
          Effect.andThen(() =>
            Effect.fail(
              new SpeechStreamingProxyError({ reason: "Voice streaming session was cancelled." }),
            ),
          ),
        ),
      ),
      Effect.ensuring(release(sessionId)),
    );
  });

  const cancel = Effect.fn("AssemblyAiStreamingSessions.cancel")(
    ({ sessionId }: SpeechStreamingSessionInput) => release(sessionId),
  );
  return AssemblyAiStreamingSessions.of({ start, push, finish, cancel });
});
