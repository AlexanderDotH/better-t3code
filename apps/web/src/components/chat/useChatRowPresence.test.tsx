// @vitest-environment jsdom
import { TurnId } from "@t3tools/contracts";
import { act, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
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
  turnId: TurnId.make("turn"),
  createdAt: time,
  label: "Worked for 1m",
  expanded,
});
const detail: MessagesTimelineRow = { kind: "thinking", id: "detail", createdAt: time };
function Harness({
  expanded,
  identity = "thread",
  enabled = true,
}: {
  expanded: boolean;
  identity?: string;
  enabled?: boolean;
}) {
  const source = useMemo(() => (expanded ? [fold(true), detail] : [fold(false)]), [expanded]);
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
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("retains closing rows, reverses without remounting, and releases them after collapse", async () => {
  await act(() => root.render(<Harness expanded />));
  const detailNode = container.querySelector('[data-row="detail"]')!;
  await act(() => root.render(<Harness expanded={false} />));
  expect(detailNode.isConnected).toBe(true);
  expect(detailNode.closest("[inert]")).not.toBeNull();
  await act(() => vi.advanceTimersByTime(100));
  await act(() => root.render(<Harness expanded />));
  expect(container.querySelector('[data-row="detail"]')).toBe(detailNode);
  expect(detailNode.closest("[inert]")).toBeNull();
  await act(() => vi.advanceTimersByTime(300));
  expect(detailNode.isConnected).toBe(true);
  await act(() => root.render(<Harness expanded={false} />));
  await act(() => vi.advanceTimersByTime(300));
  expect(detailNode.isConnected).toBe(false);
});

it("never carries exiting rows into a different thread or disabled motion", async () => {
  await act(() => root.render(<Harness expanded />));
  await act(() => root.render(<Harness expanded={false} />));
  await act(() => root.render(<Harness expanded={false} identity="other" />));
  expect(container.querySelector('[data-row="detail"]')).toBeNull();
  await act(() => root.render(<Harness expanded identity="other" />));
  await act(() => root.render(<Harness expanded={false} identity="other" enabled={false} />));
  expect(container.querySelector('[data-row="detail"]')).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
