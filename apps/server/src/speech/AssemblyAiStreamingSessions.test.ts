import { describe, expect, it, vi } from "@effect/vitest";
import {
  DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
  ProjectId,
  SpeechStreamingSessionId,
  SpeechDictationError,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { AssemblyAiDictation } from "./AssemblyAiDictation.ts";
import * as Sessions from "./AssemblyAiStreamingSessions.ts";

class FakeSocket {
  readyState = 1;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly close = vi.fn(() => {
    this.readyState = 3;
  });
  readonly send = vi.fn((data: string | ArrayBuffer | Uint8Array) => {
    if (typeof data === "string")
      this.onmessage?.({ data: JSON.stringify({ type: "Termination" }) });
  });
  turn() {
    this.onmessage?.({
      data: JSON.stringify({
        type: "Turn",
        transcript: "Keep mount app.",
        end_of_turn: true,
        turn_order: 0,
      }),
    });
  }
}

const projectId = ProjectId.make("speech-project");
const makeFixture = Effect.fn("AssemblyAiStreamingSessions.testFixture")(function* (
  input: {
    readonly advancedMode?: boolean;
    readonly block?: boolean;
    readonly fail?: boolean;
    readonly legacyClient?: boolean;
  } = {},
) {
  const socket = new FakeSocket();
  const startedPass = yield* Deferred.make<void>();
  const process = vi.fn((request: Parameters<AssemblyAiDictation["Service"]["process"]>[0]) =>
    Effect.succeed({ text: request.transcript, references: [] }),
  );
  const requests: string[] = [];
  const sessions = yield* Sessions.make({
    createSessionId: () => "test-session",
    createSocket: () => {
      queueMicrotask(() => socket.onopen?.());
      return socket;
    },
  }).pipe(
    Effect.provideService(
      AssemblyAiDictation,
      AssemblyAiDictation.of({
        process,
        transcribeRecording: ({ model }) => {
          requests.push(model);
          const text = `Keep mountApp ${requests.length}.`;
          return Deferred.succeed(startedPass, undefined).pipe(
            Effect.andThen(
              input.block
                ? Effect.never
                : input.fail
                  ? Effect.fail(new SpeechDictationError({ reason: "Recognition unavailable" }))
                  : Effect.succeed(text),
            ),
          );
        },
        createStreamingConfiguration: () =>
          Effect.succeed({
            token: "test-token",
            websocketUrl: "wss://streaming.example.test/v3/ws",
            expiresInSeconds: 60,
            sampleRate: 16_000,
            encoding: "pcm_s16le",
            speechModel: "universal-3-5-pro",
            context: { source: "basic", prompt: "Coding dictation.", keyterms: ["mountApp"] },
            options: {
              ...DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS,
              advancedMode: input.advancedMode ?? true,
            },
          }),
        listModels: () => Effect.succeed([]),
        resolveWorkspace: () => Effect.succeed("/workspace"),
      }),
    ),
  );
  const session = yield* sessions.start({
    projectId,
    ...(input.legacyClient ? {} : { supportsAdvancedMode: true }),
  });
  socket.turn();
  yield* sessions.push({ ...session, audio: new Uint8Array([1, 2, 3, 4]) });
  return { sessions, session, socket, process, requests, startedPass };
});

describe("server-owned dictation sessions", () => {
  it.effect(
    "transcribes retained audio with two distinct models then processes the three passes once",
    () =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture();
        const result = yield* fixture.sessions.finish(fixture.session);
        expect(fixture.requests).toEqual(["universal-3-5-pro", "universal-3-6-pro"]);
        expect(fixture.process).toHaveBeenCalledOnce();
        expect(fixture.process).toHaveBeenCalledWith({
          projectId,
          transcript: "Keep mount app.",
          additionalTranscripts: ["Keep mountApp 1.", "Keep mountApp 2."],
        });
        expect(result.processed?.text).toBe("Keep mount app.");
        expect(fixture.socket.close).toHaveBeenCalledOnce();
        expect(yield* Effect.flip(fixture.sessions.finish(fixture.session))).toMatchObject({
          _tag: "SpeechStreamingProxyError",
        });
      }),
  );

  it.effect.each(["disabled", "legacy-client"] as const)(
    "keeps %s sessions on the single-pass path",
    (mode) =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          advancedMode: mode !== "disabled",
          legacyClient: mode === "legacy-client",
        });
        expect(yield* fixture.sessions.finish(fixture.session)).toEqual({
          transcript: "Keep mount app.",
        });
        expect(fixture.requests).toEqual([]);
        expect(fixture.process).not.toHaveBeenCalled();
      }),
  );

  it.effect("cancels pending extra passes and releases the session without processing", () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture({ block: true });
      const finishing = yield* fixture.sessions.finish(fixture.session).pipe(Effect.forkChild);
      yield* Deferred.await(fixture.startedPass);
      yield* fixture.sessions.cancel(fixture.session);
      expect(yield* Fiber.join(finishing).pipe(Effect.flip)).toMatchObject({
        _tag: "SpeechStreamingProxyError",
      });
      expect(fixture.process).not.toHaveBeenCalled();
      expect(
        yield* fixture.sessions
          .push({ ...fixture.session, audio: new Uint8Array([1, 2]) })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "SpeechStreamingProxyError" });
    }),
  );

  it.effect.each(["timeout", "failure"] as const)(
    "falls back to the live pass on extra transcription %s",
    (failure) =>
      Effect.gen(function* () {
        const fixture = yield* makeFixture({
          block: failure === "timeout",
          fail: failure === "failure",
        });
        const finishing = yield* fixture.sessions.finish(fixture.session).pipe(Effect.forkChild);
        yield* Deferred.await(fixture.startedPass);
        if (failure === "timeout") yield* TestClock.adjust("30 seconds");
        const result = yield* Fiber.join(finishing);
        expect(fixture.process).toHaveBeenCalledExactlyOnceWith({
          projectId,
          transcript: "Keep mount app.",
        });
        expect(result.processed?.warning).toContain("live transcript");
      }),
  );

  it.effect.each(["expiry", "disconnect"] as const)(
    "releases abandoned recordings on %s and refuses further audio",
    (reason) =>
      Effect.gen(function* () {
        const fixture =
          reason === "disconnect" ? yield* Effect.scoped(makeFixture()) : yield* makeFixture();
        if (reason === "expiry") yield* TestClock.adjust("7 minutes");
        expect(fixture.socket.close).toHaveBeenCalledOnce();
        expect(
          yield* fixture.sessions
            .finish({ sessionId: SpeechStreamingSessionId.make("test-session") })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "SpeechStreamingProxyError" });
      }),
  );
});
