import { ServerProviderUsageLimits, type ServerProvider } from "@t3tools/contracts";
import { resolveUsageLimitsAfterProbe } from "@t3tools/provider-core/server/usageLimits";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { supportsDailyUsagePace } from "@t3tools/shared/usageLimits";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Hex from "effect/encoding/Hex";

import * as ServerConfig from "../config.ts";

export class UsagePaceHistory extends Context.Service<
  UsagePaceHistory,
  {
    readonly record: (input: {
      readonly key: string;
      readonly limits: ServerProviderUsageLimits;
    }) => Effect.Effect<ServerProviderUsageLimits>;
  }
>()("t3/provider/UsagePaceHistory") {}

const decodeHistory = Schema.decodeUnknownEffect(Schema.fromJsonString(ServerProviderUsageLimits));
const encodeHistory = Schema.encodeSync(Schema.fromJsonString(ServerProviderUsageLimits));
const isObservedWindow = (window: ServerProviderUsageLimits["windows"][number]) =>
  window.usageHistorySource !== "codex" && supportsDailyUsagePace(window);

export function providerUsagePaceHistoryKey(
  provider: Pick<ServerProvider, "driver" | "instanceId" | "auth" | "usageLimits">,
): string | undefined {
  if (
    provider.driver === "codex" ||
    provider.auth.status === "unauthenticated" ||
    (provider.auth.status !== "authenticated" && !provider.usageLimits?.credentialFingerprint)
  )
    return undefined;
  return JSON.stringify([
    "provider",
    provider.driver,
    provider.usageLimits?.credentialFingerprint ??
      provider.auth.email?.trim().toLowerCase() ??
      provider.instanceId,
    provider.auth.workspaceId ?? null,
  ]);
}

export const makeUsagePaceHistory = Effect.fn("UsagePaceHistory.make")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  const cache = new Map<string, ServerProviderUsageLimits | undefined>();

  const record = Effect.fn("UsagePaceHistory.record")(function* (input: {
    readonly key: string;
    readonly limits: ServerProviderUsageLimits;
  }) {
    if (input.limits.unavailable || !input.limits.windows.some(isObservedWindow))
      return input.limits;
    const digest = yield* crypto
      .digest("SHA-256", new TextEncoder().encode(input.key))
      .pipe(Effect.orDie);
    const filePath = path.join(directory, `${Hex.encode(digest)}.json`);
    if (!cache.has(input.key)) {
      const previous = yield* fs.readFileString(filePath).pipe(
        Effect.flatMap(decodeHistory),
        Effect.tapError((cause) =>
          cause._tag === "PlatformError" && cause.reason._tag === "NotFound"
            ? Effect.void
            : Effect.logWarning("Could not read usage pace history", { cause }),
        ),
        Effect.option,
        Effect.map(Option.getOrUndefined),
      );
      cache.set(input.key, previous);
    }
    const previous = cache.get(input.key);
    const next =
      resolveUsageLimitsAfterProbe({ published: previous, probed: input.limits }) ?? input.limits;
    const saved = { checkedAt: next.checkedAt, windows: next.windows.filter(isObservedWindow) };
    if (!Equal.equals(previous?.windows, saved.windows)) {
      yield* writeFileStringAtomically({ filePath, contents: encodeHistory(saved) }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.tap(() => Effect.sync(() => cache.set(input.key, saved))),
        Effect.catch((cause) => Effect.logWarning("Could not save usage pace history", { cause })),
      );
    }
    return next;
  }, lock.withPermits(1));

  return UsagePaceHistory.of({ record });
});

export const layer = Layer.effect(
  UsagePaceHistory,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return yield* makeUsagePaceHistory(path.join(config.stateDir, "usage-pace-history"));
  }),
);
