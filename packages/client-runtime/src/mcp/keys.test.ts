import {
  EnvironmentId,
  McpRuntimeServerKey,
  ProviderInstanceId,
  RuntimeSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mcpProviderContextKey,
  mcpRuntimeSelectorKey,
  mcpRuntimeServerDetailsKey,
} from "./keys.ts";

const selector = {
  environmentId: EnvironmentId.make("environment-one"),
  providerInstanceId: ProviderInstanceId.make("codex-work"),
  threadId: ThreadId.make("thread-one"),
  runtimeSessionId: RuntimeSessionId.make("runtime-one"),
};

describe("MCP runtime keys", () => {
  it("separates provider context streams by environment and provider account", () => {
    const key = mcpProviderContextKey({
      environmentId: selector.environmentId,
      providerInstanceId: selector.providerInstanceId,
    });

    expect(key).not.toBe(
      mcpProviderContextKey({
        environmentId: EnvironmentId.make("environment-two"),
        providerInstanceId: selector.providerInstanceId,
      }),
    );
    expect(key).not.toBe(
      mcpProviderContextKey({
        environmentId: selector.environmentId,
        providerInstanceId: ProviderInstanceId.make("codex-personal"),
      }),
    );
  });

  it("separates every environment, provider, thread, and runtime selector", () => {
    const key = mcpRuntimeSelectorKey(selector);

    expect(key).not.toBe(
      mcpRuntimeSelectorKey({
        ...selector,
        environmentId: EnvironmentId.make("environment-two"),
      }),
    );
    expect(key).not.toBe(
      mcpRuntimeSelectorKey({
        ...selector,
        providerInstanceId: ProviderInstanceId.make("codex-personal"),
      }),
    );
    expect(key).not.toBe(
      mcpRuntimeSelectorKey({ ...selector, threadId: ThreadId.make("thread-two") }),
    );
    expect(key).not.toBe(
      mcpRuntimeSelectorKey({
        ...selector,
        runtimeSessionId: RuntimeSessionId.make("runtime-two"),
      }),
    );
  });

  it("fences server details by the complete runtime selector and provider key", () => {
    const notion = mcpRuntimeServerDetailsKey({
      ...selector,
      providerKey: McpRuntimeServerKey.make("notion"),
    });

    expect(notion).not.toBe(
      mcpRuntimeServerDetailsKey({
        ...selector,
        providerKey: McpRuntimeServerKey.make("linear"),
      }),
    );
    expect(notion).not.toBe(
      mcpRuntimeServerDetailsKey({
        ...selector,
        runtimeSessionId: RuntimeSessionId.make("runtime-two"),
        providerKey: McpRuntimeServerKey.make("notion"),
      }),
    );
  });
});
