import { createRef, useImperativeHandle, type RefObject } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerScrollCollapse } from "./useComposerScrollCollapse";

type CollapseInput = Parameters<typeof useComposerScrollCollapse>[0];
type CollapseController = ReturnType<typeof useComposerScrollCollapse>;

function Probe({
  input,
  controller,
}: {
  input: CollapseInput;
  controller: RefObject<CollapseController | null>;
}) {
  const collapse = useComposerScrollCollapse(input);
  useImperativeHandle(controller, () => collapse, [collapse]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());

describe("desktop composer scroll collapse", () => {
  it("restores reading space for navigation and expands at the timeline end or on editing", async () => {
    const controller = createRef<CollapseController>();
    const input: CollapseInput = {
      targetKey: "thread-a",
      isExistingThread: true,
      isMobileViewport: false,
      enabled: true,
      hasExpandedChrome: false,
      hasMultilinePrompt: false,
      timelineOverflows: true,
      getTimelineScrollableNode: () =>
        ({ scrollTop: 500, scrollHeight: 1500, clientHeight: 500 }) as HTMLElement,
      isTimelineAtLogicalEnd: () => false,
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<Probe input={input} controller={controller} />);
      });
      expect(controller.current?.isResting).toBe(false);
      await act(() => controller.current?.collapseForTimelineScrollKey("PageUp"));
      expect(controller.current?.isResting).toBe(true);
      await act(() => controller.current?.restoreAfterTimelineReachedEnd());
      expect(controller.current?.isResting).toBe(false);
      await act(() => controller.current?.collapseForTimelineScrollKey("PageDown"));
      expect(controller.current?.isResting).toBe(true);
      await act(() => controller.current?.expandForEditorChange());
      expect(controller.current?.isResting).toBe(false);

      for (const override of [
        { hasExpandedChrome: true },
        { hasMultilinePrompt: true },
        { timelineOverflows: false },
        { enabled: false },
        { isMobileViewport: true },
      ]) {
        await act(() => {
          renderer!.update(<Probe input={{ ...input, ...override }} controller={controller} />);
        });
        await act(() => controller.current?.collapseForTimelineScrollKey("PageUp"));
        expect(controller.current?.isResting).toBe(false);
      }
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  it("clears a collapsed thread when voice controls open or the destination changes", async () => {
    const controller = createRef<CollapseController>();
    const input: CollapseInput = {
      targetKey: "thread-a",
      isExistingThread: true,
      isMobileViewport: false,
      enabled: true,
      hasExpandedChrome: false,
      hasMultilinePrompt: false,
      timelineOverflows: true,
      getTimelineScrollableNode: () =>
        ({ scrollTop: 500, scrollHeight: 1500, clientHeight: 500 }) as HTMLElement,
      isTimelineAtLogicalEnd: () => false,
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(<Probe input={input} controller={controller} />);
      });
      await act(() => controller.current?.collapseForTimelineScrollKey("PageUp"));
      expect(controller.current?.isResting).toBe(true);
      await act(() => {
        renderer!.update(
          <Probe input={{ ...input, hasExpandedChrome: true }} controller={controller} />,
        );
      });
      expect(controller.current?.isResting).toBe(false);
      await act(() => renderer!.update(<Probe input={input} controller={controller} />));
      expect(controller.current?.isResting).toBe(false);
      await act(() => controller.current?.collapseForTimelineScrollKey("PageUp"));
      expect(controller.current?.isResting).toBe(true);
      await act(() => {
        renderer!.update(
          <Probe input={{ ...input, targetKey: "thread-b" }} controller={controller} />,
        );
      });
      expect(controller.current?.isResting).toBe(false);
    } finally {
      await act(() => renderer?.unmount());
    }
  });
});
