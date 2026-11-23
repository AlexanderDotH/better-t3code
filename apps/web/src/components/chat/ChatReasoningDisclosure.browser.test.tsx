import { act, render as renderScreen } from "../../../test/render";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { ChatReasoningDisclosure } from "./ChatReasoningDisclosure";
import type { WorkingReasoningTrace } from "./WorkingReasoningDialog";

vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <p>{text}</p> }));

it("opens individual reasoning titles in the chat and switches from Thinking to Thought", async () => {
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
  // Only the mocked Markdown body would use the router.
  await using screen = await renderScreen(null, { router: false });
  const host = screen.container;
  const trace: WorkingReasoningTrace = {
    id: "thought",
    detail: "**Checking the implementation**\n\nRead the chat timeline.",
    streaming: true,
    createdAt: "2026-10-27T10:00:00Z",
    updatedAt: "2026-10-27T10:01:03Z",
  };
  const secondTrace: WorkingReasoningTrace = {
    id: "follow-up",
    detail: "### Reviewing the layout\n\nKeep the activity indicator below the tools.",
    streaming: false,
    createdAt: "2026-10-27T10:00:12Z",
    updatedAt: "2026-10-27T10:00:16Z",
  };
  const titleOnlyTrace: WorkingReasoningTrace = {
    ...secondTrace,
    id: "title-only",
    detail: "Checking tool activity\r\n \t\r\n",
  };
  function Harness({ trace }: { trace: WorkingReasoningTrace }) {
    const [expanded, setExpanded] = useState(false);
    return (
      <ChatReasoningDisclosure
        traces={[trace, secondTrace, titleOnlyTrace]}
        motion={false}
        expanded={expanded}
        onExpandedChange={setExpanded}
        markdown={{ cwd: undefined }}
      />
    );
  }

  await screen.rerender(
    <Harness trace={{ ...trace, detail: "**Checking the implementation**" }} />,
  );
  const thinking = screen.getByRole("button", { name: /^Thinking/ });
  const firstTitle = screen.getByRole("button", { name: "Checking the implementation" });
  const secondTitle = screen.getByRole("button", { name: "Reviewing the layout" });
  await expect.element(thinking).toHaveAttribute("aria-expanded", "false");
  expect(host.querySelector(".better-chat-thinking")).toBeNull();
  expect(host.querySelector(".better-chat-reasoning-duration")).toBeNull();
  await thinking.click();
  await expect
    .element(screen.getByText("Checking the implementation", { exact: true }))
    .toBeVisible();
  expect(firstTitle.query()).toBeNull();
  await expect.element(screen.getByText("Checking tool activity", { exact: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "Checking tool activity" }).query()).toBeNull();

  await screen.rerender(<Harness trace={trace} />);
  await expect.element(firstTitle).toHaveAttribute("aria-expanded", "false");
  await expect.element(secondTitle).toHaveAttribute("aria-expanded", "false");
  expect(host.textContent).not.toContain("Read the chat timeline.");
  expect(host.textContent).not.toContain("Keep the activity indicator below the tools.");
  await firstTitle.click();
  await expect.element(firstTitle).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("Read the chat timeline.", { exact: true })).toBeVisible();

  await act(() => screen.rerender(<Harness trace={{ ...trace, streaming: false }} />));
  expect(host.querySelector("button")!.textContent).toContain("Thought");
  expect(host.querySelector(".better-chat-reasoning-duration")!.textContent).toBe("1m 3s");
  expect(host.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  await secondTitle.click();
  await firstTitle.click();
  await expect.element(firstTitle).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(screen.getByText("Keep the activity indicator below the tools.", { exact: true }))
    .toBeVisible();
  expect(host.textContent).not.toContain("Read the chat timeline.");

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
