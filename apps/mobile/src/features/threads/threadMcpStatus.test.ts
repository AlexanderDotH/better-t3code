import {
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
  type McpRuntimeContext,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { selectThreadMcpContext, threadMcpStatus } from "./threadMcpStatus";

it("keeps unknown tool inventory distinct from zero and flags auth and setup failures", () => {
  expect(
    threadMcpStatus([
      { state: "connected", authState: "none", toolCount: 0 },
      { state: "failed", authState: "required", toolCount: undefined },
      { state: "setup-required", authState: "none", toolCount: 2 },
    ]),
  ).toEqual({ connected: 1, attention: 2, tools: null });
  expect(
    threadMcpStatus([
      { state: "disabled", authState: "none", toolCount: 0 },
      { state: "connected", authState: "authenticated", toolCount: 3 },
    ]),
  ).toEqual({ connected: 1, attention: 0, tools: 3 });
});

it("selects only this thread's current session and falls back to its latest ended session", () => {
  const threadId = ThreadId.make("this-thread");
  const context: McpRuntimeContext = {
    providerInstanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    threadId,
    runtimeSessionId: RuntimeSessionId.make("active"),
    state: "active",
    updatedAt: "2026-11-10T10:00:00Z",
  };
  const ended = {
    ...context,
    state: "inactive" as const,
    runtimeSessionId: RuntimeSessionId.make("ended"),
    updatedAt: "2026-11-11T10:00:00Z",
  };
  const other = { ...ended, threadId: ThreadId.make("other-thread"), state: "active" as const };
  expect(selectThreadMcpContext([ended, other, context], threadId)?.runtimeSessionId).toBe(
    "active",
  );
  expect(selectThreadMcpContext([ended, other], threadId)?.runtimeSessionId).toBe("ended");
  expect(selectThreadMcpContext([other], threadId)).toBeNull();
});
