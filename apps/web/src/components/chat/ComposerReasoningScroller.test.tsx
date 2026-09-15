import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import { ComposerReasoningScroller, latestReasoningEntries } from "./ComposerReasoningScroller";

vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));

const turnId = TurnId.make("current");
const entries: WorkLogEntry[] = Array.from({ length: 5 }, (_, index) => ({
  id: `reasoning-${index}`,
  turnId,
  createdAt: "2026-09-15T10:00:00Z",
  tone: "thinking",
  sourceActivityKind: "reasoning.summary",
  label: "Reasoning",
  detail: `Thought ${index}`,
}));

it("keeps only recent, nonempty provider reasoning from the active turn", () => {
  const otherEntries: WorkLogEntry[] = [
    { ...entries[0]!, turnId: TurnId.make("previous") },
    { ...entries[0]!, sourceActivityKind: "tool.started" },
    { ...entries[0]!, detail: "  " },
  ];
  expect(latestReasoningEntries([...entries, ...otherEntries], turnId)).toEqual(entries.slice(-3));
  expect(latestReasoningEntries(entries, null)).toEqual([]);
  expect(latestReasoningEntries(entries, TurnId.make("new-turn"))).toEqual([]);
});

it("follows trace updates of unchanged height while hovered or focused and clears on a new turn", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const disconnect = vi.fn();
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const viewport = {
    scrollTop: 0,
    scrollHeight: 72,
    clientHeight: 24,
    scrollTo: vi.fn(({ top }: { top: number }) => {
      viewport.scrollTop = top;
    }),
  };
  const props = {
    entries,
    turnId,
    threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") },
    environmentId: EnvironmentId.make("env"),
    cwd: undefined,
    streamingMotionEnabled: true,
  };
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<ComposerReasoningScroller {...props} />, {
        createNodeMock: ({ props: nodeProps }) =>
          (nodeProps as Record<string, unknown>)["data-composer-reasoning"] ? viewport : {},
      });
    });
    expect(viewport.scrollTop).toBe(48);
    expect(renderer!.root.findAllByType("p").map((node) => node.children.join(""))).toEqual([
      "Thought 2",
      "Thought 3",
      "Thought 4",
    ]);
    const lyrics = renderer!.root.findByProps({ "data-composer-reasoning": "true" });
    lyrics.props.onPointerEnter?.();
    lyrics.props.onFocusCapture?.();
    viewport.scrollTop = 0;
    const nextEntries = [...entries, { ...entries[4]!, id: "reasoning-5", detail: "Thought 5" }];
    await act(() =>
      renderer!.update(<ComposerReasoningScroller {...props} entries={nextEntries} />),
    );
    expect(viewport.scrollTop).toBe(48);
    expect(renderer!.root.findAllByType("p").map((node) => node.children.join(""))).toEqual([
      "Thought 3",
      "Thought 4",
      "Thought 5",
    ]);
    viewport.scrollTop = 0;
    await act(() =>
      renderer!.update(
        <ComposerReasoningScroller
          {...props}
          entries={nextEntries.map((entry) =>
            entry.id === "reasoning-5" ? { ...entry, detail: "Thought 5 continued" } : entry,
          )}
        />,
      ),
    );
    expect(viewport.scrollTop).toBe(48);
    viewport.scrollHeight = 96;
    resize();
    expect(viewport.scrollTop).toBe(72);
    await act(() =>
      renderer!.update(<ComposerReasoningScroller {...props} turnId={TurnId.make("next")} />),
    );
    expect(renderer!.toJSON()).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
