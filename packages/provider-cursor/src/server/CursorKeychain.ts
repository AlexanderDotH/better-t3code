// Background credential reads must never ask for access on the host display.
import { readMacKeychainPassword } from "./macKeychainPassword.ts";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CACHE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT = Duration.seconds(5);

export class CursorKeychainTimeoutError extends Schema.TaggedError<CursorKeychainTimeoutError>()(
  "CursorKeychainTimeoutError",
  {},
) {
  override get message(): string {
    return "Timed out reading Cursor credentials.";
  }
}

export const isCursorKeychainTimeoutError = Schema.is(CursorKeychainTimeoutError);

export class CursorKeychainReadError extends Schema.TaggedError<CursorKeychainReadError>()(
  "CursorKeychainReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Cursor Keychain credentials could not be read.";
  }
}

export class CursorKeychain extends Context.Service<
  CursorKeychain,
  {
    readonly accessToken: Effect.Effect<
      string | null,
      CursorKeychainTimeoutError | CursorKeychainReadError
    >;
  }
>()("@t3tools/provider-cursor/server/CursorKeychain") {}

const readKeychainEntry = Effect.tryPromise({
  try: () => readMacKeychainPassword("cursor-access-token", "cursor-user"),
  catch: (cause) => new CursorKeychainReadError({ cause }),
});

const make = (
  read: Effect.Effect<string | null, CursorKeychainReadError> = readKeychainEntry,
  timeout: Duration.Input = DEFAULT_TIMEOUT,
): CursorKeychain["Service"] => {
  let cached: { readonly token: string | null; readonly untilMs: number } | null = null;
  let pending: Deferred.Deferred<string | null, CursorKeychainReadError> | null = null;

  const startRead = Effect.uninterruptible(
    Effect.gen(function* () {
      if (pending !== null) return pending;
      const done = Deferred.makeUnsafe<string | null, CursorKeychainReadError>();
      pending = done;
      yield* read.pipe(
        Effect.tap((token) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((nowMs) => {
              cached = { token, untilMs: nowMs + CACHE_MS };
            }),
          ),
        ),
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            pending = null;
            return Deferred.done(done, exit);
          }),
        ),
        Effect.forkDetach,
      );
      return done;
    }),
  );

  const accessToken = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    if (cached !== null && cached.untilMs > nowMs) return cached.token;
    const done = yield* startRead;
    const token = yield* Deferred.await(done).pipe(Effect.timeoutOption(timeout));
    if (Option.isNone(token)) return yield* new CursorKeychainTimeoutError();
    return token.value;
  });

  return CursorKeychain.of({ accessToken });
};

export const layer = Layer.sync(CursorKeychain, () => make());
