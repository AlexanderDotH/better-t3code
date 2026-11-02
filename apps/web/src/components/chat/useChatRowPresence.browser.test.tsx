import { RunId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import {
  ChatRowMotionContext,
  ChatTimelineRowMotion,
  useChatRowPresence,
} from "./useChatRowPresence";

const time = "2026-10-27T12:00:00Z";
const fold = (expanded: boolean): MessagesTimelineRow => ({
  kind: "turn-fold",
  id: "fold",
  runId: RunId.make("turn"),
  createdAt: time,
  label: "Worked for 1m",
  expanded,
});
const detail: MessagesTimelineRow = { kind: "thinking", id: "detail", createdAt: time };

function Harness({
  source,
  identity = "thread",
  enabled = true,
}: {
  source: MessagesTimelineRow[];
  identity?: string;
  enabled?: boolean;
}) {
  const state = useChatRowPresence(source, identity, enabled);
  return (
    <ChatRowMotionContext value={state}>
      {state.rows.map((row) => (
        <ChatTimelineRowMotion key={row.id} id={row.id} className="">
          <span data-row={row.id}>{row.id}</span>
        </ChatTimelineRowMotion>
      ))}
    </ChatRowMotionContext>
  );
}

it("retains closing rows, reverses without remounting, and releases them after collapse", async () => {
  const expanded = [fold(true), detail];
  const collapsed = [fold(false)];
  await using screen = await render(<Harness source={expanded} />);
  using _timers = fakeTimers();
  const detailNode = screen.container.querySelector('[data-row="detail"]')!;
  await screen.rerender(<Harness source={collapsed} />);
  expect(detailNode.isConnected).toBe(true);
  expect(detailNode.closest("[inert]")).not.toBeNull();
  await act(() => {
    vi.advanceTimersByTime(100);
  });
  await screen.rerender(<Harness source={expanded} />);
  expect(screen.container.querySelector('[data-row="detail"]')).toBe(detailNode);
  expect(detailNode.closest("[inert]")).toBeNull();
  await act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(detailNode.isConnected).toBe(true);
  await screen.rerender(<Harness source={collapsed} />);
  await act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(detailNode.isConnected).toBe(false);
});

it("never carries exiting rows into a different thread or disabled motion", async () => {
  const expanded = [fold(true), detail];
  const collapsed = [fold(false)];
  await using screen = await render(<Harness source={expanded} />);
  using _timers = fakeTimers();
  await screen.rerender(<Harness source={collapsed} />);
  await screen.rerender(<Harness source={collapsed} identity="other" />);
  expect(screen.container.querySelector('[data-row="detail"]')).toBeNull();
  await screen.rerender(<Harness source={expanded} identity="other" />);
  await screen.rerender(<Harness source={collapsed} identity="other" enabled={false} />);
  expect(screen.container.querySelector('[data-row="detail"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
