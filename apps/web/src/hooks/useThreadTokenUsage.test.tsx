import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { useThreadTokenUsage } from "./useThreadTokenUsage";

function activities(inputTokens: number): readonly OrchestrationThreadActivity[] {
  return [
    {
      id: EventId.make(`usage-${inputTokens}`),
      kind: "context-window.updated",
      turnId: null,
      createdAt: "2026-09-14T10:00:00.000Z",
      tone: "info",
      summary: "Usage updated",
      payload: { usedTokens: inputTokens, inputTokens },
    },
  ];
}

it("prepares usage after urgent renders, retains the latest counts, and never leaks them across threads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const renderedCounts: Array<number | undefined> = [];
  function Harness(props: {
    threadKey: string;
    activities: readonly OrchestrationThreadActivity[];
  }) {
    const usage = useThreadTokenUsage(props.threadKey, props.activities);
    renderedCounts.push(usage?.inputTokens);
    return <output>{usage?.inputTokens}</output>;
  }

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <Harness threadKey="environment-a/thread-a" activities={activities(100)} />,
      );
    });
    expect(renderedCounts[0]).toBeUndefined();
    expect(renderedCounts.at(-1)).toBe(100);

    renderedCounts.length = 0;
    await act(() =>
      renderer!.update(<Harness threadKey="environment-a/thread-a" activities={activities(200)} />),
    );
    expect(renderedCounts[0]).toBe(100);
    expect(renderedCounts.at(-1)).toBe(200);

    renderedCounts.length = 0;
    await act(() =>
      renderer!.update(<Harness threadKey="environment-b/thread-a" activities={activities(300)} />),
    );
    expect(renderedCounts[0]).toBeUndefined();
    expect(renderedCounts.at(-1)).toBe(300);
    expect(renderedCounts).not.toContain(200);
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
