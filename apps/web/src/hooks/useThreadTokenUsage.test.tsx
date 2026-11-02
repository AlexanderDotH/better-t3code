import { ProviderDriverKind, ProviderThreadId } from "@t3tools/contracts";
import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { makeThreadProjectionFixture } from "../test-fixtures";
import { useThreadTokenUsage } from "./useThreadTokenUsage";

function projectionWithUsage(inputTokens: number) {
  const projection = makeThreadProjectionFixture();
  const id = ProviderThreadId.make("provider-thread");
  const timestamp = DateTime.makeUnsafe("2026-09-14T10:00:00.000Z");
  return {
    ...projection,
    thread: { ...projection.thread, activeProviderThreadId: id },
    providerThreads: [
      {
        id,
        driver: ProviderDriverKind.make("codex"),
        providerInstanceId: projection.thread.providerInstanceId,
        providerSessionId: null,
        appThreadId: projection.thread.id,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "active" as const,
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        nativeMetadata: null,
        goal: null,
        contextUsage: { usedTokens: inputTokens, inputTokens },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

it("prepares usage after urgent renders, retains the latest counts, and never leaks them across threads", async () => {
  const renderedCounts: Array<number | undefined> = [];
  function Harness(props: {
    threadKey: string;
    projection: ReturnType<typeof projectionWithUsage>;
  }) {
    const usage = useThreadTokenUsage(props.threadKey, props.projection);
    useLayoutEffect(() => {
      renderedCounts.push(usage?.inputTokens);
    });
    return <output>{usage?.inputTokens}</output>;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <Harness threadKey="environment-a/thread-a" projection={projectionWithUsage(100)} />,
      );
    });
    expect(renderedCounts[0]).toBeUndefined();
    expect(renderedCounts.at(-1)).toBe(100);

    renderedCounts.length = 0;
    await act(() =>
      renderer!.update(
        <Harness threadKey="environment-a/thread-a" projection={projectionWithUsage(200)} />,
      ),
    );
    expect(renderedCounts[0]).toBe(100);
    expect(renderedCounts.at(-1)).toBe(200);

    renderedCounts.length = 0;
    await act(() =>
      renderer!.update(
        <Harness threadKey="environment-b/thread-a" projection={projectionWithUsage(300)} />,
      ),
    );
    expect(renderedCounts[0]).toBeUndefined();
    expect(renderedCounts.at(-1)).toBe(300);
    expect(renderedCounts).not.toContain(200);
  } finally {
    await act(() => renderer?.unmount());
  }
});
