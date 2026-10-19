// @vitest-environment jsdom
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

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
let root: Root;
let container: HTMLDivElement;
const scrollIntoView = vi.fn();
const noop = () => undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  window.localStorage.clear();
  scrollIntoView.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

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

function groupTrigger() {
  return container.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!;
}

it("reveals a lazy search destination before scrolling and focusing it, then leaves it open", async () => {
  await act(() => root.render(<SettingsTargetHarness />));
  expect(document.getElementById(targetId)).toBeNull();

  await act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  const target = document.getElementById(targetId)!;
  expect(target).not.toBeNull();
  expect(target.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(target);
  expect(scrollIntoView).toHaveBeenCalled();
  expect(groupTrigger().getAttribute("aria-expanded")).toBe("true");
  expect(
    JSON.parse(window.localStorage.getItem("t3code.better-t3-settings-expanded.v1")!),
  ).toContain("fetch");

  await act(() => groupTrigger().click());
  expect(document.getElementById(targetId)).toBe(target);
  expect(target.closest('[inert], [aria-hidden="true"]')).not.toBeNull();
  expect(scrollToSettingsTarget(targetId)).toBe(false);

  await act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.getElementById(targetId)).toBe(target);
  expect(document.activeElement).toBe(target);
  expect(groupTrigger().getAttribute("aria-expanded")).toBe("true");
  expect(target.querySelector<HTMLInputElement>("input")!.value).toBe("Draft retained");
});

it("opens direct hash destinations and handles them only after a visible target exists", async () => {
  const handled = vi.fn(() => {
    const target = document.getElementById(targetId);
    expect(target).not.toBeNull();
    expect(target!.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
  });
  await act(() =>
    root.render(<SettingsTargetHarness initialTarget={targetId} onHandled={handled} />),
  );

  expect(handled).toHaveBeenCalledTimes(1);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(document.getElementById(targetId));
  await act(() => groupTrigger().click());
  expect(groupTrigger().getAttribute("aria-expanded")).toBe("false");
});

it("finds an unmounted translated model in inline search and opens it before focusing", async () => {
  await act(() =>
    root.render(
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
  const input = container.querySelector<HTMLInputElement>("input")!;
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
  await act(() => root.render(<AvailabilitySearchHarness available />));
  const input = container.querySelector<HTMLInputElement>("input")!;
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

  await act(() => root.render(<AvailabilitySearchHarness available={false} />));
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
  const handled = vi.fn();
  await act(() => root.render(<SupersededHashHarness onHandled={handled} />));
  await act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.activeElement).toBe(document.getElementById(targetId));
  expect(handled).toHaveBeenCalledTimes(1);

  const showOldDestination = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Show old destination",
  )!;
  await act(() => showOldDestination.click());
  expect(document.getElementById("agent.contextCompactionModel")).toBeNull();
  expect(document.activeElement).toBe(document.getElementById(targetId));
  expect(handled).toHaveBeenCalledTimes(1);
});

it("does not create or focus an unavailable destination", async () => {
  const handled = vi.fn();
  await act(() =>
    root.render(
      <SettingsTargetHarness initialTarget={targetId} available={false} onHandled={handled} />,
    ),
  );

  expect(document.getElementById(targetId)).toBeNull();
  expect(handled).not.toHaveBeenCalled();
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(window.localStorage.getItem("t3code.better-t3-settings-expanded.v1")).toBeNull();
});
