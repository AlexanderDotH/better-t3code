import {
  ProviderDriverKind,
  type McpServerDefinition,
  type ProviderInstanceId,
  type RuntimeSessionId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";

import * as ResourceProtection from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ProviderAdapterProcessError, ProviderAdapterSessionNotFoundError } from "../Errors.ts";
import type { CodexAdapterShape } from "../Services/CodexAdapter.ts";
import type { CodexMcpStartupObservation } from "./CodexMcpRuntimeView.ts";
import type { CodexSessionRuntimeShape } from "./CodexSessionRuntime.ts";

const PROVIDER = ProviderDriverKind.make("codex");

export interface CodexAdapterSessionContext {
  readonly threadId: ThreadId;
  readonly runtimeSessionId: RuntimeSessionId;
  readonly cwd: string;
  readonly scope: Scope.Closeable;
  readonly runtime: CodexSessionRuntimeShape;
  readonly eventFiber: Fiber.Fiber<void, never>;
  managedMcpServers: ReadonlyMap<string, McpServerDefinition>;
  readonly mcpStartupStatuses: Map<string, CodexMcpStartupObservation>;
  readonly builtInMcpExpected: boolean;
  stopped: boolean;
}

export interface CodexAdapterSessionStoreDependencies {
  readonly boundInstanceId: ProviderInstanceId;
  readonly resourceGovernor?: ResourceProtection.SubagentResourceGovernor["Service"];
}

export function makeCodexAdapterSessionStore(dependencies: CodexAdapterSessionStoreDependencies) {
  const sessions = new Map<ThreadId, CodexAdapterSessionContext>();

  const requireSession = Effect.fn("CodexAdapterSession.require")(function* (threadId: ThreadId) {
    const session = sessions.get(threadId);
    if (!session || session.stopped) {
      return yield* new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      });
    }
    return session;
  });

  const requireMcpRuntimeSession = Effect.fn("CodexAdapterSession.requireMcpRuntime")(
    function* (input: {
      readonly providerInstanceId: ProviderInstanceId;
      readonly threadId: ThreadId;
      readonly runtimeSessionId: RuntimeSessionId;
    }) {
      const session = sessions.get(input.threadId);
      if (
        input.providerInstanceId !== dependencies.boundInstanceId ||
        !session ||
        session.stopped ||
        session.runtimeSessionId !== input.runtimeSessionId
      ) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: PROVIDER,
          threadId: input.threadId,
        });
      }
      return session;
    },
  );

  const stopInternal = Effect.fn("CodexAdapterSession.stopInternal")(function* (
    session: CodexAdapterSessionContext,
  ) {
    if (session.stopped) return;
    session.stopped = true;
    sessions.delete(session.threadId);
    if (dependencies.resourceGovernor) {
      yield* dependencies.resourceGovernor.cancelThread(session.threadId);
    }
    yield* session.runtime.close.pipe(Effect.ignore);
    yield* Scope.close(session.scope, Exit.void).pipe(Effect.ignore);
    yield* Fiber.interrupt(session.eventFiber).pipe(Effect.ignore);
  });

  const stopExisting = (threadId: ThreadId) => {
    const existing = sessions.get(threadId);
    return existing && !existing.stopped ? stopInternal(existing) : Effect.void;
  };

  const forceStopSession: CodexAdapterShape["forceStopSession"] = Effect.fn(
    "CodexAdapterSession.forceStop",
  )(function* (threadId, expectedRuntimeSessionId) {
    const session = sessions.get(threadId);
    if (!session || session.stopped || session.runtimeSessionId !== expectedRuntimeSessionId) {
      return { outcome: "terminated", mechanism: "already-stopped" };
    }

    session.stopped = true;
    sessions.delete(threadId);
    yield* session.runtime.forceClose.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId,
            detail: cause.message,
            cause,
          }),
      ),
      Effect.ensuring(
        Fiber.interrupt(session.eventFiber).pipe(
          Effect.ignore,
          Effect.andThen(Scope.close(session.scope, Exit.void).pipe(Effect.ignore)),
        ),
      ),
    );
    return { outcome: "terminated", mechanism: "process-tree" };
  });

  const stopSession: CodexAdapterShape["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const session = sessions.get(threadId);
      if (session) yield* stopInternal(session);
    });

  const listSessions: CodexAdapterShape["listSessions"] = () =>
    Effect.forEach(
      Array.from(sessions.values()).filter((session) => !session.stopped),
      (session) => session.runtime.getSession,
      { concurrency: 1 },
    );

  const hasSession: CodexAdapterShape["hasSession"] = (threadId) =>
    Effect.succeed(Boolean(sessions.get(threadId) && !sessions.get(threadId)?.stopped));

  const stopAll: CodexAdapterShape["stopAll"] = () =>
    Effect.forEach(Array.from(sessions.values()), stopInternal, {
      concurrency: 1,
      discard: true,
    }).pipe(Effect.asVoid);

  return {
    forceStopSession,
    get: (threadId: ThreadId) => sessions.get(threadId),
    hasSession,
    install: (session: CodexAdapterSessionContext) => sessions.set(session.threadId, session),
    listSessions,
    requireMcpRuntimeSession,
    requireSession,
    stopAll,
    stopExisting,
    stopSession,
  };
}

export type CodexAdapterSessionStore = ReturnType<typeof makeCodexAdapterSessionStore>;
