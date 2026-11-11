import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

const persisted = vi.hoisted(() => ({ title: "" }));
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() =>
    async ({ input }: { input: { title: string } }) => {
      persisted.title = input.title;
      return { _tag: "Success" };
    }) as never,
}));
vi.mock(import("~/hooks/useThreadActionMenu"), () => ({
  useThreadActionMenu: () => ({ openMenu: () => {}, closeMenu: () => {} }),
}));

import { render } from "../../../test/render";
import { summarizeThreadTokenUsage } from "@t3tools/client-runtime/thread-token-usage";
import { ChatHeader } from "./ChatHeader";

function header(title: string) {
  return (
    <>
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("environment")}
        activeThreadId={ThreadId.make("thread")}
        activeThreadTitle={title}
        isServerThread
        activeProject={null}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
        onNewThreadInProject={() => {}}
      />
      <div tabIndex={0}>Outside rename</div>
    </>
  );
}

it("centers the working status between the title and the header controls", async () => {
  await using screen = await render(
    <div style={{ display: "flex", width: 900 }}>
      <ChatHeader
        activeThreadEnvironmentId={EnvironmentId.make("environment")}
        activeThreadId={ThreadId.make("thread")}
        activeThreadTitle={"A very long thread title ".repeat(12)}
        isServerThread
        activeProject={null}
        parentThreadLink={null}
        onOpenThread={() => {}}
        rightPanelOpen={false}
        onNewThreadInProject={() => {}}
        showWorkingStatus
        workingStartedAt="2026-01-01T00:00:00.000Z"
        workingTokenUsage={summarizeThreadTokenUsage(null, [])}
      />
    </div>,
  );
  const status = screen.container.querySelector<HTMLElement>("[data-chat-header-working-status]")!;
  const title = screen.container.querySelector<HTMLElement>("h2")!;
  const statusBox = status.getBoundingClientRect();
  const header = status.parentElement!;
  const headerBox = header.getBoundingClientRect();
  // The right padding reserves room for the floating titlebar controls.
  const contentRight = headerBox.right - Number.parseFloat(getComputedStyle(header).paddingRight);
  expect(
    Math.abs((statusBox.left + statusBox.right) / 2 - (headerBox.left + contentRight) / 2),
  ).toBeLessThanOrEqual(1);
  expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(statusBox.left);
});

it.each(["blur", "Enter"] as const)(
  "preserves a concurrent title update when an untouched rename ends with %s",
  async (finish) => {
    persisted.title = "New thread";
    await using screen = await render(header(persisted.title));
    await screen.getByRole("button", { name: "Thread actions for New thread" }).dblClick();
    const input = screen.getByRole("textbox", { name: "Thread title" });
    await expect.element(input).toHaveValue("New thread");

    persisted.title = "Fix login redirect";
    await screen.rerender(header(persisted.title));
    if (finish === "Enter") await userEvent.keyboard("{Enter}");
    else await screen.getByText("Outside rename").click();

    await expect.element(input).not.toBeInTheDocument();
    expect(persisted.title).toBe("Fix login redirect");

    await screen.rerender(header(persisted.title));
    await screen.getByRole("button", { name: "Thread actions for Fix login redirect" }).dblClick();
    await screen.getByRole("textbox", { name: "Thread title" }).fill("My edited title");
    persisted.title = "Another concurrent title";
    await screen.rerender(header(persisted.title));
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("textbox", { name: "Thread title" }))
      .not.toBeInTheDocument();
    expect(persisted.title).toBe("My edited title");
  },
);
