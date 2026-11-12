import type {
  AuthAccessSnapshot,
  AuthAccessStreamEvent,
  AuthAccessStreamSnapshotEvent,
  AuthCreatePairingCredentialInput,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  AuthAccessWriteScope,
  EnvironmentAuthorizationError,
  authScopeRequiredResponse,
  sessionGrantsScope,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as HttpClient from "effect/http/HttpClient";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { subscribe } from "../rpc/client.ts";
import { createEnvironmentCommand, createEnvironmentSubscriptionAtomFamily } from "./runtime.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { createEnvironmentSessionAtoms, fetchEnvironmentSessionState } from "./session.ts";

export const EMPTY_AUTH_ACCESS_SNAPSHOT: AuthAccessSnapshot = {
  pairingLinks: [],
  clientSessions: [],
};

function upsertByKey<A>(
  values: ReadonlyArray<A>,
  next: A,
  key: (value: A) => string,
): ReadonlyArray<A> {
  const nextKey = key(next);
  return [...values.filter((value) => key(value) !== nextKey), next];
}

export function applyAuthAccessStreamEvent(
  current: AuthAccessSnapshot,
  event: AuthAccessStreamEvent,
): AuthAccessSnapshot {
  switch (event.type) {
    case "snapshot":
      return event.payload;
    case "pairingLinkUpserted":
      return {
        ...current,
        pairingLinks: upsertByKey(current.pairingLinks, event.payload, (value) => value.id),
      };
    case "pairingLinkRemoved":
      return {
        ...current,
        pairingLinks: current.pairingLinks.filter((value) => value.id !== event.payload.id),
      };
    case "clientUpserted":
      return {
        ...current,
        clientSessions: upsertByKey(
          current.clientSessions,
          event.payload,
          (value) => value.sessionId,
        ),
      };
    case "clientRemoved":
      return {
        ...current,
        clientSessions: current.clientSessions.filter(
          (value) => value.sessionId !== event.payload.sessionId,
        ),
      };
  }
}

function projectAuthAccessSnapshot(
  current: AuthAccessSnapshot,
  event: AuthAccessStreamEvent,
): readonly [AuthAccessSnapshot, ReadonlyArray<AuthAccessStreamSnapshotEvent>] {
  const snapshot = applyAuthAccessStreamEvent(current, event);
  const projected: AuthAccessStreamSnapshotEvent = {
    version: 1,
    revision: event.revision,
    type: "snapshot",
    payload: snapshot,
  };
  return [snapshot, [projected]];
}

export function createAuthEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    accessChanges: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "environment-data:server:auth-access-changes",
      subscribe: (_input: null) =>
        subscribe(WS_METHODS.subscribeAuthAccess, {}).pipe(
          Stream.mapAccum(() => EMPTY_AUTH_ACCESS_SNAPSHOT, projectAuthAccessSnapshot),
        ),
    }),
  };
}

const accessRequestContext = Effect.fn("clientRuntime.state.authAccessContext")(function* () {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  const denied = new EnvironmentAuthorizationError({
    ...authScopeRequiredResponse(AuthAccessWriteScope),
    message: "This connection cannot manage access.",
  });
  if (Option.isNone(prepared)) return yield* denied;
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
  );
  const context = { prepared: prepared.value, signer, remoteAuthorization };
  const session = yield* fetchEnvironmentSessionState(context);
  if (!sessionGrantsScope(session, AuthAccessWriteScope)) return yield* denied;
  return { ...context, session };
});

/** Access HTTP endpoints share the same environment authorization as RPC commands. */
export function createAuthAccessCommands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const sessions = createEnvironmentSessionAtoms(runtime);
  const permissionAtom = Atom.family((environmentId: EnvironmentId | null) =>
    Atom.make((get) => {
      if (environmentId === null) return false;
      const result = get(sessions.sessionStateAtom(environmentId));
      const session = AsyncResult.getOrElse(result, () => null);
      return (
        result._tag !== "Failure" &&
        session !== null &&
        sessionGrantsScope(session, AuthAccessWriteScope)
      );
    }),
  );
  const command = <Input, A, Error>(
    label: string,
    execute: (
      input: Input,
      context: Effect.Success<ReturnType<typeof accessRequestContext>>,
    ) => Effect.Effect<A, Error, HttpClient.HttpClient>,
  ) => ({
    ...createEnvironmentCommand(runtime, {
      label,
      execute: Effect.fn(label)(function* (input: Input) {
        const context = yield* accessRequestContext();
        return yield* execute(input, context);
      }),
    }),
    permissionAtom,
  });
  return {
    createPairing: command(
      "environment-data:auth:create-pairing",
      (input: AuthCreatePairingCredentialInput, context) =>
        Effect.gen(function* () {
          const missing = input.scopes?.find(
            (scope) => !sessionGrantsScope(context.session, scope),
          );
          if (missing !== undefined) {
            return yield* new EnvironmentAuthorizationError({
              ...authScopeRequiredResponse(missing),
              message: "This session cannot grant the selected permissions.",
            });
          }
          return yield* executeAuthenticatedEnvironmentHttpRequest({
            ...context,
            group: "auth",
            method: "POST",
            url: (urls) => urls.pairingCredential(),
            timeoutMs: 8_000,
            request: ({ client, headers }) => client.pairingCredential({ headers, payload: input }),
          });
        }),
    ),
    revokePairing: command(
      "environment-data:auth:revoke-pairing",
      (input: AuthRevokePairingLinkInput, context) =>
        executeAuthenticatedEnvironmentHttpRequest({
          ...context,
          group: "auth",
          method: "POST",
          url: (urls) => urls.revokePairingLink(),
          timeoutMs: 8_000,
          request: ({ client, headers }) => client.revokePairingLink({ headers, payload: input }),
        }),
    ),
    revokeClient: command(
      "environment-data:auth:revoke-client",
      (input: AuthRevokeClientSessionInput, context) =>
        executeAuthenticatedEnvironmentHttpRequest({
          ...context,
          group: "auth",
          method: "POST",
          url: (urls) => urls.revokeClient(),
          timeoutMs: 8_000,
          request: ({ client, headers }) => client.revokeClient({ headers, payload: input }),
        }),
    ),
    revokeOthers: command("environment-data:auth:revoke-others", (_input: null, context) =>
      executeAuthenticatedEnvironmentHttpRequest({
        ...context,
        group: "auth",
        method: "POST",
        url: (urls) => urls.revokeOtherClients(),
        timeoutMs: 8_000,
        request: ({ client, headers }) => client.revokeOtherClients({ headers }),
      }),
    ),
  };
}
