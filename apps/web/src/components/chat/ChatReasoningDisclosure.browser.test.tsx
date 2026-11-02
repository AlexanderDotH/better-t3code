import { act, render as renderScreen } from "../../../test/render";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { ChatReasoningDisclosure } from "./ChatReasoningDisclosure";
import type { WorkingReasoningTrace } from "./WorkingReasoningDialog";

vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("./ChatThinkingIndicator", () => ({
  ChatThinkingIndicator: () => <span>Thinking</span>,
}));

it("switches from Thinking to Thought with a recorded duration and keeps the trace disclosure usable", async () => {
  using _setup = setup();

  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  await using screen = await renderScreen(null, { router: false });
  const host = screen.container;
  const trace: WorkingReasoningTrace = {
    id: "thought",
    detail: "Checking the implementation",
    streaming: true,
    createdAt: "2026-10-27T10:00:00Z",
    updatedAt: "2026-10-27T10:01:03Z",
  };
  function Harness({ trace }: { trace: WorkingReasoningTrace }) {
    const [expanded, setExpanded] = useState(false);
    return (
      <ChatReasoningDisclosure
        traces={[trace]}
        motion={false}
        expanded={expanded}
        onExpandedChange={setExpanded}
        markdown={{ cwd: undefined }}
      />
    );
  }

  await act(() => screen.rerender(<Harness trace={trace} />));
  expect(host.querySelector("button")!.textContent).toBe("Thinking");
  expect(host.querySelector(".better-chat-reasoning-duration")).toBeNull();
  await act(() => screen.rerender(<Harness trace={{ ...trace, streaming: false }} />));
  expect(host.querySelector("button")!.textContent).toContain("Thought");
  expect(host.querySelector(".better-chat-reasoning-duration")!.textContent).toBe("1m 3s");
  await act(() => host.querySelector("button")!.click());
  expect(host.textContent).toContain(trace.detail);
  expect(host.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  await act(() =>
    screen.rerender(<Harness trace={{ id: "legacy", detail: trace.detail, streaming: false }} />),
  );
  expect(host.querySelector(".better-chat-reasoning-duration")!.textContent).toBe(
    "Duration unavailable",
  );
});

function setup() {
  return {
    [Symbol.dispose]() {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}
