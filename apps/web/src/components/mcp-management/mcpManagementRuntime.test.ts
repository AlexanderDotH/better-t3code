import type {
  McpRuntimeContext,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectMcpRuntimeContext, shouldSubscribeMcpRuntime } from "./mcpManagementRuntime";

function runtimeContext(
  runtimeSessionId: string,
  state: McpRuntimeContext["state"] = "inactive",
): McpRuntimeContext {
  return {
    providerInstanceId: "codex" as ProviderInstanceId,
    driver: "codex" as McpRuntimeContext["driver"],
    threadId: "thread-1" as ThreadId,
    runtimeSessionId: runtimeSessionId as RuntimeSessionId,
    state,
    updatedAt: "2026-08-03T12:00:00.000Z",
  };
}

describe("selectMcpRuntimeContext", () => {
  const contexts = [runtimeContext("runtime-old"), runtimeContext("runtime-live", "active")];

  it("keeps an exact manually selected session without retargeting it", () => {
    expect(
      selectMcpRuntimeContext({
        contexts,
        selectedContextId: "thread-1:runtime-old",
      })?.runtimeSessionId,
    ).toBe("runtime-old");
  });

  it("does not retarget after a manually selected session vanishes", () => {
    expect(
      selectMcpRuntimeContext({
        contexts,
        selectedContextId: "thread-1:runtime-vanished",
      }),
    ).toBeUndefined();
  });

  it("uses the exact deep-linked runtime before the active-session fallback", () => {
    expect(
      selectMcpRuntimeContext({
        contexts,
        selectedContextId: null,
        preferredThreadId: "thread-1",
        preferredRuntimeSessionId: "runtime-old",
      })?.runtimeSessionId,
    ).toBe("runtime-old");
  });

  it("falls back to the active session and returns undefined after it vanishes", () => {
    expect(selectMcpRuntimeContext({ contexts, selectedContextId: null })?.runtimeSessionId).toBe(
      "runtime-live",
    );
    expect(selectMcpRuntimeContext({ contexts: [], selectedContextId: null })).toBeUndefined();
  });

  it("does not retarget when an exact preferred runtime has ended", () => {
    expect(
      selectMcpRuntimeContext({
        contexts,
        selectedContextId: null,
        preferredThreadId: "thread-1",
        preferredRuntimeSessionId: "runtime-ended",
        requirePreferredExact: true,
      }),
    ).toBeUndefined();
  });
});

describe("shouldSubscribeMcpRuntime", () => {
  it("never calls new runtime streams on an older server", () => {
    expect(
      shouldSubscribeMcpRuntime({ workspaceVersion: undefined, providerInstanceId: "codex" }),
    ).toBe(false);
    expect(shouldSubscribeMcpRuntime({ workspaceVersion: 1, providerInstanceId: "codex" })).toBe(
      true,
    );
    expect(shouldSubscribeMcpRuntime({ workspaceVersion: 2, providerInstanceId: "codex" })).toBe(
      true,
    );
  });
});
