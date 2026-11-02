import { act, render as renderTest, type Screen } from "../../../test/render";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";
const persistenceMocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: persistenceMocks,
  }),
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
describe("context meter preview choices", () => {
  it("updates the selected preview while its settings write is pending", async () => {
    await using fixture = await setupFixture();
    const { renderSettings, choices, selection } = fixture;
    await renderSettings();
    let finishWrite!: () => void;
    const blockedWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const persisted = new Promise<void>((resolve) => {
      persistenceMocks.setClientSettings.mockImplementationOnce(async (settings) => {
        await blockedWrite;
        fixture.savedSettings = settings;
        resolve();
      });
    });
    await act(async () => {
      await choices()[0]!.click();
    });
    expect(selection()).toEqual(["true", "false"]);
    expect(fixture.savedSettings).toBeNull();
    await act(async () => {
      finishWrite();
      await persisted;
    });
    expect(fixture.savedSettings?.contextWindowMeterEnabled).toBe(false);
  });
  it("saves either card without an environment, reloads Off, and resets to On", async () => {
    await using fixture = await setupFixture();
    const { renderSettings, selection, choices } = fixture;
    await renderSettings();
    expect(selection()).toEqual(["false", "true"]);
    expect(choices().map((choice) => choice.textContent)).toEqual([
      expect.stringContaining("Off"),
      expect.stringContaining("On"),
    ]);
    expect(choices().every((choice) => !choice.disabled)).toBe(true);
    expect(fixture.container.querySelector('[role="switch"]')).toBeNull();
    expect(fixture.container.querySelector("#legacy-context-window-indicator")).not.toBeNull();
    expect(fixture.container.textContent).toContain("Example: 64,000 / 128,000 tokens (50% used)");
    expect(choices().every((choice) => choice.textContent?.includes("Single-line composer"))).toBe(
      true,
    );
    expect(choices().every((choice) => choice.textContent?.includes("Expanded composer"))).toBe(
      true,
    );
    for (const enabled of [false, true, false]) {
      await act(async () => {
        await choices()[enabled ? 1 : 0]!.click();
      });
      expect(selection()).toEqual(enabled ? ["false", "true"] : ["true", "false"]);
      expect(fixture.savedSettings?.contextWindowMeterEnabled).toBe(enabled);
    }
    await act(async () => {
      await fixture.screen.unmount();
    });
    __resetClientSettingsPersistenceForTests();
    fixture.screen = fixture.adoptScreen(
      await renderTest(null, {
        container: fixture.container,
        /* The fixture exercises local state without router navigation.*/ router: false,
      }),
    );
    await renderSettings();
    expect(selection()).toEqual(["true", "false"]);
    expect(persistenceMocks.getClientSettings).toHaveBeenCalledTimes(2);
    const reset = fixture.container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Reset "]',
    );
    expect(reset).not.toBeNull();
    await act(async () => {
      await reset!.click();
    });
    expect(selection()).toEqual(["false", "true"]);
    expect(fixture.savedSettings?.contextWindowMeterEnabled).toBe(true);
    expect(fixture.container.querySelector('button[aria-label^="Reset "]')).toBeNull();
  });
  it("changes and focuses the selected card with the keyboard", async () => {
    await using fixture = await setupFixture();
    const { renderSettings, choices, selection } = fixture;
    await renderSettings();
    await act(() => {
      choices()[1]!.focus();
      choices()[1]!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
        }),
      );
    });
    expect(selection()).toEqual(["true", "false"]);
    expect(document.activeElement).toBe(choices()[0]);
    expect(fixture.savedSettings?.contextWindowMeterEnabled).toBe(false);
    await act(() => {
      choices()[0]!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          bubbles: true,
        }),
      );
    });
    expect(selection()).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(choices()[1]);
    expect(fixture.savedSettings?.contextWindowMeterEnabled).toBe(true);
  });
  it("labels and formats the fixed example in the interface language", async () => {
    await using fixture = await setupFixture();
    const { renderSettings, choices } = fixture;
    setInterfaceLocaleRuntime({
      language: "de",
      locale: "de-DE",
    });
    await renderSettings();
    expect(fixture.container.textContent).toContain(
      "Beispiel: 64.000 / 128.000 Token (50 % genutzt)",
    );
    expect(choices().map((choice) => choice.textContent)).toEqual([
      expect.stringContaining("Aus"),
      expect.stringContaining("An"),
    ]);
  });
});
async function setupFixture() {
  const fixtureResources = new AsyncDisposableStack();
  let container: HTMLDivElement;
  let screen: Screen;
  let savedSettings: ClientSettings | null;
  async function renderSettings() {
    await act(async () => {
      await screen.rerender(<ContextWindowMeterSettings />);
      await ensureClientSettingsHydrated();
    });
  }
  function choices() {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  }
  function selection() {
    return choices().map((choice) => choice.getAttribute("aria-checked"));
  }
  fixtureResources.defer(async () => {
    await act(async () => {
      await screen.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });
  try {
    setInterfaceLocaleRuntime({
      language: "en",
      locale: "en-US",
    });
    __resetClientSettingsPersistenceForTests();
    savedSettings = null;
    persistenceMocks.getClientSettings.mockReset().mockImplementation(async () => savedSettings);
    persistenceMocks.setClientSettings.mockReset().mockImplementation(async (settings) => {
      savedSettings = settings;
    });
    container = document.createElement("div");
    document.body.append(container);
    screen = fixtureResources.use(
      await renderTest(null, {
        container: container,
        /* The fixture exercises local state without router navigation.*/ router: false,
      }),
    );
    return {
      get container() {
        return container;
      },
      set container(value: HTMLDivElement) {
        container = value;
      },
      get screen() {
        return screen;
      },
      set screen(value: Screen) {
        screen = value;
      },
      get savedSettings() {
        return savedSettings;
      },
      set savedSettings(value: ClientSettings | null) {
        savedSettings = value;
      },
      renderSettings,
      choices,
      selection,
      async [Symbol.asyncDispose]() {
        await fixtureResources.disposeAsync();
      },
      adoptScreen(next: Screen) {
        return fixtureResources.use(next);
      },
    };
  } catch (error) {
    await fixtureResources.disposeAsync();
    throw error;
  }
}
