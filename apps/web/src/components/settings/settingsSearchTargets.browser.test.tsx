import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useState } from "react";
import { act, render } from "../../../test/render";
import { expect, it, vi } from "vite-plus/test";

import {
  BetterT3SettingsSearch,
  BetterT3SettingsSearchItems,
  BetterT3SettingsSearchItemsProvider,
} from "./BetterT3SettingsSearch";
import {
  BetterT3SettingsExpansionProvider,
  BetterT3SettingsSubgroup,
} from "./BetterT3SettingsSubgroup";
import {
  scrollToSettingsTarget,
  SettingsSearchTarget,
  SettingsSearchTargetProvider,
  useRequestSettingsSearchTarget,
} from "./settingsLayout";

vi.mock("../../hooks/useInterfaceTranslator", () => ({
  useInterfaceTranslator: () => createInterfaceTranslator({ language: "de", locale: "de-DE" }),
}));

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

function JumpToModel() {
  const requestTarget = useRequestSettingsSearchTarget();
  return <button onClick={() => requestTarget(targetId)}>Jump to model</button>;
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
      <BetterT3SettingsExpansionProvider>
        <JumpToModel />
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
      </BetterT3SettingsExpansionProvider>
    </SettingsSearchTargetProvider>
  );
}

function groupTrigger(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!;
}

it("reveals a lazy search destination before scrolling and focusing it, then leaves it open", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  await act(() => screen.rerender(<SettingsTargetHarness />));
  expect(document.getElementById(targetId)).toBeNull();

  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  const target = document.getElementById(targetId)!;
  expect(target).not.toBeNull();
  expect(target.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(target);
  expect(scrollIntoView).toHaveBeenCalled();
  expect(groupTrigger(screen.container).getAttribute("aria-expanded")).toBe("true");
  expect(
    JSON.parse(window.localStorage.getItem("t3code.better-t3-settings-expanded.v1")!),
  ).toContain("fetch");

  await act(() => groupTrigger(screen.container).click());
  expect(document.getElementById(targetId)).toBe(target);
  expect(target.closest('[inert], [aria-hidden="true"]')).not.toBeNull();
  expect(scrollToSettingsTarget(targetId)).toBe(false);

  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.getElementById(targetId)).toBe(target);
  expect(document.activeElement).toBe(target);
  expect(groupTrigger(screen.container).getAttribute("aria-expanded")).toBe("true");
  expect(target.querySelector<HTMLInputElement>("input")!.value).toBe("Draft retained");
});

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
  await act(() => groupTrigger(screen.container).click());
  expect(groupTrigger(screen.container).getAttribute("aria-expanded")).toBe("false");
});

it("focuses character streaming motion without repeatedly expanding its always-visible group", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  const motionTargetId = "chat.characterStreamingMotion";
  const handled = vi.fn();
  await act(() =>
    screen.rerender(
      <SettingsSearchTargetProvider targetId={motionTargetId} onTargetHandled={handled}>
        <BetterT3SettingsExpansionProvider>
          <BetterT3SettingsSubgroup groupId="chat-display" title="Chat display">
            <SettingsSearchTarget id={motionTargetId}>
              Character streaming motion
            </SettingsSearchTarget>
          </BetterT3SettingsSubgroup>
        </BetterT3SettingsExpansionProvider>
      </SettingsSearchTargetProvider>,
    ),
  );

  expect(document.activeElement).toBe(document.getElementById(motionTargetId));
  expect(handled).toHaveBeenCalledOnce();
  expect(scrollIntoView).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem("t3code.better-t3-settings-expanded.v1")).toBeNull();
});

it("finds an unmounted translated model in inline search and opens it before focusing", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  await act(() =>
    screen.rerender(
      <BetterT3SettingsSearchItemsProvider
        items={[
          {
            id: targetId,
            targetId,
            to: "/settings/better-t3",
            title: "Fetch-Modell",
            category: "Agenten",
            description: "Modell für die Recherche",
          },
        ]}
      >
        <SettingsSearchTargetProvider targetId={null}>
          <BetterT3SettingsExpansionProvider>
            <div data-settings-page-scroll>
              <BetterT3SettingsSearch />
              <BetterT3SettingsSubgroup groupId="fetch" title="Fetch">
                <SettingsSearchTarget id={targetId}>Fetch model selector</SettingsSearchTarget>
              </BetterT3SettingsSubgroup>
            </div>
          </BetterT3SettingsExpansionProvider>
        </SettingsSearchTargetProvider>
      </BetterT3SettingsSearchItemsProvider>,
    ),
  );
  expect(document.getElementById(targetId)).toBeNull();
  const input = screen.container.querySelector<HTMLInputElement>("input")!;
  await act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Recherche",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const result = document.querySelector<HTMLElement>('[role="option"]');
  expect(result?.textContent).toContain("Fetch-Modell");
  await act(() => result!.click());
  const target = document.getElementById(targetId)!;
  expect(target).not.toBeNull();
  expect(target.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(target);
});

function AvailabilitySearchHarness({ available }: { readonly available: boolean }) {
  return (
    <BetterT3SettingsSearchItemsProvider>
      <SettingsSearchTargetProvider targetId={null}>
        <div data-settings-page-scroll>
          <BetterT3SettingsSearch />
          {available ? (
            <BetterT3SettingsSearchItems
              items={[
                {
                  id: "voice-cleanup-model",
                  targetId: "voice-cleanup-model",
                  to: "/settings/better-t3",
                  title: "Nachbearbeitungsmodell",
                },
              ]}
            />
          ) : null}
        </div>
      </SettingsSearchTargetProvider>
    </BetterT3SettingsSearchItemsProvider>
  );
}

it("removes unavailable specialized fields while a search is already open", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  await act(() => screen.rerender(<AvailabilitySearchHarness available />));
  const input = screen.container.querySelector<HTMLInputElement>("input")!;
  await act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Nachbearbeitungsmodell",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector('[role="option"]')?.textContent).toContain(
    "Nachbearbeitungsmodell",
  );

  await act(() => screen.rerender(<AvailabilitySearchHarness available={false} />));
  expect(input.value).toBe("Nachbearbeitungsmodell");
  expect(document.querySelector('[role="option"]')).toBeNull();
  expect(document.body.textContent).toContain(
    createInterfaceTranslator({ language: "de", locale: "de-DE" }).message(
      "settings.application.search.empty",
    ),
  );
});

function SupersededHashHarness({ onHandled }: { readonly onHandled: () => void }) {
  const [showOldGroup, setShowOldGroup] = useState(false);
  return (
    <SettingsSearchTargetProvider
      targetId="agent.contextCompactionModel"
      onTargetHandled={onHandled}
    >
      <BetterT3SettingsExpansionProvider>
        <JumpToModel />
        <button onClick={() => setShowOldGroup(true)}>Show old destination</button>
        <BetterT3SettingsSubgroup groupId="fetch" title="Fetch">
          <SettingsSearchTarget id={targetId}>Fetch model selector</SettingsSearchTarget>
        </BetterT3SettingsSubgroup>
        {showOldGroup ? (
          <BetterT3SettingsSubgroup groupId="context-compaction" title="Context compaction">
            <SettingsSearchTarget id="agent.contextCompactionModel">
              Old destination
            </SettingsSearchTarget>
          </BetterT3SettingsSubgroup>
        ) : null}
      </BetterT3SettingsExpansionProvider>
    </SettingsSearchTargetProvider>
  );
}

it("lets the latest inline result supersede an older unresolved hash destination", async () => {
  using _resources = settingsSearchResources();
  await using screen = await render(null, { router: false });
  const handled = vi.fn();
  await act(() => screen.rerender(<SupersededHashHarness onHandled={handled} />));
  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.activeElement).toBe(document.getElementById(targetId));
  expect(handled).toHaveBeenCalledTimes(1);

  const showOldDestination = Array.from(screen.container.querySelectorAll("button")).find(
    (button) => button.textContent === "Show old destination",
  )!;
  await act(() => showOldDestination.click());
  expect(document.getElementById("agent.contextCompactionModel")).toBeNull();
  expect(document.activeElement).toBe(document.getElementById(targetId));
  expect(handled).toHaveBeenCalledTimes(1);
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
