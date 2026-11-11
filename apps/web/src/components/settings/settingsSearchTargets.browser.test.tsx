import { useState } from "react";
import { act, render } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";

import { BetterT3SettingsSubgroup } from "./BetterT3SettingsSubgroup";
import { SettingsSearchTarget, SettingsSearchTargetProvider } from "./settingsLayout";

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "de", locale: "de-DE" }),
  };
});

const targetId = "agent.fetchModel";
const scrollIntoView = vi.fn();
const noop = () => undefined;

function settingsSearchResources(): Disposable {
  const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
  const scroll = vi
    .spyOn(HTMLElement.prototype, "scrollIntoView")
    .mockImplementation(scrollIntoView);
  window.localStorage.clear();
  scrollIntoView.mockClear();
  return {
    [Symbol.dispose]() {
      scroll.mockRestore();
      matchMedia.mockRestore();
      window.localStorage.clear();
    },
  };
}

function SettingsTargetHarness({
  initialTarget = null,
  available = true,
  onHandled = noop,
}: {
  readonly initialTarget?: string | null;
  readonly available?: boolean;
  readonly onHandled?: () => void;
}) {
  const [hashTarget, setHashTarget] = useState(initialTarget);
  return (
    <SettingsSearchTargetProvider
      targetId={hashTarget}
      onTargetHandled={() => {
        onHandled();
        setHashTarget(null);
      }}
    >
      <>
        {available ? (
          <BetterT3SettingsSubgroup groupId="fetch" title="Fetch">
            <SettingsSearchTarget id={targetId}>
              <label>
                Model draft
                <input defaultValue="Draft retained" />
              </label>
            </SettingsSearchTarget>
          </BetterT3SettingsSubgroup>
        ) : null}
      </>
    </SettingsSearchTargetProvider>
  );
}

it("opens direct hash destinations and handles them only after a visible target exists", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  const handled = vi.fn(() => {
    const target = document.getElementById(targetId);
    expect(target).not.toBeNull();
    expect(target!.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
  });
  await act(() =>
    screen.rerender(<SettingsTargetHarness initialTarget={targetId} onHandled={handled} />),
  );

  expect(handled).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(document.getElementById(targetId));
});

it("focuses character streaming motion without repeatedly expanding its always-visible group", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  const motionTargetId = "chat.characterStreamingMotion";
  const handled = vi.fn();
  await act(() =>
    screen.rerender(
      <SettingsSearchTargetProvider targetId={motionTargetId} onTargetHandled={handled}>
        <>
          <BetterT3SettingsSubgroup groupId="chat-display" title="Chat display">
            <SettingsSearchTarget id={motionTargetId}>
              Character streaming motion
            </SettingsSearchTarget>
          </BetterT3SettingsSubgroup>
        </>
      </SettingsSearchTargetProvider>,
    ),
  );

  expect(document.activeElement).toBe(document.getElementById(motionTargetId));
  expect(handled).toHaveBeenCalledOnce();
  expect(scrollIntoView).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem("t3code.better-t3-settings-expanded.v1")).toBeNull();
});

it("does not create or focus an unavailable destination", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  const handled = vi.fn();
  await act(() =>
    screen.rerender(
      <SettingsTargetHarness initialTarget={targetId} available={false} onHandled={handled} />,
    ),
  );

  expect(document.getElementById(targetId)).toBeNull();
  expect(handled).not.toHaveBeenCalled();
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(window.localStorage.getItem("t3code.better-t3-settings-expanded.v1")).toBeNull();
});
