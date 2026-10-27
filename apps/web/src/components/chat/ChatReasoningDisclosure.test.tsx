// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ChatReasoningDisclosure } from "./ChatReasoningDisclosure";
import type { WorkingReasoningTrace } from "./WorkingReasoningDialog";

vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("./ChatThinkingIndicator", () => ({
  ChatThinkingIndicator: () => <span>Thinking</span>,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("switches from Thinking to Thought with a recorded duration and keeps the trace disclosure usable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
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
  try {
    await act(() => root.render(<Harness trace={trace} />));
    expect(host.querySelector("button")!.textContent).toBe("Thinking");
    expect(host.querySelector(".better-chat-reasoning-duration")).toBeNull();
    await act(() => root.render(<Harness trace={{ ...trace, streaming: false }} />));
    expect(host.querySelector("button")!.textContent).toContain("Thought");
    expect(host.querySelector(".better-chat-reasoning-duration")!.textContent).toBe("1m 3s");
    await act(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain(trace.detail);
    expect(host.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    await act(() =>
      root.render(<Harness trace={{ id: "legacy", detail: trace.detail, streaming: false }} />),
    );
    expect(host.querySelector(".better-chat-reasoning-duration")!.textContent).toBe(
      "Duration unavailable",
    );
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
