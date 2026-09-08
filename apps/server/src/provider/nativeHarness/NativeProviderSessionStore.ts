import type { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ProviderAdapterRequestError } from "../Errors.ts";
import type { NativeHarnessHistoryFiles } from "./NativeHarnessHistory.ts";
import type { NativeProviderSessionContext } from "./NativeProviderSessionContext.ts";
import type { NativeProviderHistoryStrategy } from "./NativeProviderTypes.ts";

export function safeNativeProviderPathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/giu, "_");
}

function encodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function makeNativeProviderSessionStore<HistoryItem, SessionState>(input: {
  readonly provider: ProviderDriverKind;
  readonly history: NativeProviderHistoryStrategy<HistoryItem>;
  readonly historyFiles: NativeHarnessHistoryFiles;
  readonly sessions: Map<ThreadId, NativeProviderSessionContext<HistoryItem, SessionState>>;
  readonly maxIdleWorkingSets: number | undefined;
  readonly onWorkingSetEvicted: ((threadId: ThreadId) => void) | undefined;
}) {
  let workingSetSequence = 0;

  const persistSession = Effect.fn("NativeProviderSessionStore.persistSession")(function* (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
  ) {
    const contents = yield* Effect.try({
      try: () =>
        input.history.encode({
          sessionId: context.sessionId,
          history: context.history,
          turns: context.turns,
          totalProcessedTokens: context.totalProcessedTokens,
        }),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: input.provider,
          method: "session/persist",
          detail: `Failed to encode ${input.provider} session '${context.sessionId}'.`,
          cause,
        }),
    });
    yield* input.historyFiles.write(context.sessionId, contents).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: input.provider,
            method: "session/persist",
            detail: `Failed to persist ${input.provider} session '${context.sessionId}'.`,
            cause,
          }),
      ),
    );
  });

  const loadPersistedSession = Effect.fn("NativeProviderSessionStore.loadPersistedSession")(
    function* (sessionId: string) {
      const encoded = yield* input.historyFiles.read(sessionId).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: input.provider,
              method: "session/resume",
              detail: `Failed to read ${input.provider} session '${sessionId}'.`,
              cause,
            }),
        ),
      );
      if (encoded === undefined) return undefined;
      return yield* input.history.decode(encoded, sessionId);
    },
  );

  const evictIdleWorkingSets = (protectedThreadId: ThreadId) =>
    Effect.sync(() => {
      if (input.maxIdleWorkingSets === undefined) return;
      const loaded = Array.from(input.sessions.values()).filter(
        (context) =>
          context.workingSetLoaded && (context.history.length > 0 || context.turns.length > 0),
      );
      let excess = loaded.length - input.maxIdleWorkingSets;
      if (excess <= 0) return;
      const candidates = loaded
        .filter(
          (context) => context.threadId !== protectedThreadId && context.activeTurnId === undefined,
        )
        .toSorted((left, right) => left.lastWorkingSetUse - right.lastWorkingSetUse);
      for (const context of candidates) {
        if (excess <= 0) break;
        context.history.splice(0);
        context.turns.splice(0);
        context.workingSetLoaded = false;
        input.onWorkingSetEvicted?.(context.threadId);
        excess -= 1;
      }
    });

  const touchWorkingSet = Effect.fn("NativeProviderSessionStore.touchWorkingSet")(function* (
    context: NativeProviderSessionContext<HistoryItem, SessionState>,
  ) {
    if (!context.workingSetLoaded) {
      const persisted = yield* loadPersistedSession(context.sessionId);
      if (!persisted) {
        return yield* new ProviderAdapterRequestError({
          provider: input.provider,
          method: "session/load-working-set",
          detail: `${input.provider} session '${context.sessionId}' no longer has persisted history.`,
        });
      }
      context.history.push(...persisted.history);
      context.turns.push(...persisted.turns);
      context.totalProcessedTokens = persisted.totalProcessedTokens;
      context.workingSetLoaded = true;
    }
    context.lastWorkingSetUse = ++workingSetSequence;
    yield* evictIdleWorkingSets(context.threadId);
  });

  return {
    persistSession,
    loadPersistedSession,
    evictIdleWorkingSets,
    touchWorkingSet,
    nextWorkingSetUse: () => ++workingSetSequence,
    historyBytes: (history: ReadonlyArray<HistoryItem>) =>
      input.history.estimateBytes?.(history) ?? encodedBytes(history),
  };
}

export type NativeProviderSessionStore<HistoryItem, SessionState> = ReturnType<
  typeof makeNativeProviderSessionStore<HistoryItem, SessionState>
>;
