/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import * as NodeCrypto from "node:crypto";

import {
  ModelSelection,
  NonNegativeInt,
  ThreadId,
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  RuntimeSessionId,
  resolveProviderSessionPurpose,
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  increment,
  providerMetricAttributes,
  providerRuntimeEventsTotal,
  providerSessionsTotal,
  providerTurnDuration,
  providerTurnsTotal,
  providerTurnMetricAttributes,
  withMetrics,
} from "../../observability/Metrics.ts";
import { type ProviderAdapterError, ProviderValidationError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../Services/ProviderAdapterRegistry.ts";
import * as ProviderService from "../Services/ProviderService.ts";
import * as ProviderSessionDirectory from "../Services/ProviderSessionDirectory.ts";
import { type EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import * as ProviderEventLoggers from "./ProviderEventLoggers.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { McpRuntimeRegistry } from "../../mcp/McpRuntimeRegistry.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
const isModelSelection = Schema.is(ModelSelection);

/**
 * Hook for tests that want to override the canonical event logger pulled
 * from `ProviderEventLoggers`. Production wiring leaves this undefined and
 * reads the logger off the tag.
 */
export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogger?: EventNdjsonLogger;
}

type ProviderServiceMethod<Name extends keyof ProviderService.ProviderService["Service"]> =
  ProviderService.ProviderService["Service"][Name];

interface ProviderRuntimeLease {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  readonly startFiber?: Fiber.Fiber<ProviderSession, ProviderAdapterError>;
  readonly forceStopping?: boolean;
  readonly persistence: "durable" | "transient";
}

interface ProviderTransientBinding {
  readonly runtimeSessionId: RuntimeSessionId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
}

type RuntimeLeaseInstallResult =
  | {
      readonly _tag: "Installed";
      readonly previous: ProviderRuntimeLease | undefined;
    }
  | {
      readonly _tag: "BlockedByCleanup";
    };

const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
});

function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown,
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) => {
  const decodeProviderRequestInput = Schema.decodeUnknownEffect(input.schema);
  return decodeProviderRequestInput(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );
};

function toRuntimeStatus(session: ProviderSession): "starting" | "running" | "stopped" | "error" {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    case "running":
    default:
      return "running";
  }
}

function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
  },
): Record<string, unknown> {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    runtimeSessionId: session.runtimeSessionId ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
  };
}

function readPersistedModelSelection(
  runtimePayload: ProviderSessionDirectory.ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : undefined;
  return isModelSelection(raw) ? raw : undefined;
}

function readPersistedCwd(
  runtimePayload: ProviderSessionDirectory.ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const dieOnMissingBindingInstanceId = (
  operation: string,
  payload: {
    readonly providerInstanceId?: ProviderInstanceId | undefined;
    readonly provider?: ProviderDriverKind | undefined;
  },
): ProviderInstanceId => {
  if (payload.providerInstanceId !== undefined) {
    return payload.providerInstanceId;
  }
  throw new Error(
    payload.provider
      ? `${operation}: provider instance id is required for provider '${payload.provider}'.`
      : `${operation}: provider instance id is required.`,
  );
};

const correlateRuntimeEventWithInstance = (
  source: {
    readonly instanceId: ProviderInstanceId;
    readonly provider: ProviderDriverKind;
  },
  event: ProviderRuntimeEvent,
): ProviderRuntimeEvent => {
  if (event.provider !== source.provider) {
    throw new Error(
      `ProviderService.streamEvents: provider instance '${source.instanceId}' is backed by driver '${source.provider}' but emitted driver '${event.provider}'.`,
    );
  }
  if (event.providerInstanceId !== undefined && event.providerInstanceId !== source.instanceId) {
    throw new Error(
      `ProviderService.streamEvents: provider instance '${source.instanceId}' emitted event for instance '${event.providerInstanceId}'.`,
    );
  }
  return { ...event, providerInstanceId: source.instanceId };
};

const makeProviderService = Effect.fn("makeProviderService")(function* (
  options?: ProviderServiceLiveOptions,
) {
  const eventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
  // Options-provided logger wins (test overrides); otherwise we take whatever
  // the `ProviderEventLoggers` tag exposes — `undefined` means "no canonical
  // log writer is attached", which downstream code already handles as a
  // no-op.
  const canonicalEventLogger = options?.canonicalEventLogger ?? eventLoggers.canonical;

  const registry = yield* ProviderAdapterRegistry.ProviderAdapterRegistry;
  const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
  const mcpRuntimeRegistry = Option.getOrUndefined(yield* Effect.serviceOption(McpRuntimeRegistry));
  const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const serviceScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const runtimeLeases = yield* Ref.make(new Map<ThreadId, ProviderRuntimeLease>());
  const transientBindings = yield* Ref.make(new Map<ThreadId, ProviderTransientBinding>());
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const nextRuntimeSessionId = Effect.sync(() => RuntimeSessionId.make(NodeCrypto.randomUUID()));
  const registerMcpRuntimeSession = (session: ProviderSession) =>
    mcpRuntimeRegistry?.registerSession(session) ?? Effect.void;
  const endMcpRuntimeSession = (input: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly threadId: ThreadId;
    readonly runtimeSessionId: RuntimeSessionId;
  }) => mcpRuntimeRegistry?.endSession(input) ?? Effect.void;

  const installRuntimeLease = (input: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
    readonly runtimeSessionId: RuntimeSessionId;
    readonly startFiber?: Fiber.Fiber<ProviderSession, ProviderAdapterError>;
    readonly persistence?: ProviderRuntimeLease["persistence"];
  }) =>
    Ref.modify(runtimeLeases, (current) => {
      const previous = current.get(input.threadId);
      if (previous?.forceStopping === true) {
        return [{ _tag: "BlockedByCleanup" } as RuntimeLeaseInstallResult, current] as const;
      }
      const next = new Map(current);
      next.set(input.threadId, {
        runtimeSessionId: input.runtimeSessionId,
        providerInstanceId: input.providerInstanceId,
        adapter: input.adapter,
        persistence: input.persistence ?? "durable",
        ...(input.startFiber !== undefined ? { startFiber: input.startFiber } : {}),
      });
      return [
        {
          _tag: "Installed",
          previous,
        } as RuntimeLeaseInstallResult,
        next,
      ] as const;
    });

  const claimRuntimeLeaseForCleanup = (input: {
    readonly threadId: ThreadId;
    readonly expectedRuntimeSessionId: RuntimeSessionId;
    readonly expectedProviderInstanceId?: ProviderInstanceId;
  }) =>
    Ref.modify(runtimeLeases, (current) => {
      const existing = current.get(input.threadId);
      if (
        existing?.runtimeSessionId !== input.expectedRuntimeSessionId ||
        (input.expectedProviderInstanceId !== undefined &&
          existing.providerInstanceId !== input.expectedProviderInstanceId) ||
        existing.forceStopping === true
      ) {
        return [undefined, current] as const;
      }
      const next = new Map(current);
      next.set(input.threadId, {
        ...existing,
        forceStopping: true,
      });
      return [existing, next] as const;
    });

  const completeRuntimeLeaseCleanup = (input: {
    readonly threadId: ThreadId;
    readonly expectedRuntimeSessionId: RuntimeSessionId;
    readonly replacement?: ProviderRuntimeLease;
  }) =>
    Ref.modify(runtimeLeases, (current) => {
      const existing = current.get(input.threadId);
      if (
        existing?.runtimeSessionId !== input.expectedRuntimeSessionId ||
        existing.forceStopping !== true
      ) {
        return [false, current] as const;
      }
      const next = new Map(current);
      if (input.replacement !== undefined) {
        next.set(input.threadId, input.replacement);
      } else {
        next.delete(input.threadId);
      }
      return [true, next] as const;
    });

  const clearRuntimeLease = (threadId: ThreadId, expectedRuntimeSessionId?: RuntimeSessionId) =>
    Ref.modify(runtimeLeases, (current) => {
      const existing = current.get(threadId);
      if (
        !existing ||
        existing.forceStopping === true ||
        (expectedRuntimeSessionId !== undefined &&
          existing.runtimeSessionId !== expectedRuntimeSessionId)
      ) {
        return [false, current] as const;
      }
      const next = new Map(current);
      next.delete(threadId);
      return [true, next] as const;
    });

  const installTransientBinding = (input: {
    readonly threadId: ThreadId;
    readonly runtimeSessionId: RuntimeSessionId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  }) =>
    Ref.modify(transientBindings, (current) => {
      if (current.has(input.threadId)) {
        return [false, current] as const;
      }
      const next = new Map(current);
      next.set(input.threadId, input);
      return [true, next] as const;
    });

  const clearTransientBinding = (input: {
    readonly threadId: ThreadId;
    readonly runtimeSessionId: RuntimeSessionId;
    readonly providerInstanceId?: ProviderInstanceId;
  }) =>
    Ref.modify(transientBindings, (current) => {
      const binding = current.get(input.threadId);
      if (
        binding?.runtimeSessionId !== input.runtimeSessionId ||
        (input.providerInstanceId !== undefined &&
          binding.providerInstanceId !== input.providerInstanceId)
      ) {
        return [false, current] as const;
      }
      const next = new Map(current);
      next.delete(input.threadId);
      return [true, next] as const;
    });

  const ensureRuntimeLease = Effect.fn("ensureRuntimeLease")(function* (input: {
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  }) {
    const current = (yield* Ref.get(runtimeLeases)).get(input.threadId);
    if (
      current?.providerInstanceId === input.providerInstanceId &&
      current.adapter === input.adapter &&
      current.persistence === "durable" &&
      current.forceStopping !== true
    ) {
      return current.runtimeSessionId;
    }
    if (current?.forceStopping === true) {
      return yield* toValidationError(
        "ProviderService.ensureRuntimeLease",
        `Cannot adopt thread '${input.threadId}' while runtime '${current.runtimeSessionId}' is being force-stopped.`,
      );
    }
    const runtimeSessionId = yield* nextRuntimeSessionId;
    const installed = yield* installRuntimeLease({
      ...input,
      runtimeSessionId,
    });
    if (installed._tag === "BlockedByCleanup") {
      return yield* toValidationError(
        "ProviderService.ensureRuntimeLease",
        `Cannot adopt thread '${input.threadId}' while its previous runtime is being cleaned up.`,
      );
    }
    return runtimeSessionId;
  });

  const prepareMcpSession = (
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
    provider: ProviderDriverKind,
  ) =>
    McpSessionRegistry.issueActiveMcpCredential({ threadId, providerInstanceId, provider }).pipe(
      Effect.tap((credential) =>
        credential
          ? Effect.sync(() => McpProviderSession.setMcpProviderSession(credential.config))
          : Effect.void,
      ),
    );
  const clearMcpSession = (threadId: ThreadId) =>
    McpSessionRegistry.revokeActiveMcpThread(threadId).pipe(
      Effect.tap(() => Effect.sync(() => McpProviderSession.clearMcpProviderSession(threadId))),
    );

  const cleanupExactRuntimeLeaseMcpSession = Effect.fn("cleanupExactRuntimeLeaseMcpSession")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly expectedRuntimeSessionId: RuntimeSessionId;
      readonly replacement?: ProviderRuntimeLease;
    }) {
      const claimed = yield* claimRuntimeLeaseForCleanup(input);
      if (claimed === undefined) {
        return false;
      }
      yield* endMcpRuntimeSession({
        providerInstanceId: claimed.providerInstanceId,
        threadId: input.threadId,
        runtimeSessionId: input.expectedRuntimeSessionId,
      });
      yield* clearMcpSession(input.threadId).pipe(
        Effect.ensuring(
          completeRuntimeLeaseCleanup({
            threadId: input.threadId,
            expectedRuntimeSessionId: input.expectedRuntimeSessionId,
            ...(input.replacement !== undefined ? { replacement: input.replacement } : {}),
          }),
        ),
      );
      return true;
    },
  );

  const startAdapterSessionWithLease = Effect.fn("startAdapterSessionWithLease")(function* (input: {
    readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
    readonly providerInstanceId: ProviderInstanceId;
    readonly runtimeSessionId?: RuntimeSessionId;
    readonly persistence?: ProviderRuntimeLease["persistence"];
    readonly mountMcp?: boolean;
    readonly sessionInput: Parameters<
      ProviderAdapterShape<ProviderAdapterError>["startSession"]
    >[0];
  }) {
    const runtimeSessionId = input.runtimeSessionId ?? (yield* nextRuntimeSessionId);
    const sessionInput = {
      ...input.sessionInput,
      runtimeSessionId,
    };
    const startGate = yield* Deferred.make<void>();
    const startFiber = yield* Deferred.await(startGate).pipe(
      Effect.andThen(input.adapter.startSession(sessionInput)),
      Effect.forkIn(serviceScope),
    );
    const installed = yield* installRuntimeLease({
      threadId: input.sessionInput.threadId,
      providerInstanceId: input.providerInstanceId,
      adapter: input.adapter,
      runtimeSessionId,
      startFiber,
      ...(input.persistence !== undefined ? { persistence: input.persistence } : {}),
    });
    if (installed._tag === "BlockedByCleanup") {
      yield* Fiber.interrupt(startFiber).pipe(Effect.ignore);
      return yield* toValidationError(
        "ProviderService.startSession",
        `Cannot start thread '${input.sessionInput.threadId}' while its previous runtime is being cleaned up.`,
      );
    }
    const prepareSession =
      input.mountMcp === false
        ? Effect.void
        : prepareMcpSession(
            input.sessionInput.threadId,
            input.providerInstanceId,
            input.adapter.provider,
          );
    const startExit = yield* Effect.exit(
      prepareSession.pipe(
        Effect.andThen(Deferred.succeed(startGate, undefined)),
        Effect.andThen(Fiber.join(startFiber)),
      ),
    );
    if (Exit.isFailure(startExit)) {
      yield* Fiber.interrupt(startFiber).pipe(Effect.ignore);
      yield* cleanupExactRuntimeLeaseMcpSession({
        threadId: input.sessionInput.threadId,
        expectedRuntimeSessionId: runtimeSessionId,
        ...(installed.previous !== undefined ? { replacement: installed.previous } : {}),
      });
      return yield* Effect.failCause(startExit.cause);
    }
    const session = startExit.value;
    const leaseIsCurrent = yield* Ref.modify(runtimeLeases, (current) => {
      const lease = current.get(input.sessionInput.threadId);
      if (lease?.runtimeSessionId !== runtimeSessionId || lease.forceStopping === true) {
        return [false, current] as const;
      }
      const next = new Map(current);
      next.set(input.sessionInput.threadId, {
        runtimeSessionId: lease.runtimeSessionId,
        providerInstanceId: lease.providerInstanceId,
        adapter: lease.adapter,
        persistence: lease.persistence,
      });
      return [true, next] as const;
    });
    if (!leaseIsCurrent) {
      yield* input.adapter
        .forceStopSession(input.sessionInput.threadId, runtimeSessionId)
        .pipe(Effect.ignore);
      return yield* toValidationError(
        "ProviderService.startSession",
        `Provider runtime '${runtimeSessionId}' was stopped before session startup completed.`,
      );
    }
    return {
      ...session,
      providerInstanceId: input.providerInstanceId,
      runtimeSessionId,
    };
  });

  const publishRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Effect.succeed(event).pipe(
      Effect.tap((canonicalEvent) =>
        canonicalEventLogger
          ? canonicalEventLogger.write(canonicalEvent, canonicalEvent.threadId)
          : Effect.void,
      ),
      Effect.flatMap((canonicalEvent) => PubSub.publish(runtimeEventPubSub, canonicalEvent)),
      Effect.asVoid,
    );

  const requireBindingInstanceId = (
    operation: string,
    payload: {
      readonly providerInstanceId?: ProviderInstanceId | undefined;
      readonly provider?: ProviderDriverKind | undefined;
    },
  ): Effect.Effect<ProviderInstanceId, ProviderValidationError> =>
    payload.providerInstanceId !== undefined
      ? Effect.succeed(payload.providerInstanceId)
      : Effect.fail(
          toValidationError(
            operation,
            payload.provider
              ? `Provider instance id is required for provider '${payload.provider}'.`
              : "Provider instance id is required.",
          ),
        );

  const upsertSessionBinding = (
    session: ProviderSession,
    threadId: ThreadId,
    extra?: {
      readonly modelSelection?: unknown;
      readonly lastRuntimeEvent?: string;
      readonly lastRuntimeEventAt?: string;
    },
  ) =>
    Effect.gen(function* () {
      const providerInstanceId = yield* requireBindingInstanceId(
        "ProviderService.upsertSessionBinding",
        session,
      );
      yield* directory.upsert({
        threadId,
        provider: session.provider,
        providerInstanceId,
        runtimeMode: session.runtimeMode,
        status: toRuntimeStatus(session),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: toRuntimePayloadFromSession(session, extra),
      });
    });

  const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (
    source: {
      readonly instanceId: ProviderInstanceId;
      readonly provider: ProviderDriverKind;
    },
    event: ProviderRuntimeEvent,
  ) {
    const canonicalEvent = yield* Effect.sync(() =>
      correlateRuntimeEventWithInstance(source, event),
    );
    const currentLease = (yield* Ref.get(runtimeLeases)).get(canonicalEvent.threadId);
    if (
      !currentLease ||
      currentLease.forceStopping === true ||
      currentLease.providerInstanceId !== source.instanceId ||
      currentLease.runtimeSessionId !== canonicalEvent.runtimeSessionId
    ) {
      return;
    }
    yield* increment(providerRuntimeEventsTotal, {
      provider: canonicalEvent.provider,
      eventType: canonicalEvent.type,
    }).pipe(Effect.andThen(publishRuntimeEvent(canonicalEvent)));
    if (mcpRuntimeRegistry !== undefined) {
      yield* mcpRuntimeRegistry
        .observeProviderEvent(canonicalEvent)
        .pipe(Effect.forkIn(serviceScope));
    }
  });

  // `subscribedAdapters` is our source-of-truth for "which instance adapters
  // are currently wired into the runtime event bus". It both tracks the set
  // of live subscriptions (so `reconcileInstanceSubscriptions` can diff and
  // fork only the *new* or *rebuilt* ones) and serves as the dynamic adapter
  // list consumed by `stopStaleSessionsForThread`, `listSessions`, and
  // `runStopAll` — replacing the pre-Slice-D startup snapshot so hot-added
  // instances become visible to those call sites as soon as settings edits
  // land.
  const subscribedAdapters = yield* Ref.make(
    new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>(),
  );

  const getAdapterEntries = Ref.get(subscribedAdapters).pipe(
    Effect.map((map) => Array.from(map.entries())),
  );

  // Rebuild the map of id → adapter from the registry and fork a new event
  // subscription for every instance that is either brand new or whose adapter
  // identity changed (indicating the underlying `ProviderInstance` was torn
  // down and rebuilt by `ProviderInstanceRegistry.reconcile`). Orphaned
  // fibers for removed/replaced instances exit on their own because their
  // adapter's `streamEvents` source terminates when the old scope closes.
  const reconcileInstanceSubscriptions = Effect.gen(function* () {
    const previous = yield* Ref.get(subscribedAdapters);
    const currentIds = yield* registry.listInstances();
    const next = new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>();
    for (const id of currentIds) {
      const adapterOption = yield* registry
        .getByInstance(id)
        .pipe(Effect.tapError(Effect.logWarning), Effect.option);
      if (Option.isNone(adapterOption)) continue;
      const adapter = adapterOption.value;
      next.set(id, adapter);
      if (previous.get(id) !== adapter) {
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          processRuntimeEvent(
            {
              instanceId: id,
              provider: adapter.provider,
            },
            event,
          ),
        ).pipe(Effect.forkScoped);
      }
    }
    yield* Ref.set(subscribedAdapters, next);
  });

  const instanceChanges = yield* registry.subscribeChanges;
  yield* reconcileInstanceSubscriptions;
  yield* Stream.runForEach(
    Stream.fromSubscription(instanceChanges),
    () => reconcileInstanceSubscriptions,
  ).pipe(Effect.forkScoped);

  const recoverSessionForThread = Effect.fn("recoverSessionForThread")(function* (input: {
    readonly binding: ProviderSessionDirectory.ProviderRuntimeBinding;
    readonly operation: string;
  }) {
    const bindingInstanceId = yield* requireBindingInstanceId(input.operation, input.binding);
    yield* Effect.annotateCurrentSpan({
      "provider.operation": "recover-session",
      "provider.kind": input.binding.provider,
      "provider.instance_id": bindingInstanceId,
      "provider.thread_id": input.binding.threadId,
    });
    return yield* Effect.gen(function* () {
      const adapter = yield* registry.getByInstance(bindingInstanceId);
      const hasResumeCursor =
        input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined;
      const hasActiveSession = yield* adapter.hasSession(input.binding.threadId);
      if (hasActiveSession) {
        const activeSessions = yield* adapter.listSessions();
        const existing = activeSessions.find(
          (session) => session.threadId === input.binding.threadId,
        );
        if (existing) {
          const runtimeSessionId = yield* ensureRuntimeLease({
            threadId: input.binding.threadId,
            providerInstanceId: bindingInstanceId,
            adapter,
          });
          const existingWithLease = {
            ...existing,
            providerInstanceId: bindingInstanceId,
            runtimeSessionId,
          };
          yield* upsertSessionBinding(existingWithLease, input.binding.threadId);
          yield* registerMcpRuntimeSession(existingWithLease);
          return { adapter, session: existingWithLease } as const;
        }
      }

      if (!hasResumeCursor) {
        return yield* toValidationError(
          input.operation,
          `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
        );
      }

      const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
      const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);

      const resumed = yield* startAdapterSessionWithLease({
        adapter,
        providerInstanceId: bindingInstanceId,
        sessionInput: {
          threadId: input.binding.threadId,
          provider: input.binding.provider,
          providerInstanceId: bindingInstanceId,
          ...(persistedCwd ? { cwd: persistedCwd } : {}),
          ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
          ...(hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {}),
          runtimeMode: input.binding.runtimeMode ?? "full-access",
        },
      });
      if (resumed.provider !== adapter.provider) {
        yield* cleanupExactRuntimeLeaseMcpSession({
          threadId: input.binding.threadId,
          expectedRuntimeSessionId: resumed.runtimeSessionId,
        });
        return yield* toValidationError(
          input.operation,
          `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
        );
      }

      yield* upsertSessionBinding(
        { ...resumed, providerInstanceId: bindingInstanceId },
        input.binding.threadId,
      );
      yield* registerMcpRuntimeSession({ ...resumed, providerInstanceId: bindingInstanceId });
      return { adapter, session: resumed } as const;
    }).pipe(
      withMetrics({
        counter: providerSessionsTotal,
        attributes: providerMetricAttributes(input.binding.provider, {
          operation: "recover",
        }),
      }),
    );
  });

  const resolveRoutableSession = Effect.fn("resolveRoutableSession")(function* (input: {
    readonly threadId: ThreadId;
    readonly operation: string;
    readonly allowRecovery: boolean;
  }) {
    const transient = (yield* Ref.get(transientBindings)).get(input.threadId);
    if (transient !== undefined) {
      const lease = (yield* Ref.get(runtimeLeases)).get(input.threadId);
      if (
        lease?.runtimeSessionId !== transient.runtimeSessionId ||
        lease.providerInstanceId !== transient.providerInstanceId ||
        lease.persistence !== "transient" ||
        lease.forceStopping === true ||
        !(yield* transient.adapter.hasSession(input.threadId))
      ) {
        return yield* toValidationError(
          input.operation,
          `Transient provider runtime for thread '${input.threadId}' is no longer active.`,
        );
      }
      return {
        adapter: transient.adapter,
        instanceId: transient.providerInstanceId,
        threadId: input.threadId,
        isActive: true,
        isTransient: true,
      } as const;
    }

    const bindingOption = yield* directory.getBinding(input.threadId);
    const binding = Option.getOrUndefined(bindingOption);
    if (!binding) {
      return yield* toValidationError(
        input.operation,
        `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
      );
    }
    const instanceId = yield* requireBindingInstanceId(input.operation, binding);
    const adapter = yield* registry.getByInstance(instanceId);

    const hasRequestedSession = yield* adapter.hasSession(input.threadId);
    if (hasRequestedSession) {
      return {
        adapter,
        instanceId,
        threadId: input.threadId,
        isActive: true,
        isTransient: false,
      } as const;
    }

    if (!input.allowRecovery) {
      return {
        adapter,
        instanceId,
        threadId: input.threadId,
        isActive: false,
        isTransient: false,
      } as const;
    }

    const recovered = yield* recoverSessionForThread({
      binding,
      operation: input.operation,
    });
    return {
      adapter: recovered.adapter,
      instanceId,
      threadId: input.threadId,
      isActive: true,
      isTransient: false,
    } as const;
  });

  const stopStaleSessionsForThread = Effect.fn("stopStaleSessionsForThread")(function* (input: {
    readonly threadId: ThreadId;
    readonly currentInstanceId: ProviderInstanceId;
  }) {
    const currentAdapters = yield* getAdapterEntries;
    yield* Effect.forEach(
      currentAdapters,
      ([instanceId, adapter]) =>
        instanceId === input.currentInstanceId
          ? Effect.void
          : Effect.gen(function* () {
              const hasSession = yield* adapter.hasSession(input.threadId);
              if (!hasSession) {
                return;
              }

              yield* adapter.stopSession(input.threadId).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("provider.session.stop-stale-failed", {
                    threadId: input.threadId,
                    provider: adapter.provider,
                    cause,
                  }),
                ),
              );
            }),
      { discard: true },
    );
  });

  const startSession: ProviderServiceMethod<"startSession"> = Effect.fn("startSession")(
    function* (threadId, rawInput) {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderService.startSession",
        schema: ProviderSessionStartInput,
        payload: rawInput,
      });
      if (resolveProviderSessionPurpose(parsed.purpose) !== "interactive") {
        return yield* toValidationError(
          "ProviderService.startSession",
          "Fetch worker sessions must use startTransientSession.",
        );
      }

      const resolvedInstanceId = yield* requireBindingInstanceId(
        "ProviderService.startSession",
        parsed,
      );
      let metricProvider = parsed.provider ?? String(resolvedInstanceId);
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "start-session",
        "provider.instance_id": resolvedInstanceId,
        "provider.thread_id": threadId,
        "provider.runtime_mode": parsed.runtimeMode,
      });
      return yield* Effect.gen(function* () {
        const instanceInfo = yield* registry.getInstanceInfo(resolvedInstanceId);
        const resolvedProvider = instanceInfo.driverKind;
        metricProvider = resolvedProvider;
        if (parsed.provider !== undefined && parsed.provider !== resolvedProvider) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider instance '${resolvedInstanceId}' belongs to driver '${resolvedProvider}', not '${parsed.provider}'.`,
          );
        }
        const input = {
          ...parsed,
          threadId,
          provider: resolvedProvider,
        };
        if (!instanceInfo.enabled) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider instance '${resolvedInstanceId}' is disabled in T3 Code settings.`,
          );
        }
        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const effectiveResumeCursor = input.freshSession
          ? undefined
          : (input.resumeCursor ??
            (persistedBinding?.providerInstanceId === resolvedInstanceId
              ? persistedBinding.resumeCursor
              : undefined));
        const effectiveCwd =
          input.cwd ??
          (persistedBinding?.providerInstanceId === resolvedInstanceId
            ? readPersistedCwd(persistedBinding.runtimePayload)
            : undefined);
        yield* Effect.annotateCurrentSpan({
          "provider.kind": resolvedProvider,
          "provider.resume_cursor.source": input.freshSession
            ? "fresh-session"
            : input.resumeCursor !== undefined
              ? "request"
              : effectiveResumeCursor !== undefined &&
                  persistedBinding?.providerInstanceId === resolvedInstanceId
                ? "persisted"
                : "none",
          "provider.resume_cursor.present": effectiveResumeCursor !== undefined,
          "provider.cwd.source":
            input.cwd !== undefined
              ? "request"
              : effectiveCwd !== undefined &&
                  persistedBinding?.providerInstanceId === resolvedInstanceId
                ? "persisted"
                : "none",
          "provider.cwd.effective": effectiveCwd ?? "",
        });
        const adapter = yield* registry.getByInstance(resolvedInstanceId);
        const { resumeCursor: _requestedResumeCursor, ...sessionInput } = input;
        const session = yield* startAdapterSessionWithLease({
          adapter,
          providerInstanceId: resolvedInstanceId,
          sessionInput: {
            ...sessionInput,
            providerInstanceId: resolvedInstanceId,
            ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
            ...(effectiveResumeCursor !== undefined ? { resumeCursor: effectiveResumeCursor } : {}),
          },
        });

        if (session.provider !== adapter.provider) {
          yield* cleanupExactRuntimeLeaseMcpSession({
            threadId,
            expectedRuntimeSessionId: session.runtimeSessionId,
          });
          return yield* toValidationError(
            "ProviderService.startSession",
            `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
          );
        }
        const sessionWithInstance = session;

        yield* stopStaleSessionsForThread({
          threadId,
          currentInstanceId: resolvedInstanceId,
        });
        yield* upsertSessionBinding(sessionWithInstance, threadId, {
          modelSelection: input.modelSelection,
        });
        yield* registerMcpRuntimeSession(sessionWithInstance);

        return sessionWithInstance;
      }).pipe(
        withMetrics({
          counter: providerSessionsTotal,
          attributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "start",
            }),
        }),
      );
    },
  );

  const startTransientSession: ProviderServiceMethod<"startTransientSession"> = Effect.fn(
    "startTransientSession",
  )(function* (threadId, rawInput) {
    const parsed = yield* decodeInputOrValidationError({
      operation: "ProviderService.startTransientSession",
      schema: ProviderSessionStartInput,
      payload: rawInput,
    });
    if (resolveProviderSessionPurpose(parsed.purpose) !== "fetch-worker") {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        "Transient sessions are reserved for the fetch-worker purpose.",
      );
    }
    if (parsed.runtimeSessionId === undefined) {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        "A pre-registered runtimeSessionId is required for transient sessions.",
      );
    }
    if (parsed.runtimeMode !== "approval-required") {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        "Fetch worker sessions require approval-required runtime mode.",
      );
    }
    if (parsed.modelSelection === undefined) {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        "Fetch worker sessions require an exact model selection.",
      );
    }

    const resolvedInstanceId = yield* requireBindingInstanceId(
      "ProviderService.startTransientSession",
      parsed,
    );
    if (parsed.modelSelection.instanceId !== resolvedInstanceId) {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        "Fetch worker model selection must belong to the selected provider instance.",
      );
    }
    if ((yield* Ref.get(transientBindings)).has(threadId)) {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        `Transient thread '${threadId}' already has an active provider runtime.`,
      );
    }
    if ((yield* Ref.get(runtimeLeases)).has(threadId)) {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        `Thread '${threadId}' already has an active provider runtime.`,
      );
    }

    const instanceInfo = yield* registry.getInstanceInfo(resolvedInstanceId);
    if (!instanceInfo.enabled) {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        `Provider instance '${resolvedInstanceId}' is disabled in T3 Code settings.`,
      );
    }
    if (parsed.provider !== undefined && parsed.provider !== instanceInfo.driverKind) {
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        `Provider instance '${resolvedInstanceId}' belongs to driver '${instanceInfo.driverKind}', not '${parsed.provider}'.`,
      );
    }

    const adapter = yield* registry.getByInstance(resolvedInstanceId);
    const { resumeCursor: _resumeCursor, ...safeInput } = parsed;
    const session = yield* startAdapterSessionWithLease({
      adapter,
      providerInstanceId: resolvedInstanceId,
      runtimeSessionId: parsed.runtimeSessionId,
      persistence: "transient",
      mountMcp: false,
      sessionInput: {
        ...safeInput,
        threadId,
        runtimeSessionId: parsed.runtimeSessionId,
        provider: instanceInfo.driverKind,
        providerInstanceId: resolvedInstanceId,
        purpose: "fetch-worker",
        freshSession: true,
        runtimeMode: "approval-required",
      },
    });
    if (session.provider !== adapter.provider) {
      yield* cleanupExactRuntimeLeaseMcpSession({
        threadId,
        expectedRuntimeSessionId: parsed.runtimeSessionId,
      });
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
      );
    }

    const installed = yield* installTransientBinding({
      threadId,
      runtimeSessionId: parsed.runtimeSessionId,
      providerInstanceId: resolvedInstanceId,
      adapter,
    });
    const lease = (yield* Ref.get(runtimeLeases)).get(threadId);
    const exactLeaseIsCurrent =
      lease?.runtimeSessionId === parsed.runtimeSessionId &&
      lease.providerInstanceId === resolvedInstanceId &&
      lease.persistence === "transient" &&
      lease.forceStopping !== true;
    if (!installed || !exactLeaseIsCurrent) {
      yield* clearTransientBinding({
        threadId,
        runtimeSessionId: parsed.runtimeSessionId,
        providerInstanceId: resolvedInstanceId,
      });
      yield* adapter.forceStopSession(threadId, parsed.runtimeSessionId).pipe(Effect.ignore);
      yield* cleanupExactRuntimeLeaseMcpSession({
        threadId,
        expectedRuntimeSessionId: parsed.runtimeSessionId,
      });
      return yield* toValidationError(
        "ProviderService.startTransientSession",
        `Transient runtime '${parsed.runtimeSessionId}' was replaced during startup.`,
      );
    }

    return session;
  });

  const sendTurn: ProviderServiceMethod<"sendTurn"> = Effect.fn("sendTurn")(function* (rawInput) {
    const parsed = yield* decodeInputOrValidationError({
      operation: "ProviderService.sendTurn",
      schema: ProviderSendTurnInput,
      payload: rawInput,
    });

    const input = {
      ...parsed,
      attachments: parsed.attachments ?? [],
    };
    if (!input.input && input.attachments.length === 0) {
      return yield* toValidationError(
        "ProviderService.sendTurn",
        "Either input text or at least one attachment is required",
      );
    }
    yield* Effect.annotateCurrentSpan({
      "provider.operation": "send-turn",
      "provider.thread_id": input.threadId,
      "provider.interaction_mode": input.interactionMode,
      "provider.attachment_count": input.attachments.length,
    });
    let metricProvider = "unknown";
    let metricModel = input.modelSelection?.model;
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.sendTurn",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      metricModel = input.modelSelection?.model;
      yield* Effect.annotateCurrentSpan({
        "provider.kind": routed.adapter.provider,
        ...(input.modelSelection?.model ? { "provider.model": input.modelSelection.model } : {}),
      });
      // A turn is the clearest sign a session is still alive. The MCP
      // credential is minted once at session start and cannot be rotated into
      // an already-spawned agent process, so we keep the existing token valid
      // rather than issuing a new one: sessions that go a long time between
      // browser tool calls used to lose the toolkit outright.
      if (!routed.isTransient) {
        yield* McpSessionRegistry.touchActiveMcpThread(input.threadId);
      }
      const turn = yield* routed.adapter.sendTurn(input);
      if (routed.isTransient) {
        return turn;
      }
      yield* directory.upsert({
        threadId: input.threadId,
        provider: routed.adapter.provider,
        providerInstanceId: routed.instanceId,
        status: "running",
        ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
        runtimePayload: {
          ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
          activeTurnId: turn.turnId,
          lastRuntimeEvent: "provider.sendTurn",
          lastRuntimeEventAt: yield* nowIso,
        },
      });
      return turn;
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        timer: providerTurnDuration,
        attributes: () =>
          providerTurnMetricAttributes({
            provider: metricProvider,
            model: metricModel,
            extra: {
              operation: "send",
            },
          }),
      }),
    );
  });

  const resolveAbortTarget: ProviderServiceMethod<"resolveAbortTarget"> = Effect.fn(
    "resolveAbortTarget",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.resolveAbortTarget",
      schema: ProviderInterruptTurnInput,
      payload: rawInput,
    });
    const lease = (yield* Ref.get(runtimeLeases)).get(input.threadId);
    if (!lease) {
      return yield* toValidationError(
        "ProviderService.resolveAbortTarget",
        `Cannot abort thread '${input.threadId}' because it has no active runtime session.`,
      );
    }
    return {
      threadId: input.threadId,
      runtimeSessionId: lease.runtimeSessionId,
      turnId: input.turnId ?? null,
      providerInstanceId: lease.providerInstanceId,
    };
  });

  const isAbortTargetCurrent: ProviderServiceMethod<"isAbortTargetCurrent"> = (target) =>
    Ref.get(runtimeLeases).pipe(
      Effect.map((leases) => {
        const current = leases.get(target.threadId);
        return (
          current?.runtimeSessionId === target.runtimeSessionId &&
          current.providerInstanceId === target.providerInstanceId
        );
      }),
    );

  const interruptAbortTarget: ProviderServiceMethod<"interruptAbortTarget"> = Effect.fn(
    "interruptAbortTarget",
  )(function* (target) {
    const lease = (yield* Ref.get(runtimeLeases)).get(target.threadId);
    if (
      lease?.runtimeSessionId !== target.runtimeSessionId ||
      lease.providerInstanceId !== target.providerInstanceId
    ) {
      return;
    }
    yield* lease.adapter.interruptTurn(target.threadId, undefined, target.runtimeSessionId);
  });

  const forceStopAbortTarget: ProviderServiceMethod<"forceStopAbortTarget"> = Effect.fn(
    "forceStopAbortTarget",
  )(function* (target) {
    const lease = yield* claimRuntimeLeaseForCleanup({
      threadId: target.threadId,
      expectedRuntimeSessionId: target.runtimeSessionId,
      expectedProviderInstanceId: target.providerInstanceId,
    });
    if (lease === undefined) {
      return {
        outcome: "terminated",
        mechanism: "already-stopped",
      } as const;
    }

    return yield* Effect.gen(function* () {
      if (lease.startFiber !== undefined) {
        yield* Fiber.interrupt(lease.startFiber).pipe(Effect.ignore);
      }
      const forceExit = yield* Effect.exit(
        lease.adapter.forceStopSession(target.threadId, target.runtimeSessionId),
      );
      if (lease.persistence !== "transient") {
        yield* clearMcpSession(target.threadId);
        yield* endMcpRuntimeSession({
          providerInstanceId: target.providerInstanceId,
          threadId: target.threadId,
          runtimeSessionId: target.runtimeSessionId,
        });
        yield* directory.upsert({
          threadId: target.threadId,
          provider: lease.adapter.provider,
          providerInstanceId: lease.providerInstanceId,
          status: "stopped",
          runtimePayload: {
            runtimeSessionId: null,
            activeTurnId: null,
            lastRuntimeEvent: "provider.forceStop",
            lastRuntimeEventAt: yield* nowIso,
          },
        });
      }
      if (Exit.isFailure(forceExit)) {
        return yield* Effect.failCause(forceExit.cause);
      }
      return forceExit.value;
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (lease.persistence === "transient") {
            yield* clearTransientBinding({
              threadId: target.threadId,
              runtimeSessionId: target.runtimeSessionId,
              providerInstanceId: target.providerInstanceId,
            });
          }
          yield* completeRuntimeLeaseCleanup({
            threadId: target.threadId,
            expectedRuntimeSessionId: target.runtimeSessionId,
          });
        }),
      ),
    );
  });

  const interruptTurn: ProviderServiceMethod<"interruptTurn"> = Effect.fn("interruptTurn")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.interruptTurn",
        schema: ProviderInterruptTurnInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const target = yield* resolveAbortTarget(input);
        const lease = (yield* Ref.get(runtimeLeases)).get(target.threadId);
        metricProvider = lease?.adapter.provider ?? "unknown";
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "interrupt-turn",
          "provider.kind": metricProvider,
          "provider.thread_id": input.threadId,
          "provider.turn_id": input.turnId,
        });
        yield* interruptAbortTarget(target);
      }).pipe(
        withMetrics({
          counter: providerTurnsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "interrupt",
            }),
        }),
      );
    },
  );

  const respondToRequest: ProviderServiceMethod<"respondToRequest"> = Effect.fn("respondToRequest")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.respondToRequest",
        schema: ProviderRespondToRequestInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToRequest",
          allowRecovery: true,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "respond-to-request",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
          "provider.request_id": input.requestId,
        });
        yield* routed.adapter.respondToRequest(routed.threadId, input.requestId, input.decision);
      }).pipe(
        withMetrics({
          counter: providerTurnsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "approval-response",
            }),
        }),
      );
    },
  );

  const respondToUserInput: ProviderServiceMethod<"respondToUserInput"> = Effect.fn(
    "respondToUserInput",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.respondToUserInput",
      schema: ProviderRespondToUserInputInput,
      payload: rawInput,
    });
    let metricProvider = "unknown";
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.respondToUserInput",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "respond-to-user-input",
        "provider.kind": routed.adapter.provider,
        "provider.thread_id": input.threadId,
        "provider.request_id": input.requestId,
      });
      yield* routed.adapter.respondToUserInput(routed.threadId, input.requestId, input.answers);
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        outcomeAttributes: () =>
          providerMetricAttributes(metricProvider, {
            operation: "user-input-response",
          }),
      }),
    );
  });

  const stopSession: ProviderServiceMethod<"stopSession"> = Effect.fn("stopSession")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.stopSession",
        schema: ProviderStopSessionInput,
        payload: rawInput,
      });
      if ((yield* Ref.get(transientBindings)).has(input.threadId)) {
        return yield* toValidationError(
          "ProviderService.stopSession",
          "Transient sessions require exact-runtime stopTransientSession cleanup.",
        );
      }
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const lease = (yield* Ref.get(runtimeLeases)).get(input.threadId);
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.stopSession",
          allowRecovery: false,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "stop-session",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
        });
        if (routed.isActive) {
          yield* routed.adapter.stopSession(routed.threadId);
        }
        if (
          lease !== undefined &&
          lease.providerInstanceId === routed.instanceId &&
          lease.forceStopping !== true
        ) {
          yield* endMcpRuntimeSession({
            providerInstanceId: lease.providerInstanceId,
            threadId: input.threadId,
            runtimeSessionId: lease.runtimeSessionId,
          });
        }
        yield* clearRuntimeLease(input.threadId);
        yield* clearMcpSession(input.threadId);
        yield* directory.upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          providerInstanceId: routed.instanceId,
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
          },
        });
      }).pipe(
        withMetrics({
          counter: providerSessionsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "stop",
            }),
        }),
      );
    },
  );

  const stopTransientSession: ProviderServiceMethod<"stopTransientSession"> = Effect.fn(
    "stopTransientSession",
  )(function* (target) {
    const binding = (yield* Ref.get(transientBindings)).get(target.threadId);
    if (
      binding?.runtimeSessionId !== target.runtimeSessionId ||
      binding.providerInstanceId !== target.providerInstanceId
    ) {
      return;
    }

    const lease = yield* claimRuntimeLeaseForCleanup({
      threadId: target.threadId,
      expectedRuntimeSessionId: target.runtimeSessionId,
      expectedProviderInstanceId: target.providerInstanceId,
    });
    if (lease === undefined || lease.persistence !== "transient") {
      return;
    }

    return yield* lease.adapter.stopSession(target.threadId).pipe(
      Effect.onError(() =>
        lease.adapter.forceStopSession(target.threadId, target.runtimeSessionId).pipe(
          Effect.timeoutOption("5 seconds"),
          Effect.tap((result) =>
            Option.isNone(result)
              ? Effect.logWarning("Transient provider force-stop fallback timed out", {
                  threadId: target.threadId,
                  runtimeSessionId: target.runtimeSessionId,
                  providerInstanceId: target.providerInstanceId,
                })
              : Effect.void,
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Transient provider force-stop fallback failed", {
              threadId: target.threadId,
              runtimeSessionId: target.runtimeSessionId,
              providerInstanceId: target.providerInstanceId,
              cause: causeErrorTag(cause),
            }),
          ),
          Effect.asVoid,
          Effect.forkIn(serviceScope),
          Effect.asVoid,
        ),
      ),
      Effect.ensuring(
        Effect.gen(function* () {
          yield* clearTransientBinding(target);
          yield* completeRuntimeLeaseCleanup({
            threadId: target.threadId,
            expectedRuntimeSessionId: target.runtimeSessionId,
          });
        }),
      ),
    );
  });

  const listSessions: ProviderServiceMethod<"listSessions"> = Effect.fn("listSessions")(
    function* () {
      const currentAdapters = yield* getAdapterEntries;
      const sessionsByProvider = yield* Effect.forEach(currentAdapters, ([instanceId, adapter]) =>
        adapter.listSessions().pipe(
          Effect.map((sessions) =>
            sessions.map((session) => ({
              ...session,
              providerInstanceId: instanceId,
            })),
          ),
        ),
      );
      const transient = yield* Ref.get(transientBindings);
      const activeSessions = sessionsByProvider
        .flatMap((sessions) => sessions)
        .filter((session) => {
          const binding = transient.get(session.threadId);
          return binding === undefined || binding.runtimeSessionId !== session.runtimeSessionId;
        });
      const persistedBindings = yield* directory.listThreadIds().pipe(
        Effect.flatMap((threadIds) =>
          Effect.forEach(
            threadIds,
            (threadId) =>
              directory
                .getBinding(threadId)
                .pipe(
                  Effect.orElseSucceed(() =>
                    Option.none<ProviderSessionDirectory.ProviderRuntimeBinding>(),
                  ),
                ),
            { concurrency: "unbounded" },
          ),
        ),
        Effect.orElseSucceed(
          () => [] as Array<Option.Option<ProviderSessionDirectory.ProviderRuntimeBinding>>,
        ),
      );
      const bindingsByThreadId = new Map<
        ThreadId,
        ProviderSessionDirectory.ProviderRuntimeBinding
      >();
      for (const bindingOption of persistedBindings) {
        const binding = Option.getOrUndefined(bindingOption);
        if (binding) {
          bindingsByThreadId.set(binding.threadId, binding);
        }
      }

      const sessions: ProviderSession[] = [];
      for (const session of activeSessions) {
        const binding = bindingsByThreadId.get(session.threadId);
        if (!binding) {
          sessions.push(session);
          continue;
        }

        const overrides: {
          resumeCursor?: ProviderSession["resumeCursor"];
          runtimeMode?: ProviderSession["runtimeMode"];
          providerInstanceId?: ProviderSession["providerInstanceId"];
        } = {};
        overrides.providerInstanceId = dieOnMissingBindingInstanceId(
          "ProviderService.listSessions",
          binding,
        );
        if (binding.provider !== session.provider) {
          return yield* Effect.die(
            new Error(
              `ProviderService.listSessions: thread '${session.threadId}' is active on provider '${session.provider}' but persisted binding names provider '${binding.provider}'.`,
            ),
          );
        }
        if (overrides.providerInstanceId !== session.providerInstanceId) {
          return yield* Effect.die(
            new Error(
              `ProviderService.listSessions: thread '${session.threadId}' is active on provider instance '${session.providerInstanceId}' but persisted binding names '${overrides.providerInstanceId}'.`,
            ),
          );
        }
        if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
          overrides.resumeCursor = binding.resumeCursor;
        }
        if (binding.runtimeMode !== undefined) {
          overrides.runtimeMode = binding.runtimeMode;
        }
        sessions.push(Object.assign({}, session, overrides));
      }
      return sessions;
    },
  );

  const getCapabilities: ProviderServiceMethod<"getCapabilities"> = (instanceId) =>
    registry.getByInstance(instanceId).pipe(Effect.map((adapter) => adapter.capabilities));

  const getInstanceInfo: ProviderServiceMethod<"getInstanceInfo"> = (instanceId) =>
    registry.getInstanceInfo(instanceId);

  const rollbackConversation: ProviderServiceMethod<"rollbackConversation"> = Effect.fn(
    "rollbackConversation",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.rollbackConversation",
      schema: ProviderRollbackConversationInput,
      payload: rawInput,
    });
    if (input.numTurns === 0) {
      return;
    }
    let metricProvider = "unknown";
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.rollbackConversation",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "rollback-conversation",
        "provider.kind": routed.adapter.provider,
        "provider.thread_id": input.threadId,
        "provider.rollback_turns": input.numTurns,
      });
      yield* routed.adapter.rollbackThread(routed.threadId, input.numTurns);
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        outcomeAttributes: () =>
          providerMetricAttributes(metricProvider, {
            operation: "rollback",
          }),
      }),
    );
  });

  const runStopAll = Effect.fn("runStopAll")(function* () {
    const currentAdapters = yield* getAdapterEntries;
    const activeSessions = yield* Effect.forEach(currentAdapters, ([instanceId, adapter]) =>
      adapter.listSessions().pipe(
        Effect.map((sessions) =>
          sessions.map((session) => ({
            ...session,
            providerInstanceId: instanceId,
          })),
        ),
      ),
    ).pipe(Effect.map((sessionsByAdapter) => sessionsByAdapter.flatMap((sessions) => sessions)));
    const leases = yield* Ref.get(runtimeLeases);
    const durableSessions = activeSessions.filter(
      (session) => leases.get(session.threadId)?.persistence !== "transient",
    );
    yield* Effect.forEach(durableSessions, (session) =>
      Effect.flatMap(nowIso, (lastRuntimeEventAt) =>
        upsertSessionBinding(session, session.threadId, {
          lastRuntimeEvent: "provider.stopAll",
          lastRuntimeEventAt,
        }),
      ),
    ).pipe(Effect.asVoid);
    yield* Effect.forEach(currentAdapters, ([, adapter]) => adapter.stopAll()).pipe(Effect.asVoid);
    yield* Effect.forEach(durableSessions, (session) =>
      session.providerInstanceId !== undefined && session.runtimeSessionId !== undefined
        ? endMcpRuntimeSession({
            providerInstanceId: session.providerInstanceId,
            threadId: session.threadId,
            runtimeSessionId: session.runtimeSessionId,
          })
        : Effect.void,
    ).pipe(Effect.asVoid);
    yield* Ref.set(runtimeLeases, new Map());
    yield* Ref.set(transientBindings, new Map());
    yield* McpSessionRegistry.revokeAllActiveMcpCredentials();
    McpProviderSession.clearAllMcpProviderSessions();
    const bindings = yield* directory.listBindings().pipe(Effect.orElseSucceed(() => []));
    yield* Effect.forEach(bindings, (binding) =>
      Effect.gen(function* () {
        const providerInstanceId = dieOnMissingBindingInstanceId(
          "ProviderService.stopAll",
          binding,
        );
        return yield* directory.upsert({
          threadId: binding.threadId,
          provider: binding.provider,
          providerInstanceId,
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
            lastRuntimeEvent: "provider.stopAll",
            lastRuntimeEventAt: yield* nowIso,
          },
        });
      }),
    ).pipe(Effect.asVoid);
  });

  yield* Effect.addFinalizer(() =>
    runStopAll().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to stop provider service", {
          errorTag: causeErrorTag(cause),
        }),
      ),
    ),
  );

  return {
    startSession,
    startTransientSession,
    sendTurn,
    interruptTurn,
    resolveAbortTarget,
    interruptAbortTarget,
    forceStopAbortTarget,
    isAbortTargetCurrent,
    respondToRequest,
    respondToUserInput,
    stopSession,
    stopTransientSession,
    listSessions,
    getCapabilities,
    getInstanceInfo,
    rollbackConversation,
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (ProviderRuntimeIngestion, CheckpointReactor, etc.) each
    // independently receive all runtime events.
    get streamEvents(): ProviderServiceMethod<"streamEvents"> {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  } satisfies ProviderService.ProviderService["Service"];
});

export const ProviderServiceLive = Layer.effect(
  ProviderService.ProviderService,
  makeProviderService(),
);

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService.ProviderService, makeProviderService(options));
}
