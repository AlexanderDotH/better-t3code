import { assert, it } from "@effect/vitest";
import {
  McpServerDefinition,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { ProviderHost } from "@t3tools/provider-core/server/ProviderHost";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { nativeProviderTestLayer } from "../testUtils/nativeProviderV2.ts";
import { makeNativeProviderMcpRuntime } from "./NativeProviderMcpRuntime.ts";

const server = Schema.decodeSync(McpServerDefinition)({
  id: "docs",
  name: "Docs",
  enabled: true,
  scope: "global",
  providerRouting: { mode: "all" },
  transport: "http",
  url: "https://mcp.example.test",
  headers: { Authorization: { value: "Bearer private-token", sensitive: true } },
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
it.layer(nativeProviderTestLayer)("Native V2 MCP runtime", (it) => {
  it.effect(
    "fences inventory by runtime identity and applies configuration after active tool work settles",
    () =>
      Effect.gen(function* () {
        const host = yield* ProviderHost;
        const threadId = ThreadId.make("mcp-thread");
        const instanceId = ProviderInstanceId.make("openai-work");
        const runtimeSessionId = RuntimeSessionId.make("v2-session");
        let activeSessionId = runtimeSessionId;
        let running = false;
        let released = 0;
        const controller = makeNativeProviderMcpRuntime({
          driver: ProviderDriverKind.make("openai"),
          instanceId,
          host,
          configuration: {
            includeT3BuiltIn: false,
            resolveServers: () => Effect.succeed([server]),
          },
          findSession: (id) =>
            id === threadId
              ? { runtimeSessionId: activeSessionId, cwd: "/workspace", isRunning: () => running }
              : undefined,
          releaseThread: () =>
            Effect.sync(() => {
              released++;
            }),
        });
        const target = { providerInstanceId: instanceId, threadId, runtimeSessionId };
        const inventory = yield* controller.adapter.getSnapshot(target);
        assert.equal(inventory[0]?.serverId, "docs");
        assert.isFalse(encodeJson(inventory).includes("private-token"));
        assert.deepEqual(inventory[0]?.availableActions, ["refresh"]);
        const stale = yield* controller.adapter
          .getSnapshot({ ...target, runtimeSessionId: RuntimeSessionId.make("replaced") })
          .pipe(Effect.flip);
        assert.equal(stale._tag, "ProviderAdapterProtocolError");
        running = true;
        assert.equal(yield* controller.adapter.applyConfiguration!(target), "pending-next-session");
        assert.equal(released, 0);
        running = false;
        assert.isTrue(yield* controller.settle(threadId));
        assert.equal(released, 1);
        assert.isFalse(yield* controller.settle(threadId));
        assert.equal(yield* controller.adapter.applyConfiguration!(target), "applied");
        assert.equal(released, 2);
        running = true;
        yield* controller.adapter.applyConfiguration!(target);
        activeSessionId = RuntimeSessionId.make("replacement-session");
        assert.isFalse(yield* controller.settle(threadId));
        assert.equal(released, 2);
      }),
  );
});
