import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RuntimeSessionId,
  ThreadId,
  type ProviderSession,
} from "@t3tools/contracts";
import type { ProviderAdapterShape } from "@t3tools/provider-core/server/mcpRuntime";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { McpRuntimeRegistry } from "../mcp/McpRuntimeRegistry.ts";
import { providerMcpRuntime } from "./ProviderHostLive.ts";

const instanceId = ProviderInstanceId.make("opencode-work");
const threadId = ThreadId.make("opencode-thread");
const v2SessionId = ProviderSessionId.make("actual-v2-session");
const target = {
  providerInstanceId: instanceId,
  threadId,
  runtimeSessionId: RuntimeSessionId.make(v2SessionId),
};
const session: ProviderSession = {
  ...target,
  provider: ProviderDriverKind.make("opencode"),
  status: "ready",
  runtimeMode: "auto",
  cwd: "/workspace",
  createdAt: "2026-11-02T12:00:00Z",
  updatedAt: "2026-11-02T12:00:00Z",
};
const adapter: ProviderAdapterShape<Error> = {
  capabilities: { mcp: "sessionConfig" },
  mcpRuntime: { getSnapshot: () => Effect.succeed([]) },
};

it.effect(
  "resolves the active registry at invocation while retaining the adapter's owner scope and V2 session identity",
  () =>
    Effect.gen(function* () {
      const owner = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const observed: string[] = [];
      const registry = Layer.mock(McpRuntimeRegistry)({
        registerAdapter: (id, runtime) =>
          Effect.gen(function* () {
            expect(id).toBe(instanceId);
            expect(runtime).toBe(adapter);
            expect(yield* Scope.Scope).toBe(owner);
            observed.push("adapter");
          }),
        registerSession: (current) =>
          Effect.sync(() => {
            expect(current).toBe(session);
            observed.push("session");
          }),
        endSession: (current) =>
          Effect.sync(() => {
            expect(current).toBe(target);
            observed.push("end");
          }),
      });
      yield* Effect.gen(function* () {
        yield* providerMcpRuntime
          .registerAdapter(instanceId, adapter)
          .pipe(Effect.provideService(Scope.Scope, owner));
        yield* providerMcpRuntime.registerSession(session);
        yield* providerMcpRuntime.endSession(target);
      }).pipe(Effect.provide(registry));
      expect(observed).toEqual(["adapter", "session", "end"]);
    }),
);

it.effect("refuses to discard a live MCP session when its registry is missing", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(providerMcpRuntime.registerSession(session));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result))
      expect(Cause.pretty(result.cause)).toContain("active server registry");
  }),
);
