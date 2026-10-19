// @vitest-environment jsdom
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  BetterT3SettingsExpansionProvider,
  BetterT3SettingsSubgroup,
} from "./BetterT3SettingsSubgroup";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));
const storageKey = "t3code.better-t3-settings-expanded.v1";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
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
const render = async (content: ReactNode) => act(() => root.render(content));
function trigger(group: string) {
  return host.querySelector<HTMLButtonElement>(`[data-better-t3-subgroup="${group}"] button`)!;
}
const click = async (group: string) => act(() => trigger(group).click());

it("starts model groups closed, opens them independently and keeps live summaries after rerenders", async () => {
  await render(groups());
  expect(host.querySelector('[aria-label="Fetch draft"]')).toBeNull();
  expect(host.querySelector('[aria-label="Warnings"]')).not.toBeNull();
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
  await render(groups());
  await click("fetch");
  const draft = host.querySelector<HTMLInputElement>('[aria-label="Fetch draft"]')!;
  draft.value = "Unsaved local edit";
  await click("fetch");
  expect(host.querySelector('[aria-label="Fetch draft"]')).toBe(draft);
  expect(draft.closest("[inert]")).not.toBeNull();
  expect(draft.closest('[aria-hidden="true"]')).not.toBeNull();
  await click("fetch");
  expect(draft.value).toBe("Unsaved local edit");
  expect(draft.closest("[inert]")).toBeNull();
  expect(trigger("fetch").getAttribute("type")).toBe("button");
});

it("ignores invalid stored IDs and removes them on the next local change", async () => {
  localStorage.setItem(storageKey, JSON.stringify(["fetch", "fetch", "warnings", "unknown"]));
  await render(groups());
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  expect(trigger("auto-reasoning").getAttribute("aria-expanded")).toBe("false");
  await click("auto-reasoning");
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(["fetch", "auto-reasoning"]);
});

it("repairs malformed JSON on interaction and retains the repaired state after navigation", async () => {
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
  await render(groups());
  await render(groups("On · Automatic", true));
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("true");
  await click("fetch");
  await render(groups("On · Another model", true));
  expect(trigger("fetch").getAttribute("aria-expanded")).toBe("false");
});
