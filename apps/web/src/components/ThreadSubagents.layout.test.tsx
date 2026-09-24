import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type Ref } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("../state/threads", async () => {
  const Option = await import("effect/Option");
  return {
    useEnvironmentSubagent: () => ({
      data: Option.none(),
      page: Option.none(),
      error: Option.none(),
      status: "ready",
    }),
  };
});
vi.mock("./ChatAgentStack", () => ({
  ChatAgentStack: ({ stackRef }: { stackRef: Ref<HTMLDivElement> }) => (
    <div ref={stackRef} data-agent-stack-probe="" />
  ),
}));
vi.mock("./SubagentTranscriptDialog", () => ({ SubagentTranscriptDialog: () => null }));

import { ThreadSubagents } from "./ThreadSubagents";

afterEach(() => vi.unstubAllGlobals());

it("expands agents only while the rendered chat width leaves room beside them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let chatLeft = 300;
  let renderedChatLeft: number | null = null;
  let onResize = () => {};
  let nextFrame = 0;
  const scheduledFrames = new Map<number, FrameRequestCallback>();
  const flushFrames = () => {
    const frames = [...scheduledFrames.values()];
    scheduledFrames.clear();
    for (const frame of frames) frame(0);
  };
  const chatColumn = {
    querySelector: () =>
      renderedChatLeft === null
        ? null
        : { getBoundingClientRect: () => ({ left: renderedChatLeft, width: 600 }) },
  };
  const stack = {
    dataset: { agentLayout: "" },
    closest: () => chatColumn,
    getBoundingClientRect: () => ({ right: 240 }),
  };
  const chatWidthProbe = { getBoundingClientRect: () => ({ left: chatLeft }) };
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const frame = ++nextFrame;
      scheduledFrames.set(frame, callback);
      return frame;
    },
    cancelAnimationFrame: (frame: number) => scheduledFrames.delete(frame),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        <ThreadSubagents
          threadRef={{
            environmentId: EnvironmentId.make("env-1"),
            threadId: ThreadId.make("thread-1"),
          }}
          subagents={[]}
          timestampFormat="24-hour"
        />,
        {
          createNodeMock: (element) => {
            const props = element.props as Record<string, unknown>;
            if (props["data-agent-stack-probe"] !== undefined) return stack;
            if (props["data-chat-width-probe"] !== undefined) return chatWidthProbe;
            return null;
          },
        },
      );
    });
    expect(stack.dataset.agentLayout).toBe("expanded");

    chatLeft = 251;
    await act(() => {
      onResize();
      flushFrames();
    });
    expect(stack.dataset.agentLayout).toBe("compact");

    chatLeft = 400;
    await act(() => {
      onResize();
      flushFrames();
    });
    expect(stack.dataset.agentLayout).toBe("expanded");

    renderedChatLeft = 249;
    await act(() => {
      onResize();
      flushFrames();
    });
    expect(stack.dataset.agentLayout).toBe("compact");

    renderedChatLeft = 400;
    await act(() => {
      onResize();
      flushFrames();
    });
    expect(stack.dataset.agentLayout).toBe("expanded");
  } finally {
    await act(() => renderer?.unmount());
  }
});
