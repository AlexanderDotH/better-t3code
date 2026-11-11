import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";
import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [
    { id: "theme", title: "Theme", to: "/settings/appearance" },
  ],
}));

it("lists each Better T3 category as a page and keeps other sections folded until opened", async () => {
  // Below md the sidebar is an icon rail, which never folds its sections.
  await page.viewport(1200, 800);
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  await screen.getByRole("treeitem", { name: "Sidebar" }).click();
  await vi.waitFor(() => {
    expect(screen.router?.state.location.pathname).toBe("/settings/better-t3");
    expect(screen.router?.state.location.search).toMatchObject({ category: "sidebar" });
  });

  // The open page's own section stays open; another section starts folded.
  const section = (key: string) =>
    page.elementLocator(document.querySelector(`[data-settings-section="${key}"]`)!);
  await expect.element(section("/settings/general")).toBeVisible();
  await expect.element(section("/settings/providers")).not.toBeVisible();
  await section("group:Agents").click();
  await expect.element(section("/settings/providers")).toBeVisible();

  // Better T3 folds like the rest, and comes back the same way.
  await expect.element(section("/settings/better-t3:sidebar")).toBeVisible();
  await section("group:Better T3").click();
  await expect.element(section("/settings/better-t3:sidebar")).not.toBeVisible();
  await section("group:Better T3").click();
  await expect.element(section("/settings/better-t3:sidebar")).toBeVisible();
});

it("finds Better T3 features that have no curated search entry", async () => {
  await using _screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  await page.getByRole("combobox", { name: "Search settings" }).fill("Working status in top bar");
  await expect
    .element(page.getByRole("option", { name: /Working status in top bar/ }))
    .toBeVisible();
});

it("ignores composing keys in the search", async () => {
  await using screen = await render(
    <SidebarProvider defaultOpen>
      <SettingsSidebarNav pathname="/settings/general" />
    </SidebarProvider>,
    { router: "/settings/general" },
  );
  const search = page.getByRole("combobox", { name: "Search settings" });
  await search.fill("theme");
  await expect.element(page.getByRole("option", { name: /Theme/ })).toBeVisible();

  for (const composition of [
    { key: "Enter", isComposing: true, keyCode: 13 },
    { key: "Enter", isComposing: false, keyCode: 229 },
    { key: "Escape", isComposing: true, keyCode: 27 },
    { key: "Escape", isComposing: false, keyCode: 229 },
    { key: "ArrowDown", isComposing: true, keyCode: 40 },
    { key: "ArrowUp", isComposing: true, keyCode: 38 },
  ]) {
    const event = new KeyboardEvent("keydown", { ...composition, bubbles: true, cancelable: true });
    await act(() => search.element().dispatchEvent(event));
    expect(event.defaultPrevented, JSON.stringify(composition)).toBe(false);
    expect(screen.router?.state.location.pathname).toBe("/settings/general");
    await expect.element(search).toHaveValue("theme");
  }

  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(screen.router?.state.location.pathname).toBe("/settings/appearance"),
  );
});
