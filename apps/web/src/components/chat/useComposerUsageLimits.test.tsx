import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  readBrowserClientSettings,
  writeBrowserClientSettings,
} from "../../clientPersistenceStorage";
import {
  __resetClientSettingsPersistenceForTests,
  getClientSettings,
} from "../../hooks/useSettings";
import { useComposerUsageLimits } from "./useComposerUsageLimits";

const persistence = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));
const toasts = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("~/localApi", () => ({ ensureLocalApi: () => ({ persistence }) }));
vi.mock("../../hooks/useNowMinute", () => ({ useNowMinute: () => "2026-09-30T12:00" }));
vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "de", locale: "de-DE" }),
  };
});
vi.mock("../ui/toast", () => ({ toastManager: toasts }));

function provider(id: string, email: string, usedPercent: number): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", email },
    checkedAt: "2026-09-30T12:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt: "2026-09-30T12:00:00.000Z",
      windows: [{ id: "session", kind: "session", label: "Session", usedPercent }],
    },
  };
}

const localProvider = provider("codex", "local@example.com", 25);
const remoteProvider = provider("codex", "remote@example.com", 75);
let renderer: ReactTestRenderer | undefined;
let usage: ReturnType<typeof useComposerUsageLimits>;

function Chat({
  selected,
  available = true,
}: {
  readonly selected: ServerProvider;
  readonly available?: boolean;
}) {
  const current = useComposerUsageLimits({
    instanceId: selected.instanceId,
    providers: [selected],
    sources: [],
    available,
  });
  useLayoutEffect(() => {
    usage = current;
  }, [current]);
  return <output>{current.report?.accounts[0]?.email ?? "hidden"}</output>;
}

async function mount(selected = localProvider) {
  await act(() => {
    renderer = create(<Chat selected={selected} />);
  });
}

async function reload(selected = localProvider) {
  await act(() => renderer?.unmount());
  renderer = undefined;
  __resetClientSettingsPersistenceForTests();
  await mount(selected);
}

beforeEach(() => {
  toasts.add.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  persistence.getClientSettings
    .mockReset()
    .mockImplementation(async () => readBrowserClientSettings());
  persistence.setClientSettings.mockReset().mockImplementation(async (settings) => {
    writeBrowserClientSettings(settings);
  });
  __resetClientSettingsPersistenceForTests();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  __resetClientSettingsPersistenceForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("composer usage limits visibility", () => {
  it("keeps the choice across chat unmounts and reloads while reading the current environment", async () => {
    await mount();
    expect(usage.report).toBeNull();
    await act(async () => {
      expect(await usage.toggle()).toBe(true);
    });
    expect(usage.report?.accounts[0]?.email).toBe("local@example.com");
    expect(readBrowserClientSettings()?.composerUsageLimitsVisible).toBe(true);

    await act(() => renderer?.unmount());
    renderer = undefined;
    await mount(remoteProvider);
    expect(usage.report?.accounts.map((account) => account.email)).toEqual(["remote@example.com"]);
    expect(usage.report?.accounts[0]?.limits.windows[0]?.usedPercent).toBe(75);

    await reload(remoteProvider);
    expect(usage.report?.accounts.map((account) => account.email)).toEqual(["remote@example.com"]);
    await act(async () => {
      expect(await usage.toggle()).toBe(true);
    });
    expect(usage.report).toBeNull();
    expect(readBrowserClientSettings()?.composerUsageLimitsVisible).toBe(false);
    await reload();
    expect(usage.report).toBeNull();
  });

  it("persists dismissal, supports reopening, and does not clear the choice during unavailable contexts", async () => {
    await mount();
    await act(async () => {
      await usage.toggle();
    });
    const firstOpening = usage.bannerId;
    await act(() => renderer?.update(<Chat selected={remoteProvider} available={false} />));
    expect(usage.report).toBeNull();
    expect(getClientSettings().composerUsageLimitsVisible).toBe(true);
    const withoutLimits = { ...remoteProvider, usageLimits: undefined };
    await act(() => renderer?.update(<Chat selected={withoutLimits} />));
    expect(usage.offered).toBe(false);
    expect(usage.report).toBeNull();
    await act(async () => {
      expect(await usage.toggle()).toBe(false);
    });
    expect(readBrowserClientSettings()?.composerUsageLimitsVisible).toBe(true);
    expect(toasts.add).toHaveBeenLastCalledWith({
      type: "info",
      title: "Nutzungslimits sind für diesen Anbieter nicht verfügbar",
    });

    await act(() =>
      renderer?.update(<Chat selected={provider("codex", "remote@example.com", 80)} />),
    );
    expect(usage.report?.accounts[0]?.limits.windows[0]?.usedPercent).toBe(80);
    await act(async () => {
      await usage.dismiss();
    });
    expect(usage.report).toBeNull();
    await act(async () => {
      await usage.toggle();
    });
    expect(usage.bannerId).not.toBe(firstOpening);
    expect(usage.report).not.toBeNull();
    await act(async () => {
      await usage.dismiss();
    });
    await reload(remoteProvider);
    expect(usage.report).toBeNull();
    await act(async () => {
      await usage.toggle();
    });
    expect(usage.report).not.toBeNull();
  });

  it("waits for saved settings before toggling and preserves unrelated preferences", async () => {
    const saved = { ...DEFAULT_CLIENT_SETTINGS, composerUsageLimitsVisible: true, wordWrap: false };
    writeBrowserClientSettings(saved);
    let finishRead!: (settings: ClientSettings) => void;
    persistence.getClientSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    await mount();
    let handled!: Promise<boolean>;
    await act(() => {
      handled = usage.toggle();
    });
    expect(persistence.setClientSettings).not.toHaveBeenCalled();
    await act(async () => {
      finishRead(saved);
      expect(await handled).toBe(true);
    });
    expect(usage.report).toBeNull();
    expect(readBrowserClientSettings()).toMatchObject({
      composerUsageLimitsVisible: false,
      wordWrap: false,
    });
  });

  it("keeps the saved choice on write failures and restores a failed dismissal", async () => {
    writeBrowserClientSettings({ ...DEFAULT_CLIENT_SETTINGS, composerUsageLimitsVisible: true });
    await mount();
    const dismissedId = usage.bannerId;
    persistence.setClientSettings.mockRejectedValueOnce(new Error("storage unavailable"));
    await act(async () => {
      await usage.dismiss();
    });
    expect(usage.report?.accounts[0]?.email).toBe("local@example.com");
    expect(readBrowserClientSettings()?.composerUsageLimitsVisible).toBe(true);
    expect(usage.bannerId).not.toBe(dismissedId);
    expect(toasts.add).toHaveBeenLastCalledWith({
      type: "error",
      title: "Die Sichtbarkeit der Nutzungslimits konnte nicht gespeichert werden",
    });

    await act(async () => {
      await usage.dismiss();
    });
    persistence.setClientSettings.mockRejectedValueOnce(new Error("storage unavailable"));
    await act(async () => {
      expect(await usage.toggle()).toBe(false);
    });
    expect(usage.report).toBeNull();
    expect(readBrowserClientSettings()?.composerUsageLimitsVisible).toBe(false);
    await act(async () => {
      expect(await usage.toggle()).toBe(true);
    });
    expect(usage.report).not.toBeNull();
  });

  it("applies repeated commands in order before React publishes another render", async () => {
    await mount();
    await act(async () => {
      const first = usage.toggle();
      const second = usage.toggle();
      expect(await Promise.all([first, second])).toEqual([true, true]);
    });
    expect(usage.report).toBeNull();
    expect(readBrowserClientSettings()?.composerUsageLimitsVisible).toBe(false);
  });
});
