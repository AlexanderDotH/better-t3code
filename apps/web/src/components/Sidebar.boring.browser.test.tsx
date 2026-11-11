import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
// The chat route is code-split. Importing it here keeps its cold transform out of the test timeout.
import "~/components/ThreadRouteView";
import { AppRoot } from "~/AppRoot";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
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

it("lists settled chats inside their project folder behind its toggle and offers favorites", async () => {
  const active = threadWithHistory("active", 1);
  const settled = { ...threadWithHistory("settled", 1), settledOverride: "settled" as const };
  const favorite = { ...threadWithHistory("favorite", 1), pinned: true as const };
  using _environment = installFakeEnvironment([active, settled, favorite]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    boringSidebarEnabled: true,
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${active.id}`] }),
  );
  await router.load();
  const container = document.createElement("div");
  container.style.cssText = "height:900px;width:1400px";
  // AppRoot owns the application's router and atom registry.
  await using screen = await render(<AppRoot router={router} />, { container, router: false });

  const toggle = screen.getByRole("treeitem", { name: "Show settled chats" });
  await expect.element(toggle).toBeVisible();
  // A favorite leads its own project's folder rather than a shelf above every folder.
  await expect
    .element(screen.getByTestId("sidebar-row-folder").filter({ hasText: "Thread favorite" }))
    .toBeVisible();
  expect(document.querySelector('[data-testid="sidebar-row-folder"]')?.textContent).toContain(
    "Thread favorite",
  );
  const settledRow = screen.getByTestId("sidebar-row-folder").filter({ hasText: "Thread settled" });
  await expect.element(settledRow).not.toBeInTheDocument();
  // The shared shelf would label a header with the section name.
  await expect.element(screen.getByText("Settled", { exact: true })).not.toBeInTheDocument();

  await toggle.click();
  await expect.element(settledRow).toBeVisible();
  const hide = screen.getByRole("treeitem", { name: "Hide settled chats" });
  await hide.click();
  await expect.element(settledRow).not.toBeInTheDocument();

  const activeRow = screen.getByTestId("sidebar-row-folder").filter({ hasText: "Thread active" });
  await activeRow.hover();
  await expect
    .element(activeRow.getByRole("button", { name: "Add chat to favorites" }))
    .toBeVisible();
});
