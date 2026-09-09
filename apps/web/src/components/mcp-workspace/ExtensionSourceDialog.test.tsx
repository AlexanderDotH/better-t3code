import { EnvironmentId, type DesktopPreviewWebviewConfig } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  config: vi.fn<() => Promise<DesktopPreviewWebviewConfig>>(),
  register: vi.fn<() => Promise<void>>(),
  release: vi.fn(),
}));
vi.mock("../preview/previewBridge", () => ({
  previewBridge: { getPreviewConfig: mocks.config, registerWebview: mocks.register },
}));
vi.mock("~/browser/desktopTabLifetime", () => ({
  acquireDesktopTab: () => ({ ready: Promise.resolve(), release: mocks.release }),
}));
vi.mock("~/hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => ({ message: (key: string) => key }),
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, onClick }: ComponentProps<"button">) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import { ExtensionSourcePage } from "./ExtensionSourceDialog";

let renderer: ReactTestRenderer | undefined;
const config: DesktopPreviewWebviewConfig = {
  partition: "persist:t3-preview-work",
  webPreferences: "sandbox=true,nodeIntegration=false",
  preloadUrl: null,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.config.mockReset().mockResolvedValue(config);
  mocks.register.mockReset().mockResolvedValue(undefined);
  mocks.release.mockReset();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function setupGuest() {
  const guests: Array<EventTarget & { remove: ReturnType<typeof vi.fn> }> = [];
  const append = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => {
      const guest = Object.assign(new EventTarget(), {
        setAttribute: vi.fn(),
        getWebContentsId: () => 42,
        remove: vi.fn(),
      });
      guests.push(guest);
      return guest;
    },
  });
  return { guests, append };
}

async function mount(append: ReturnType<typeof vi.fn>) {
  await act(() => {
    renderer = create(
      <ExtensionSourcePage
        environmentId={EnvironmentId.make("store-env")}
        url="https://github.com/example/tool"
      />,
      { createNodeMock: () => ({ append }) },
    );
  });
}

it("keeps navigation failures visible, retries with a fresh guest, and cleans up on close", async () => {
  const { guests, append } = setupGuest();
  await mount(append);
  const guest = guests[0]!;
  await act(() => guest.dispatchEvent(new Event("dom-ready")));
  expect(mocks.register).toHaveBeenCalledWith(expect.any(String), 42);
  expect(renderer!.root.findAllByProps({ role: "status" })).toHaveLength(0);

  await act(() =>
    guest.dispatchEvent(
      Object.assign(new Event("did-fail-load"), { isMainFrame: true, errorCode: -105 }),
    ),
  );
  await act(() => guest.dispatchEvent(new Event("dom-ready")));
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(1);

  await act(() => renderer!.root.findByType("button").props.onClick());
  expect(guest.remove).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(guests).toHaveLength(2);
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(guests[1]!.remove).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledTimes(2);
});

it("does not attach a page if its modal closes while configuration is loading", async () => {
  let resolveConfig!: (value: DesktopPreviewWebviewConfig) => void;
  mocks.config.mockReturnValue(
    new Promise((resolve) => {
      resolveConfig = resolve;
    }),
  );
  const { guests, append } = setupGuest();
  await mount(append);
  await act(() => renderer!.unmount());
  renderer = undefined;
  await act(() => resolveConfig(config));
  expect(guests).toHaveLength(0);
  expect(append).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
