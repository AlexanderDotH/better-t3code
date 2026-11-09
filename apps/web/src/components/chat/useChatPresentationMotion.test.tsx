import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { MessageId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import type { TimelineEntry } from "../../session-logic";
import { useChatPresentationMotion } from "./useChatPresentationMotion";

function entry(id: string, second: number): Extract<TimelineEntry, { kind: "message" }> {
  const createdAt = `2026-01-01T00:00:0${second}.000Z`;
  return {
    id,
    createdAt,
    kind: "message",
    message: {
      id: MessageId.make(id),
      createdAt,
      updatedAt: createdAt,
      role: "assistant",
      text: id,
      runId: null,
      streaming: true,
    },
  };
}

it("admits the first streamed chunk before child layout effects and baselines reconnects", async () => {
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("window", {
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  });
  using cleanup = new DisposableStack();
  cleanup.defer(() => vi.unstubAllGlobals());
  const commits: { id: string; ready: boolean; initial: boolean }[] = [];
  function Harness({
    entries,
    connected = true,
    textMotion = true,
  }: {
    entries: readonly TimelineEntry[];
    connected?: boolean;
    textMotion?: boolean;
  }) {
    const motion = useChatPresentationMotion({
      identity: "thread",
      mode: "better-t3",
      enabled: true,
      textMotion,
      connected,
      entries,
      rows: [],
      viewport: null,
    });
    const id = entries.at(-1)!.id;
    return (
      <Observer
        value={{
          id,
          ready: motion.streamingMotionReady,
          initial: motion.canAnimateInitialText(id),
        }}
      />
    );
  }
  function Observer({ value }: { value: (typeof commits)[number] }) {
    useLayoutEffect(() => {
      commits.push(value);
    });
    return null;
  }
  const history = entry("history", 1);
  const first = entry("first", 2);
  const reconnected = entry("reconnected", 3);
  const afterReconnect = entry("after-reconnect", 4);
  let renderer: ReactTestRenderer | undefined;
  await using unmount = new AsyncDisposableStack();
  unmount.defer(async () => {
    await act(() => renderer?.unmount());
  });
  await act(() => {
    renderer = create(<Harness entries={[history]} />);
  });
  expect(commits[0]).toEqual({ id: "history", ready: false, initial: false });
  await act(() => renderer!.update(<Harness entries={[history, first]} />));
  expect(commits.find((value) => value.id === "first")).toEqual({
    id: "first",
    ready: true,
    initial: true,
  });
  await act(() => renderer!.update(<Harness entries={[history, first]} connected={false} />));
  await act(() => renderer!.update(<Harness entries={[history, first, reconnected]} />));
  expect(
    commits.filter((value) => value.id === "reconnected").every((value) => !value.initial),
  ).toBe(true);
  expect(commits.find((value) => value.id === "reconnected")?.ready).toBe(false);
  await act(() =>
    renderer!.update(<Harness entries={[history, first, reconnected, afterReconnect]} />),
  );
  expect(commits.find((value) => value.id === "after-reconnect")?.initial).toBe(true);
  await act(() =>
    renderer!.update(
      <Harness entries={[history, first, reconnected, afterReconnect]} textMotion={false} />,
    ),
  );
  expect(commits.at(-1)?.initial).toBe(false);
});
