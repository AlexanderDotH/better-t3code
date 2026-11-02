import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  McpRuntimeServerKey,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import type { OpenCodeMcpServerConfig } from "@t3tools/provider-core/server/mcpConfiguration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as OpenCodeMcpRuntime from "./OpenCodeMcpRuntime.ts";

const instanceId = ProviderInstanceId.make("opencode");
const driver = ProviderDriverKind.make("opencode");
const threadId = ThreadId.make("thread");
const providerSessionId = ProviderSessionId.make("runtime-1");
const target = {
  providerInstanceId: instanceId,
  threadId,
  runtimeSessionId: RuntimeSessionId.make(providerSessionId),
};
const docs = McpRuntimeServerKey.make("docs");

const session = (
  overrides: Partial<OpenCodeMcpRuntime.OpenCodeMcpSession> = {},
): OpenCodeMcpRuntime.OpenCodeMcpSession => ({
  threadId,
  providerSessionId,
  cwd: "/project",
  model: "model",
  runtimeMode: "full-access",
  configured: () => ({}),
  setConfigured: () => undefined,
  resolveConfiguration: Effect.succeed({}),
  builtInNames: new Set(),
  client: {
    statuses: Effect.succeed([{ name: "docs", status: "connected", canAuthorize: false }]),
    reconnect: () => Effect.void,
    applyConfiguration: () => Effect.void,
  },
  ...overrides,
});

it.layer(TestProviderHost.layer().pipe(Layer.provideMerge(NodeServices.layer)))(
  "OpenCode MCP live runtime",
  (it) => {
    it.effect(
      "keeps source and resource metadata without exposing configuration secrets or inventing tool inventory",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const live = yield* OpenCodeMcpRuntime.make(
              yield* ProviderHost.ProviderHost,
              instanceId,
              driver,
            );
            yield* live.attach(
              session({
                builtInNames: new Set(["t3-code"]),
                configured: () => ({
                  docs: {
                    type: "remote",
                    url: "https://docs.invalid",
                    headers: { Authorization: "private-token" },
                  },
                  missing: { type: "local", command: ["private-command"], enabled: false },
                }),
                client: {
                  statuses: Effect.succeed([
                    { name: "t3-code", status: "connected", canAuthorize: false },
                    { name: "docs", status: "needs_auth", canAuthorize: true },
                    { name: "native", status: "pending", canAuthorize: false },
                  ]),
                  details: () =>
                    Effect.succeed({
                      resources: [{ name: "Guide", uri: "docs://guide" }],
                      templates: [{ name: "Document", uriTemplate: "docs://{id}" }],
                    }),
                  reconnect: () => Effect.void,
                  applyConfiguration: () => Effect.void,
                },
              }),
            );
            const snapshot = yield* live.adapter.mcpRuntime.getSnapshot(target);
            assert.deepEqual(
              snapshot.map((server) => [server.providerKey, server.source, server.state]),
              [
                ["t3-code", "t3-built-in", "connected"],
                ["docs", "t3-managed", "auth-required"],
                ["native", "provider-native", "starting"],
                ["missing", "t3-managed", "disabled"],
              ],
            );
            assert.isFalse(snapshot.some((server) => server.reportsTools));
            assert.notInclude(JSON.stringify(snapshot), "private-token");
            assert.notInclude(JSON.stringify(snapshot), "private-command");
            const details = yield* live.adapter.mcpRuntime.getServerDetails({
              ...target,
              providerKey: docs,
            });
            assert.deepEqual(details.resources, [{ name: "Guide", uri: "docs://guide" }]);
            assert.deepEqual(details.templates, [{ name: "Document", uriTemplate: "docs://{id}" }]);
            assert.deepEqual(details.tools, []);
          }),
        ),
    );

    it.effect("authorizes supported servers and replaces only the managed configuration", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const calls: string[] = [];
          let managed: Readonly<Record<string, OpenCodeMcpServerConfig>> = {
            removed: { type: "local", command: ["old"] },
          };
          const next = { docs: { type: "remote" as const, url: "https://docs.invalid" } };
          const live = yield* OpenCodeMcpRuntime.make(
            yield* ProviderHost.ProviderHost,
            instanceId,
            driver,
          );
          yield* live.attach(
            session({
              configured: () => managed,
              setConfigured: (value) => {
                managed = value;
              },
              resolveConfiguration: Effect.succeed(next),
              client: {
                statuses: Effect.succeed([
                  { name: "docs", status: "needs_auth", canAuthorize: true },
                ]),
                reconnect: (_name, current) =>
                  current.pipe(Effect.tap(() => Effect.sync(() => calls.push("reconnect")))),
                authorize: () => Effect.succeed("https://auth.invalid/authorize?state=opaque"),
                applyConfiguration: (requested, previous) =>
                  Effect.sync(() => {
                    assert.deepEqual(requested, next);
                    assert.deepEqual(Object.keys(previous), ["removed"]);
                    calls.push("apply");
                  }),
              },
            }),
          );
          assert.equal(
            (yield* live.adapter.mcpRuntime.runAction({
              ...target,
              providerKey: docs,
              action: "authorize",
            })).authorizationUrl,
            "https://auth.invalid/authorize?state=opaque",
          );
          yield* live.adapter.mcpRuntime.runAction({
            ...target,
            providerKey: docs,
            action: "reconnect",
          });
          yield* live.adapter.mcpRuntime.applyConfiguration(target);
          assert.deepEqual(calls, ["reconnect", "apply"]);
          assert.deepEqual(managed, next);
          assert.isTrue(
            Result.isFailure(
              yield* live.adapter.mcpRuntime
                .getSnapshot({ ...target, providerInstanceId: ProviderInstanceId.make("other") })
                .pipe(Effect.result),
            ),
          );
        }),
      ),
    );

    it.effect("rejects stale reads and keeps registration alive when an older session closes", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* ProviderHost.ProviderHost;
          const factory = yield* Effect.acquireRelease(Scope.make(), (scope) =>
            Scope.close(scope, Exit.void),
          );
          const firstScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
            Scope.close(scope, Exit.void),
          );
          const nextScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
            Scope.close(scope, Exit.void),
          );
          const started = yield* Deferred.make<void>();
          const finish = yield* Deferred.make<void>();
          let registered = 0;
          const registeredSessions: string[] = [];
          const live = yield* OpenCodeMcpRuntime.make(
            {
              ...host,
              mcpRuntime: {
                registerAdapter: () =>
                  Effect.acquireRelease(
                    Effect.sync(() => {
                      registered++;
                    }),
                    () =>
                      Effect.sync(() => {
                        registered--;
                      }),
                  ),
                registerSession: (registeredSession) =>
                  Effect.sync(() => {
                    registeredSessions.push(registeredSession.runtimeSessionId ?? "");
                  }),
                endSession: () => Effect.void,
              },
            },
            instanceId,
            driver,
          ).pipe(Effect.provideService(Scope.Scope, factory));
          yield* live
            .attach(
              session({
                client: {
                  ...session().client,
                  statuses: Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Deferred.await(finish)),
                    Effect.as([
                      { name: "docs", status: "connected" as const, canAuthorize: false },
                    ]),
                  ),
                },
              }),
            )
            .pipe(Effect.provideService(Scope.Scope, firstScope));
          const loading = yield* live.adapter.mcpRuntime
            .getSnapshot(target)
            .pipe(Effect.result, Effect.forkChild);
          yield* Deferred.await(started);
          const replacement = ProviderSessionId.make("runtime-2");
          yield* live
            .attach(session({ providerSessionId: replacement }))
            .pipe(Effect.provideService(Scope.Scope, nextScope));
          assert.deepEqual(registeredSessions, [providerSessionId, replacement]);
          yield* Scope.close(firstScope, Exit.void);
          yield* Deferred.succeed(finish, undefined);
          assert.isTrue(Result.isFailure(yield* Fiber.join(loading)));
          assert.equal(registered, 1);
          assert.equal(
            (yield* live.adapter.mcpRuntime.getSnapshot({
              ...target,
              runtimeSessionId: RuntimeSessionId.make(replacement),
            })).length,
            1,
          );
          yield* live.detach(threadId, replacement);
          assert.isTrue(
            Result.isFailure(
              yield* live.adapter.mcpRuntime
                .getSnapshot({ ...target, runtimeSessionId: RuntimeSessionId.make(replacement) })
                .pipe(Effect.result),
            ),
          );
          yield* live
            .attach(session({ providerSessionId: replacement }))
            .pipe(Effect.provideService(Scope.Scope, nextScope));
          assert.equal(
            (yield* live.adapter.mcpRuntime.getSnapshot({
              ...target,
              runtimeSessionId: RuntimeSessionId.make(replacement),
            })).length,
            1,
          );
          yield* Scope.close(nextScope, Exit.void);
          assert.isTrue(
            Result.isFailure(
              yield* live.adapter.mcpRuntime
                .getSnapshot({ ...target, runtimeSessionId: RuntimeSessionId.make(replacement) })
                .pipe(Effect.result),
            ),
          );
          yield* Scope.close(factory, Exit.void);
          assert.equal(registered, 0);
        }),
      ),
    );
  },
);
