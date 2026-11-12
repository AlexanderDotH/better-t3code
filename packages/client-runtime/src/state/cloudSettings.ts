import {
  AuthRelayReadScope,
  AuthRelayWriteScope,
  type EnvironmentCloudPreferencesRequest,
  type EnvironmentId,
  EnvironmentAuthorizationError,
  authScopeRequiredResponse,
  sessionGrantsScope,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as HttpClient from "effect/http/HttpClient";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { createEnvironmentCommand, createEnvironmentQueryAtomFamily } from "./runtime.ts";
import { createEnvironmentSessionAtoms, fetchEnvironmentSessionState } from "./session.ts";

const cloudContext = Effect.fn("clientRuntime.state.cloudSettings.context")(function* () {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared)) {
    return yield* new EnvironmentAuthorizationError({
      ...authScopeRequiredResponse(AuthRelayReadScope),
      message: "Connect to this environment to manage T3 Connect.",
    });
  }
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
  );
  return { prepared: prepared.value, signer, remoteAuthorization };
});

export function createEnvironmentCloudSettingsAtoms<R, E>(
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
        sessionGrantsScope(session, AuthRelayReadScope) &&
        sessionGrantsScope(session, AuthRelayWriteScope)
      );
    }),
  );
  const state = createEnvironmentQueryAtomFamily(runtime, {
    label: "environment-data:cloud:settings",
    staleTimeMs: 15_000,
    execute: Effect.fn("clientRuntime.state.cloudSettings.read")(function* (_input: null) {
      const context = yield* cloudContext();
      return yield* executeAuthenticatedEnvironmentHttpRequest({
        ...context,
        group: "connect",
        method: "GET",
        url: (urls) => urls.linkState(),
        timeoutMs: 8_000,
        request: ({ client, headers }) => client.linkState({ headers }),
      });
    }),
  });
  const preferences = createEnvironmentCommand(runtime, {
    label: "environment-data:cloud:preferences",
    concurrency: {
      mode: "serial",
      key: (target: {
        readonly environmentId: EnvironmentId;
        readonly input: EnvironmentCloudPreferencesRequest;
      }) => target.environmentId,
    },
    execute: Effect.fn("clientRuntime.state.cloudSettings.update")(function* (
      input: EnvironmentCloudPreferencesRequest,
      registry: AtomRegistry.AtomRegistry,
      environmentId: EnvironmentId,
    ) {
      const context = yield* cloudContext();
      const session = yield* fetchEnvironmentSessionState(context);
      for (const scope of [AuthRelayReadScope, AuthRelayWriteScope]) {
        if (!sessionGrantsScope(session, scope)) {
          return yield* new EnvironmentAuthorizationError({
            ...authScopeRequiredResponse(scope),
            message: "This connection cannot manage T3 Connect.",
          });
        }
      }
      return yield* executeAuthenticatedEnvironmentHttpRequest({
        ...context,
        group: "connect",
        method: "POST",
        url: (urls) => urls.preferences(),
        timeoutMs: 8_000,
        request: ({ client, headers }) => client.preferences({ headers, payload: input }),
      }).pipe(
        Effect.ensuring(Effect.sync(() => registry.refresh(state({ environmentId, input: null })))),
      );
    }),
  });
  return { state, preferences: { ...preferences, permissionAtom } };
}
