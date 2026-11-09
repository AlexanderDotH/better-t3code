import { createMemoryHistory } from "@tanstack/react-router";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { useUiStateStore } from "~/uiStateStore";
import { ensureLocalApi } from "~/localApi";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

it("clears Completed after visiting and leaving a chat despite an older local watermark", async () => {
  const completed = {
    ...threadWithHistory("completed", 1),
    lastVisitedAt: "2026-03-16T00:00:00.000Z",
  };
  const other = {
    ...threadWithHistory("other", 1),
    lastVisitedAt: "2026-03-17T19:12:28.000Z",
  };
  using _environment = installFakeEnvironment([completed, other]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    legacySidebarEnabled: true,
    betterT3Device: {
      version: 1,
      initialization: "existing-install-migration",
      flags: { "chat.classicSidebar": true },
    },
  });
  useUiStateStore.setState({
    threadLastVisitedAtById: {
      [scopedThreadKey({ environmentId: ENVIRONMENT_ID, threadId: completed.id })]:
        completed.lastVisitedAt,
    },
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${other.id}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height:900px;width:1400px";
  // AppRoot owns the application's router and atom registry.
  await using screen = await render(<AppRoot router={router} />, { container, router: false });
  await expect.element(page.getByText("Answer 0 for other.")).toBeVisible();
  const row = screen.getByTestId("thread-title-completed");
  const status = () =>
    page
      .elementLocator(row.element().closest("[data-thread-item]")!)
      .getByText("Completed", { exact: true });
  await expect.element(status()).toBeVisible();
  row.element().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await expect.element(page.getByText("Answer 0 for completed.")).toBeVisible();
  await expect.element(status()).not.toBeInTheDocument();
  page
    .getByTestId("thread-title-other")
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await expect.element(page.getByText("Answer 0 for other.")).toBeVisible();
  await expect.element(status()).not.toBeInTheDocument();
  using _menu = vi.spyOn(ensureLocalApi().contextMenu, "show").mockResolvedValue("mark-unread");
  // Dispatched events avoid Playwright waiting on the main thread while the chat route renders.
  row
    .element()
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
  // status() pins the row's text when built, so wait for the menu action before building it.
  await vi.waitFor(() => {
    expect(row.element().closest("[data-thread-item]")?.textContent).toContain("Completed");
  });
  await expect.element(status()).toBeVisible();
  row.element().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await expect.element(page.getByText("Answer 0 for completed.")).toBeVisible();
  await expect.element(status()).not.toBeInTheDocument();
});
