// @vitest-environment jsdom

import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  type ChatVisualMode,
  type ChatVisualModeSyncRecord,
  type ClientSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

interface EnvironmentFixture {
  environmentId: EnvironmentId;
  label: string;
  connection: { phase: "connected" | "disconnected" };
  serverConfig: {
    environment: { capabilities: { environmentSettingsVersion: number } };
    settings: { chatVisualModeSyncRecord: ChatVisualModeSyncRecord };
  };
}

const mocks = vi.hoisted(() => ({
  get: vi.fn<() => Promise<ClientSettings | null>>(),
  set: vi.fn<(settings: ClientSettings) => Promise<void>>(),
  updateServer: vi.fn(async () => ({ _tag: "Success" as const, value: undefined })),
  toast: vi.fn(),
  environments: [] as EnvironmentFixture[],
}));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: { getClientSettings: mocks.get, setClientSettings: mocks.set },
  }),
}));
vi.mock("./state/environments", () => ({
  useEnvironments: () => ({ environments: mocks.environments, isReady: true }),
}));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => mocks.updateServer }));
vi.mock("./components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("./hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});

import {
  ChatVisualModeSyncCoordinator,
  useChatVisualMode,
  useSetChatVisualMode,
} from "./chatVisualModeSync";
import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
  getClientSettings,
} from "./hooks/useSettings";

const legacyKey = "t3code:chat-visual-mode-sync:v1";
const encode = Schema.encodeSync(ClientSettingsSchema);
const decode = Schema.decodeSync(ClientSettingsSchema);
let disk: string | null;
let root: Root | undefined;
let container: HTMLDivElement;
const saveReceipts = new Set<(settings: ClientSettings) => void>();

function readDisk() {
  return disk === null ? null : decode(JSON.parse(disk));
}

function saved(mode: ChatVisualMode) {
  return new Promise<ClientSettings>((resolve) => {
    const receipt = (settings: ClientSettings) => {
      if (settings.chatVisualModeLocalRecord?.mode !== mode) return;
      saveReceipts.delete(receipt);
      resolve(settings);
    };
    saveReceipts.add(receipt);
  });
}

function Selection() {
  const mode = useChatVisualMode();
  const setMode = useSetChatVisualMode();
  return (
    <>
      <output>{mode}</output>
      <button onClick={() => setMode("classic")}>Classic</button>
      <button onClick={() => setMode("current")}>Current</button>
      <ChatVisualModeSyncCoordinator />
    </>
  );
}

async function mount() {
  root = createRoot(container);
  await act(() => root!.render(<Selection />));
}

async function restart() {
  await act(() => root!.unmount());
  root = undefined;
  __resetClientSettingsPersistenceForTests();
  localStorage.clear();
  await mount();
}

async function choose(label: "Classic" | "Current") {
  const receipt = saved(label === "Classic" ? "classic" : "current");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === label)!
      .click();
    await receipt;
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.environments = [];
  mocks.updateServer.mockClear();
  mocks.toast.mockClear();
  disk = null;
  saveReceipts.clear();
  localStorage.clear();
  mocks.get.mockReset().mockImplementation(async () => readDisk());
  mocks.set.mockReset().mockImplementation(async (settings) => {
    disk = JSON.stringify(encode(settings));
    for (const receipt of [...saveReceipts]) receipt(readDisk()!);
  });
  __resetClientSettingsPersistenceForTests();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container.remove();
  saveReceipts.clear();
  __resetClientSettingsPersistenceForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps explicit Classic and Current after restarting with empty origin storage, including offline", async () => {
  const original = {
    ...DEFAULT_CLIENT_SETTINGS,
    fontSizeInterface: 17,
    betterT3Device: {
      ...DEFAULT_CLIENT_SETTINGS.betterT3Device,
      flags: { "future.feature": true, "chat.classicSidebar": false },
    },
  };
  disk = JSON.stringify(encode(original));
  await mount();
  await choose("Classic");
  expect(container.querySelector("output")!.textContent).toBe("classic");
  expect(readDisk()?.betterT3Device.flags).toEqual(original.betterT3Device.flags);
  expect(readDisk()?.fontSizeInterface).toBe(17);

  await restart();
  expect(container.querySelector("output")!.textContent).toBe("classic");
  expect(mocks.updateServer).not.toHaveBeenCalled();
  await choose("Current");
  await restart();
  expect(container.querySelector("output")!.textContent).toBe("current");
});

it("migrates the old Classic cache before removing it and survives an origin change", async () => {
  const legacy = { mode: "classic", updatedAt: 500, updateId: "legacy:classic" } as const;
  localStorage.setItem(legacyKey, JSON.stringify(legacy));
  const receipt = saved("classic");
  await mount();
  await act(async () => {
    await receipt;
  });
  expect(readDisk()?.chatVisualModeLocalRecord).toEqual(legacy);
  expect(localStorage.getItem(legacyKey)).toBeNull();
  await restart();
  expect(container.querySelector("output")!.textContent).toBe("classic");
});

it("does not let a stale legacy cache override an explicit durable Current choice", async () => {
  disk = JSON.stringify(
    encode({
      ...DEFAULT_CLIENT_SETTINGS,
      chatVisualModeLocalRecord: { mode: "current", updatedAt: 600, updateId: "durable:current" },
    }),
  );
  localStorage.setItem(
    legacyKey,
    JSON.stringify({
      mode: "classic",
      updatedAt: 500,
      updateId: "legacy:classic",
    }),
  );
  await mount();
  expect(container.querySelector("output")!.textContent).toBe("current");
  await restart();
  expect(container.querySelector("output")!.textContent).toBe("current");
});

it("migrates a newer selection made by an older client without losing the durable preferences", async () => {
  disk = JSON.stringify(
    encode({
      ...DEFAULT_CLIENT_SETTINGS,
      fontSizeInterface: 17,
      chatVisualModeLocalRecord: { mode: "current", updatedAt: 500, updateId: "desktop:old" },
    }),
  );
  const legacy = { mode: "classic", updatedAt: 700, updateId: "legacy:newer" } as const;
  localStorage.setItem(legacyKey, JSON.stringify(legacy));
  const receipt = saved("classic");
  await mount();
  await act(async () => {
    await receipt;
  });
  expect(readDisk()?.chatVisualModeLocalRecord).toEqual(legacy);
  expect(readDisk()?.fontSizeInterface).toBe(17);
  expect(localStorage.getItem(legacyKey)).toBeNull();
  await restart();
  expect(container.querySelector("output")!.textContent).toBe("classic");
});

it("waits for native hydration and repairs an older server instead of resetting Classic", async () => {
  const classic = { mode: "classic", updatedAt: 2000, updateId: "desktop:classic" } as const;
  let completeRead!: (settings: ClientSettings) => void;
  mocks.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeRead = resolve;
      }),
  );
  mocks.environments = [
    {
      environmentId: EnvironmentId.make("remote"),
      label: "Remote",
      connection: { phase: "connected" },
      serverConfig: {
        environment: { capabilities: { environmentSettingsVersion: 3 } },
        settings: {
          chatVisualModeSyncRecord: { mode: "current", updatedAt: 1000, updateId: "remote:old" },
        },
      },
    },
  ];
  await mount();
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.updateServer).not.toHaveBeenCalled();
  await act(async () => {
    completeRead({ ...DEFAULT_CLIENT_SETTINGS, chatVisualModeLocalRecord: classic });
    await ensureClientSettingsHydrated();
  });
  expect(container.querySelector("output")!.textContent).toBe("classic");
  expect(getClientSettings().chatVisualModeLocalRecord).toEqual(classic);
  expect(mocks.updateServer).toHaveBeenCalledExactlyOnceWith({
    environmentId: EnvironmentId.make("remote"),
    input: { patch: { chatVisualModeSyncRecord: classic } },
  });
});

it("retains the saved selection and reports a failed local write", async () => {
  await mount();
  await choose("Current");
  mocks.set.mockRejectedValueOnce(new Error("disk unavailable"));
  await act(() => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Classic")!
      .click();
  });
  expect(container.querySelector("output")!.textContent).toBe("current");
  expect(readDisk()?.chatVisualModeLocalRecord?.mode).toBe("current");
  expect(mocks.toast).toHaveBeenCalledWith({
    type: "error",
    title: "Couldn’t save chat appearance.",
  });
});

it("keeps a fresh local Classic choice ahead of an in-flight server restore from a faster clock", async () => {
  const future = Date.now() + 1_000_000;
  disk = JSON.stringify(
    encode({
      ...DEFAULT_CLIENT_SETTINGS,
      chatVisualModeLocalRecord: { mode: "current", updatedAt: 500, updateId: "desktop:old" },
    }),
  );
  mocks.environments = [
    {
      environmentId: EnvironmentId.make("remote"),
      label: "Remote",
      connection: { phase: "connected" },
      serverConfig: {
        environment: { capabilities: { environmentSettingsVersion: 3 } },
        settings: {
          chatVisualModeSyncRecord: {
            mode: "current",
            updatedAt: future,
            updateId: "remote:future",
          },
        },
      },
    },
  ];
  let releaseWrite!: () => void;
  let startWrite!: () => void;
  const started = new Promise<void>((resolve) => {
    startWrite = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  mocks.set.mockImplementationOnce(async (settings) => {
    startWrite();
    await writing;
    disk = JSON.stringify(encode(settings));
    for (const receipt of [...saveReceipts]) receipt(readDisk()!);
  });
  await mount();
  await started;
  const chosen = saved("classic");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Classic")!
      .click();
    releaseWrite();
    await chosen;
  });
  expect(container.querySelector("output")!.textContent).toBe("classic");
  expect(readDisk()?.chatVisualModeLocalRecord?.updatedAt).toBeGreaterThan(future);
  await restart();
  expect(container.querySelector("output")!.textContent).toBe("classic");
});

it("keeps the legacy choice recoverable when its migration cannot be written", async () => {
  const legacy = { mode: "classic", updatedAt: 500, updateId: "legacy:recovery" } as const;
  localStorage.setItem(legacyKey, JSON.stringify(legacy));
  mocks.set.mockRejectedValueOnce(new Error("disk unavailable"));
  await mount();
  expect(localStorage.getItem(legacyKey)).toBe(JSON.stringify(legacy));
  expect(readDisk()).toBeNull();
  expect(container.querySelector("output")!.textContent).toBe("classic");
  expect(mocks.toast).toHaveBeenCalled();

  await choose("Classic");
  expect(localStorage.getItem(legacyKey)).toBeNull();
  await restart();
  expect(container.querySelector("output")!.textContent).toBe("classic");
});
