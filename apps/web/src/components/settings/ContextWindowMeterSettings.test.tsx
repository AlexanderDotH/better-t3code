// @vitest-environment jsdom

import type { ClientSettings } from "@t3tools/contracts/settings";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const persistenceMocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: persistenceMocks }),
}));

vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  usePrimarySettingsAvailable: () => false,
}));

import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
} from "../../hooks/useSettings";
import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { ContextWindowMeterSettings } from "./BetterT3SettingsPanel";

let container: HTMLDivElement;
let root: Root;
let savedSettings: ClientSettings | null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  __resetClientSettingsPersistenceForTests();
  savedSettings = null;
  persistenceMocks.getClientSettings.mockReset().mockImplementation(async () => savedSettings);
  persistenceMocks.setClientSettings.mockReset().mockImplementation(async (settings) => {
    savedSettings = settings;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderSettings() {
  await act(async () => {
    root.render(<ContextWindowMeterSettings />);
    await ensureClientSettingsHydrated();
  });
}

function choices() {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

function selection() {
  return choices().map((choice) => choice.getAttribute("aria-checked"));
}

describe("context meter preview choices", () => {
  it("updates the selected preview while its settings write is pending", async () => {
    await renderSettings();
    let finishWrite!: () => void;
    const blockedWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const persisted = new Promise<void>((resolve) => {
      persistenceMocks.setClientSettings.mockImplementationOnce(async (settings) => {
        await blockedWrite;
        savedSettings = settings;
        resolve();
      });
    });

    await act(() => choices()[0]!.click());
    expect(selection()).toEqual(["true", "false"]);
    expect(savedSettings).toBeNull();
    await act(async () => {
      finishWrite();
      await persisted;
    });
    expect(savedSettings?.contextWindowMeterEnabled).toBe(false);
  });

  it("saves either card without an environment, reloads Off, and resets to On", async () => {
    await renderSettings();
    expect(selection()).toEqual(["false", "true"]);
    expect(choices().map((choice) => choice.textContent)).toEqual([
      expect.stringContaining("Off"),
      expect.stringContaining("On"),
    ]);
    expect(choices().every((choice) => !choice.disabled)).toBe(true);
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector("#legacy-context-window-indicator")).not.toBeNull();
    expect(container.textContent).toContain("Example: 64,000 / 128,000 tokens (50% used)");
    expect(choices().every((choice) => choice.textContent?.includes("Single-line composer"))).toBe(
      true,
    );
    expect(choices().every((choice) => choice.textContent?.includes("Expanded composer"))).toBe(
      true,
    );

    for (const enabled of [false, true, false]) {
      await act(() => choices()[enabled ? 1 : 0]!.click());
      expect(selection()).toEqual(enabled ? ["false", "true"] : ["true", "false"]);
      expect(savedSettings?.contextWindowMeterEnabled).toBe(enabled);
    }

    await act(() => root.unmount());
    __resetClientSettingsPersistenceForTests();
    root = createRoot(container);
    await renderSettings();
    expect(selection()).toEqual(["true", "false"]);
    expect(persistenceMocks.getClientSettings).toHaveBeenCalledTimes(2);

    const reset = container.querySelector<HTMLButtonElement>('button[aria-label^="Reset "]');
    expect(reset).not.toBeNull();
    await act(() => reset!.click());
    expect(selection()).toEqual(["false", "true"]);
    expect(savedSettings?.contextWindowMeterEnabled).toBe(true);
    expect(container.querySelector('button[aria-label^="Reset "]')).toBeNull();
  });

  it("changes and focuses the selected card with the keyboard", async () => {
    await renderSettings();
    await act(() => {
      choices()[1]!.focus();
      choices()[1]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(selection()).toEqual(["true", "false"]);
    expect(document.activeElement).toBe(choices()[0]);
    expect(savedSettings?.contextWindowMeterEnabled).toBe(false);

    await act(() => {
      choices()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(selection()).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(choices()[1]);
    expect(savedSettings?.contextWindowMeterEnabled).toBe(true);
  });

  it("labels and formats the fixed example in the interface language", async () => {
    setInterfaceLocaleRuntime({ language: "de", locale: "de-DE" });
    await renderSettings();
    expect(container.textContent).toContain("Beispiel: 64.000 / 128.000 Token (50 % genutzt)");
    expect(choices().map((choice) => choice.textContent)).toEqual([
      expect.stringContaining("Aus"),
      expect.stringContaining("An"),
    ]);
  });
});
