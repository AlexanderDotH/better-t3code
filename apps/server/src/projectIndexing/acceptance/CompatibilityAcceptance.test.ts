import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  DEFAULT_PROJECT_INDEX_SETTINGS,
  EnvironmentAuthenticatedPrincipal,
  ExecutionEnvironmentCapabilities,
  ProjectIndexScopeInput,
  ProjectIndexSettings,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { projectIndexingSupported } from "../../../../../packages/client-runtime/src/projectIndexing.ts";
import { requireEnvironmentScope } from "../../auth/http.ts";
import { requiredScopeForRpcMethod } from "../../auth/RpcAuthorization.ts";
const decodeCapabilities = Schema.decodeSync(ExecutionEnvironmentCapabilities);
const decodeSettings = Schema.decodeSync(ProjectIndexSettings);
const decodeScope = Schema.decodeUnknownSync(ProjectIndexScopeInput);
const { projectIndexingVersion: _newField, ...legacyFields } =
  ExecutionEnvironmentCapabilities.fields;
const decodeLegacyCapabilities = Schema.decodeSync(Schema.Struct(legacyFields));

it("gates static indexing on the new capability while old clients still decode the environment", () => {
  const oldServer = decodeCapabilities({});
  expect(projectIndexingSupported(oldServer)).toBe(false);
  expect(decodeSettings({})).toEqual(DEFAULT_PROJECT_INDEX_SETTINGS);
  expect(projectIndexingSupported(decodeCapabilities({ projectIndexingVersion: 1 }))).toBe(false);
  expect(projectIndexingSupported(decodeCapabilities({ projectIndexingVersion: 2 }))).toBe(false);
  const newServer = decodeCapabilities({ projectIndexingVersion: 3 });
  expect(projectIndexingSupported(newServer)).toBe(true);
  const oldClient = decodeLegacyCapabilities(newServer);
  expect(oldClient).not.toHaveProperty("projectIndexingVersion");
  expect(oldClient.repositoryIdentity).toBe(newServer.repositoryIdentity);
  expect(oldClient.midChatProviderSwitching).toBe(newServer.midChatProviderSwitching);
});

it("accepts identity-based scope selection and rejects a client-selected filesystem root", () => {
  expect(decodeScope({ projectId: "synthetic-project" })).toMatchObject({
    projectId: "synthetic-project",
  });
  expect(() =>
    decodeScope({ projectId: "synthetic-project", workspaceRoot: "/another-workspace" }),
  ).toThrow();
});

it.effect("enforces the real authorization policy for every indexing RPC", () =>
  Effect.gen(function* () {
    const reader = {
      sessionId: AuthSessionId.make("synthetic-reader"),
      subject: "synthetic-reader",
      method: "bearer-access-token" as const,
      scopes: new Set([AuthOrchestrationReadScope]),
    };
    for (const method of [
      WS_METHODS.projectIndexGetSettings,
      WS_METHODS.projectIndexGetStatus,
      WS_METHODS.projectIndexSubscribe,
      WS_METHODS.projectIndexQuery,
      WS_METHODS.projectIndexCheckModel,
    ]) {
      const scope = requiredScopeForRpcMethod(method);
      expect(scope).toBe(AuthOrchestrationReadScope);
      expect(
        yield* requireEnvironmentScope(scope).pipe(
          Effect.provideService(EnvironmentAuthenticatedPrincipal, reader),
        ),
      ).toBe(reader);
    }
    for (const method of [
      WS_METHODS.projectIndexUpdateSettings,
      WS_METHODS.projectIndexStart,
      WS_METHODS.projectIndexControl,
      WS_METHODS.projectIndexReview,
    ]) {
      const scope = requiredScopeForRpcMethod(method);
      expect(scope).toBe(AuthOrchestrationOperateScope);
      const denied = yield* requireEnvironmentScope(scope).pipe(
        Effect.provideService(EnvironmentAuthenticatedPrincipal, reader),
        Effect.flip,
      );
      expect(denied.code).toBe("insufficient_scope");
      expect(denied.requiredScope).toBe(AuthOrchestrationOperateScope);
      const writer = {
        ...reader,
        scopes: new Set([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]),
      };
      expect(
        yield* requireEnvironmentScope(scope).pipe(
          Effect.provideService(EnvironmentAuthenticatedPrincipal, writer),
        ),
      ).toBe(writer);
    }
  }),
);
