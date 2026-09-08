import {
  ProviderInstanceId,
  ProviderDriverKind,
  RuntimeSessionId,
  ThreadId,
  type McpRuntimeContext,
  type McpRuntimeContextChange,
  type McpRuntimeContextSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyMcpRuntimeContextChange } from "./contextProjection.ts";

const providerInstanceId = ProviderInstanceId.make("codex-work");

function context(
  thread: string,
  runtime: string,
  overrides: Partial<McpRuntimeContext> = {},
): McpRuntimeContext {
  return {
    providerInstanceId,
    driver: ProviderDriverKind.make("codex"),
    threadId: ThreadId.make(thread),
    runtimeSessionId: RuntimeSessionId.make(runtime),
    state: "active",
    updatedAt: "2026-08-03T10:00:00.000Z",
    ...overrides,
  };
}

function snapshot(
  revision: number,
  contexts: readonly McpRuntimeContext[],
  observedAt = "2026-08-03T10:00:00.000Z",
): McpRuntimeContextSnapshot {
  return { providerInstanceId, revision, observedAt, contexts };
}

describe("MCP provider context projection", () => {
  it("requires an authoritative provider snapshot before lifecycle deltas", () => {
    const change: McpRuntimeContextChange = {
      type: "context-upserted",
      revision: 1,
      observedAt: "2026-08-03T10:00:01.000Z",
      context: context("thread-one", "runtime-one"),
    };

    expect(applyMcpRuntimeContextChange(null, change, providerInstanceId)).toBeNull();
  });

  it("accumulates context start, replacement, and end lifecycle changes", () => {
    const original = context("thread-one", "runtime-one");
    const started = applyMcpRuntimeContextChange(
      snapshot(1, [original]),
      {
        type: "context-upserted",
        revision: 2,
        observedAt: "2026-08-03T10:00:02.000Z",
        context: context("thread-one", "runtime-two"),
      },
      providerInstanceId,
    );
    const ended = applyMcpRuntimeContextChange(
      started,
      {
        type: "context-removed",
        revision: 3,
        observedAt: "2026-08-03T10:00:03.000Z",
        threadId: original.threadId,
        runtimeSessionId: original.runtimeSessionId,
      },
      providerInstanceId,
    );

    expect(ended?.revision).toBe(3);
    expect(ended?.contexts).toEqual([context("thread-one", "runtime-two")]);
  });

  it("rejects stale lifecycle changes and another provider account", () => {
    const current = snapshot(4, [context("thread-one", "runtime-one")], "2026-08-03T10:00:04.000Z");

    expect(
      applyMcpRuntimeContextChange(
        current,
        {
          type: "context-removed",
          revision: 4,
          observedAt: "2026-08-03T10:00:05.000Z",
          threadId: ThreadId.make("thread-one"),
          runtimeSessionId: RuntimeSessionId.make("runtime-one"),
        },
        providerInstanceId,
      ),
    ).toBe(current);
    expect(
      applyMcpRuntimeContextChange(
        current,
        {
          type: "context-upserted",
          revision: 5,
          observedAt: "2026-08-03T10:00:05.000Z",
          context: context("thread-two", "runtime-two", {
            providerInstanceId: ProviderInstanceId.make("codex-personal"),
          }),
        },
        providerInstanceId,
      ),
    ).toBe(current);
  });

  it("replaces accumulated contexts with an equal-revision newer snapshot", () => {
    const current = snapshot(4, [context("thread-one", "runtime-one")], "2026-08-03T10:00:04.000Z");
    const replacement = snapshot(
      4,
      [context("thread-two", "runtime-two")],
      "2026-08-03T10:00:05.000Z",
    );

    expect(
      applyMcpRuntimeContextChange(
        current,
        { type: "snapshot", snapshot: replacement },
        providerInstanceId,
      ),
    ).toBe(replacement);
  });

  it("rejects an older authoritative provider snapshot", () => {
    const current = snapshot(4, [context("thread-one", "runtime-one")], "2026-08-03T10:00:04.000Z");
    const stale = snapshot(3, [context("thread-two", "runtime-two")], "2026-08-03T10:00:03.000Z");

    expect(
      applyMcpRuntimeContextChange(
        current,
        { type: "snapshot", snapshot: stale },
        providerInstanceId,
      ),
    ).toBe(current);
  });

  it("accepts a lower-revision provider snapshot from a newer server epoch", () => {
    const current = snapshot(
      12,
      [context("thread-one", "runtime-one")],
      "2026-08-03T10:00:12.000Z",
    );
    const replacement = snapshot(
      1,
      [context("thread-two", "runtime-two")],
      "2026-08-03T10:01:00.000Z",
    );

    expect(
      applyMcpRuntimeContextChange(
        current,
        { type: "snapshot", snapshot: replacement },
        providerInstanceId,
      ),
    ).toBe(replacement);
  });
});
