import { act, render as renderTest, type Screen } from "../../../test/render";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import {
  BetterT3SettingsExpansionProvider,
  BetterT3SettingsSubgroup,
} from "./BetterT3SettingsSubgroup";
vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () =>
    createInterfaceTranslator({
      language: "en",
      locale: "en-US",
    }),
}));
it("starts model groups closed, opens them independently and keeps live summaries after rerenders", async () => {
  await using fixture = await setupFixture();
  const { render, groups, trigger, click, storageKey } = fixture;
  await render(groups());
  expect(fixture.host.querySelector('[aria-label="Fetch draft"]')).toBeNull();
  expect(fixture.host.querySelector('[aria-label="Warnings"]')).not.toBeNull();
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("false");
  await click("fetch");
  await click("auto-reasoning");
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  expect(trigger("auto-reasoning").getAttribute("aria-expanded")).toBe("true");
  await render(groups("Off · Different model"));
  expect(trigger("fetch").textContent).toContain("Off · Different model");
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(["fetch", "auto-reasoning"]);
  await render(null);
  await render(groups());
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  expect(trigger("auto-reasoning").getAttribute("aria-expanded")).toBe("true");
});
it("keeps a closed group's draft mounted and inaccessible until reopened", async () => {
  await using fixture = await setupFixture();
  const { render, groups, click, trigger } = fixture;
  await render(groups());
  await click("fetch");
  const draft = fixture.host.querySelector<HTMLInputElement>('[aria-label="Fetch draft"]')!;
  draft.value = "Unsaved local edit";
  await click("fetch");
  expect(fixture.host.querySelector('[aria-label="Fetch draft"]')).toBe(draft);
  expect(draft.closest("[inert]")).not.toBeNull();
  expect(draft.closest('[aria-hidden="true"]')).not.toBeNull();
  await click("fetch");
  expect(draft.value).toBe("Unsaved local edit");
  expect(draft.closest("[inert]")).toBeNull();
  expect(trigger("fetch").getAttribute("type")).toBe("button");
});
it("ignores invalid stored IDs and removes them on the next local change", async () => {
  await using fixture = await setupFixture();
  const { storageKey, render, groups, trigger, click } = fixture;
  localStorage.setItem(storageKey, JSON.stringify(["fetch", "fetch", "warnings", "unknown"]));
  await render(groups());
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  expect(trigger("auto-reasoning").getAttribute("aria-expanded")).toBe("false");
  await click("auto-reasoning");
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(["fetch", "auto-reasoning"]);
});
it("repairs malformed JSON on interaction and retains the repaired state after navigation", async () => {
  await using fixture = await setupFixture();
  const { storageKey, render, groups, trigger, click } = fixture;
  localStorage.setItem(storageKey, "{");
  vi.spyOn(console, "error").mockImplementation(() => {});
  await render(groups());
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("false");
  await click("fetch");
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(["fetch"]);
  await render(null);
  await render(groups());
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
});
it("keeps an in-session fallback when storage rejects writes", async () => {
  await using fixture = await setupFixture();
  const { render, groups, click, trigger, storageKey } = fixture;
  await render(groups());
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  await click("fetch");
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  await render(null);
  await render(groups());
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  write.mockRestore();
  await click("fetch");
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([]);
});
it("reveals a new validation failure without reopening after the user explicitly closes it", async () => {
  await using fixture = await setupFixture();
  const { render, groups, trigger, click } = fixture;
  await render(groups());
  await render(groups("On · Automatic", true));
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  await click("fetch");
  await render(groups("On · Another model", true));
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("false");
});
async function setupFixture() {
  const fixtureResources = new AsyncDisposableStack();
  const storageKey = "t3code.better-t3-settings-expanded.v1";
  let host: HTMLDivElement;
  let screen: Screen;
  function groups(summary = "On · Automatic", error = false) {
    return (
      <BetterT3SettingsExpansionProvider>
        <BetterT3SettingsSubgroup
          groupId="fetch"
          title="Fetch"
          summary={summary}
          revealOnError={error}
        >
          <input aria-label="Fetch draft" defaultValue="Draft" />
        </BetterT3SettingsSubgroup>
        <BetterT3SettingsSubgroup groupId="auto-reasoning" title="Reasoning" summary="Automatic">
          <input aria-label="Reasoning model" />
        </BetterT3SettingsSubgroup>
        <BetterT3SettingsSubgroup groupId="warnings" title="Warnings" hideTitle>
          <input aria-label="Warnings" />
        </BetterT3SettingsSubgroup>
      </BetterT3SettingsExpansionProvider>
    );
  }
  const render = async (content: ReactNode) =>
    await act(async () => {
      await screen.rerender(content);
    });
  function trigger(group: string) {
    return host.querySelector<HTMLButtonElement>(`[data-better-t3-subgroup="${group}"] button`)!;
  }
  const click = async (group: string) =>
    await act(async () => {
      await trigger(group).click();
    });
  fixtureResources.defer(async () => {
    await act(async () => {
      await screen?.unmount();
    });
    host?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  try {
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    screen = fixtureResources.use(
      await renderTest(null, {
        container: host,
        // This fixture exercises local state without navigation.
        router: false,
      }),
    );
    return {
      storageKey,
      get host() {
        return host;
      },
      set host(value: HTMLDivElement) {
        host = value;
      },
      get screen() {
        return screen;
      },
      set screen(value: Screen) {
        screen = value;
      },
      groups,
      render,
      trigger,
      click,
      async [Symbol.asyncDispose]() {
        await fixtureResources.disposeAsync();
      },
    };
  } catch (error) {
    await fixtureResources.disposeAsync();
    throw error;
  }
}
