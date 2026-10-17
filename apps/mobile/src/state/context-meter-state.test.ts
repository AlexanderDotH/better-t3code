import { EventId, ThreadId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  selectedThreadContextWindowSnapshot,
  visibleContextWindowSnapshot,
} from "./context-meter-state";

const firstThread = ThreadId.make("thread-one");
const secondThread = ThreadId.make("thread-two");
const usage = (usedTokens: number): OrchestrationThreadActivity[] => [
  {
    id: EventId.make("context-usage"),
    kind: "context-window.updated",
    tone: "info",
    summary: "Context usage",
    payload: { usedTokens, maxTokens: 100_000 },
    turnId: null,
    createdAt: "2026-10-15T12:00:00.000Z",
  },
];

describe("mobile context meter selection", () => {
  it("clears the previous thread while a new selection waits for its detail", () => {
    const firstUsage = usage(25_000);
    expect(
      selectedThreadContextWindowSnapshot(firstThread, firstThread, firstUsage)?.usedTokens,
    ).toBe(25_000);
    expect(selectedThreadContextWindowSnapshot(secondThread, firstThread, firstUsage)).toBeNull();
    expect(selectedThreadContextWindowSnapshot(secondThread, undefined, undefined)).toBeNull();
    expect(
      selectedThreadContextWindowSnapshot(secondThread, secondThread, usage(70_000))?.usedTokens,
    ).toBe(70_000);
    expect(selectedThreadContextWindowSnapshot(undefined, secondThread, usage(70_000))).toBeNull();
  });

  it("hides retained usage while loading, then uses the current thread's sample", () => {
    const previous = selectedThreadContextWindowSnapshot(firstThread, firstThread, usage(25_000));
    expect(visibleContextWindowSnapshot(previous, { enabled: true, loading: true })).toBeNull();
    const current = selectedThreadContextWindowSnapshot(secondThread, secondThread, usage(70_000));
    expect(
      visibleContextWindowSnapshot(current, { enabled: true, loading: false })?.usedTokens,
    ).toBe(70_000);
  });

  it("honors the disabled setting and stays hidden before the provider reports usage", () => {
    const snapshot = selectedThreadContextWindowSnapshot(firstThread, firstThread, usage(0));
    expect(visibleContextWindowSnapshot(snapshot, { enabled: false, loading: false })).toBeNull();
    expect(visibleContextWindowSnapshot(null, { enabled: true, loading: false })).toBeNull();
    expect(
      visibleContextWindowSnapshot(snapshot, { enabled: true, loading: false })?.usedTokens,
    ).toBe(0);
    expect(selectedThreadContextWindowSnapshot(firstThread, firstThread, [])).toBeNull();
  });
});
