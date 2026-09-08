import { EventId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ResourceProtection from "../../resourceProtection/SubagentResourceGovernor.ts";
import { ProviderAdapterRequestError, type ProviderAdapterError } from "../Errors.ts";
import {
  makeBoundedProviderEventBroadcast,
  providerEventEncodedBytes,
  PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
  PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
} from "../boundedEventQueue.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makeNativeProviderMcpRuntime } from "./NativeProviderMcpRuntime.ts";
import { makeNativeProviderSessionLifecycle } from "./NativeProviderSessionLifecycle.ts";
import { makeSharedNativeProviderTurnAdmission } from "./NativeProviderTurnAdmission.ts";
import { makeNativeProviderTurnExecutor } from "./NativeProviderTurnExecutor.ts";
import type {
  NativeProviderAdapterDefinition,
  NativeProviderToolCall,
  NativeProviderTurnAdmission,
} from "./NativeProviderTypes.ts";

export type {
  NativeProviderAdapterDefinition,
  NativeProviderBeforeRoundResult,
  NativeProviderExecutedToolCall,
  NativeProviderHistoryStrategy,
  NativeProviderMcpSessionConfig,
  NativeProviderPersistedHistory,
  NativeProviderRoundEvent,
  NativeProviderSessionView,
  NativeProviderStartResult,
  NativeProviderToolCall,
  NativeProviderToolHarness,
  NativeProviderToolResult,
  NativeProviderTurnAdmission,
  NativeProviderTurnPlan,
  NativeProviderTurnRecord,
  NativeProviderUsage,
} from "./NativeProviderTypes.ts";

const noAdmission: NativeProviderTurnAdmission = {
  withLease: (_input, effect) => effect,
};

export const makeNativeProviderAdapter = Effect.fn("makeNativeProviderAdapter")(function* <
  HistoryItem,
  SessionState,
  ProtocolState,
  ToolDefinition,
  ToolCall extends NativeProviderToolCall,
>(
  definition: NativeProviderAdapterDefinition<
    HistoryItem,
    SessionState,
    ProtocolState,
    ToolDefinition,
    ToolCall
  >,
) {
  const environment = definition.environment ?? process.env;
  const resourceGovernor = yield* Effect.serviceOption(ResourceProtection.SubagentResourceGovernor);
  const admission =
    definition.admission ??
    Option.match(resourceGovernor, {
      onNone: () => noAdmission,
      onSome: (governor) =>
        makeSharedNativeProviderTurnAdmission({ provider: definition.provider, governor }),
    });
  const crypto = yield* Crypto.Crypto;
  const runtimeEventBroadcast = yield* makeBoundedProviderEventBroadcast<ProviderRuntimeEvent>({
    capacity: PROVIDER_RUNTIME_EVENT_QUEUE_CAPACITY,
    byteCapacity: PROVIDER_RUNTIME_EVENT_QUEUE_BYTE_CAPACITY,
    sizeOf: providerEventEncodedBytes,
  });
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUuid = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: definition.provider,
          method: "crypto/randomUUIDv4",
          detail: `Failed to generate a ${definition.provider} runtime identifier.`,
          cause,
        }),
    ),
  );
  const makeEventStamp = () =>
    Effect.all({ eventId: Effect.map(randomUuid, EventId.make), createdAt: nowIso });
  const publishRuntimeEvent = (event: ProviderRuntimeEvent) =>
    runtimeEventBroadcast.publish(event).pipe(Effect.asVoid);

  const sessionLifecycle = yield* makeNativeProviderSessionLifecycle({
    definition,
    nowIso,
    randomUuid,
    makeEventStamp,
    publishRuntimeEvent,
  });
  const {
    forceStopSession,
    hasSession,
    interruptTurn,
    listSessions,
    readAttachment,
    readThread,
    requireSession,
    respondToRequest,
    respondToUserInput,
    rollbackThread,
    sessionStore,
    startSession,
    stopAll,
    stopSession,
  } = sessionLifecycle;
  const { sendTurn } = makeNativeProviderTurnExecutor({
    definition,
    environment,
    admission,
    sessionStore,
    requireSession,
    readAttachment,
    randomUuid,
    nowIso,
    makeEventStamp,
  });
  const mcpRuntime = makeNativeProviderMcpRuntime({
    provider: definition.provider,
    instanceId: definition.instanceId,
    mcp: definition.mcp,
    releaseThread: definition.toolHarness.releaseThread,
    requireSession,
    nowIso,
  });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(Effect.ignore, Effect.andThen(runtimeEventBroadcast.shutdown)),
  );

  return {
    provider: definition.provider,
    capabilities: definition.capabilities,
    ...(mcpRuntime ? { mcpRuntime } : {}),
    startSession,
    sendTurn,
    interruptTurn,
    forceStopSession,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: runtimeEventBroadcast.stream,
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
