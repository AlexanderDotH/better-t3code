import { act, render, type Screen } from "../../../test/render";

import { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import { ContextWindowMeter } from "./ContextWindowMeter";

function snapshot(usedTokens: number, maxTokens?: number) {
  const usage = deriveLatestContextWindowSnapshot([], {
    usedTokens,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    updatedAt: "2026-08-24T12:00:00.000Z",
  });
  if (!usage) throw new Error("Context fixture did not produce usage.");
  return usage;
}

async function renderMeter(
  screen: Screen,
  overrides: Partial<ComponentProps<typeof ContextWindowMeter>> = {},
) {
  await act(() =>
    screen.rerender(<ContextWindowMeter usage={snapshot(100_000, 1_000_000)} {...overrides} />),
  );
}

function trigger(screen: Screen) {
  const button = screen.container.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("Context meter trigger is missing.");
  return button;
}

function popup() {
  return document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
}

async function focusMeter(screen: Screen) {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    trigger(screen).focus();
  });
}

describe("ContextWindowMeter", () => {
  it("opens details on keyboard focus and closes with Escape without reopening", async () => {
    setup();
    await using screen = await render(null);

    await renderMeter(screen, { onCompact: () => {} });
    expect(popup()).toBeNull();
    await focusMeter(screen);
    expect(popup()?.textContent).toContain("Used tokens100,000");
    expect(popup()?.textContent).toContain("Limit1,000,000");
    const compact = popup()!.querySelector<HTMLButtonElement>("button")!;
    await act(() => compact.focus());
    await act(() => {
      compact.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await expect.element(trigger(screen)).toHaveFocus();
    expect(trigger(screen).getAttribute("aria-expanded")).toBe("false");
    await act(() => trigger(screen).blur());
    await focusMeter(screen);
    expect(trigger(screen).getAttribute("aria-expanded")).toBe("true");
  });

  it("retains click opening and compacts only when the action is available", async () => {
    setup();
    await using screen = await render(null);

    const onCompact = vi.fn();
    await renderMeter(screen, {
      onCompact,
      compactDisabled: true,
      compactDisabledReason: "Wait for the current turn",
    });
    await act(() => {
      trigger(screen).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      trigger(screen).focus();
    });
    expect(popup()).toBeNull();
    await act(() => trigger(screen).click());
    const compact = () =>
      [...(popup()?.querySelectorAll("button") ?? [])].find((button) =>
        button.textContent?.includes("Compact context"),
      )!;
    expect(compact().disabled).toBe(true);
    expect(popup()?.textContent).toContain("Wait for the current turn");
    await act(() => compact().click());
    expect(onCompact).not.toHaveBeenCalled();
    await renderMeter(screen, { onCompact });
    await act(() => compact().click());
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it("shows valid zero usage with a known limit", async () => {
    setup();
    await using screen = await render(null);

    await renderMeter(screen, { usage: snapshot(0, 200_000) });
    expect(trigger(screen).getAttribute("aria-label")).toContain("0 of 200,000 tokens (0% used)");
    await focusMeter(screen);
    expect(popup()?.textContent).toContain("Used tokens0");
    expect(popup()?.textContent).toContain("0%");
  });

  it("shows unknown limits without inventing a percentage", async () => {
    setup();
    await using screen = await render(null);

    await renderMeter(screen, { usage: snapshot(12_345) });
    expect(trigger(screen).textContent).toBe("–");
    expect(trigger(screen).getAttribute("aria-label")).toContain(
      "12,345 tokens used. Limit unknown",
    );
    await focusMeter(screen);
    expect(popup()?.textContent).toContain("Used tokens12,345");
    expect(popup()?.textContent).toContain("Limit unknown");
    expect(popup()?.textContent).not.toContain("%");
    expect(popup()?.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("preserves overflowing token counts and percentages while bounding the gauge", async () => {
    setup();
    await using screen = await render(null);

    await renderMeter(screen, { usage: snapshot(250_000, 200_000) });
    expect(trigger(screen).getAttribute("aria-label")).toContain(
      "250,000 of 200,000 tokens (125% used)",
    );
    await focusMeter(screen);
    const progress = popup()?.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("100");
    expect(progress?.getAttribute("aria-valuetext")).toContain("125% used");
    expect(popup()?.textContent).toContain("Used tokens250,000");
    await renderMeter(screen, { usage: snapshot(90_100, 100_000) });
    expect(trigger(screen).getAttribute("aria-label")).toContain("90.1% used");
  });

  it("clears previous-thread details for loading and threads without usage", async () => {
    setup();
    await using screen = await render(null);
    const container = screen.container;

    await renderMeter(screen);
    await focusMeter(screen);
    expect(popup()).not.toBeNull();
    await renderMeter(screen, { usage: null, reserveSpace: true });
    expect(container.querySelector("button")).toBeNull();
    expect(popup()).toBeNull();
    expect(document.body.textContent).not.toContain("100,000");
    await renderMeter(screen, { usage: null });
    expect(container.childElementCount).toBe(0);
    await renderMeter(screen, { usage: snapshot(0) });
    await focusMeter(screen);
    expect(popup()?.textContent).toContain("Used tokens0");
    expect(popup()?.textContent).not.toContain("100,000");
  });

  it("localizes unknown-limit details and accessible values", async () => {
    setup();
    await using screen = await render(null);

    setInterfaceLocaleRuntime({ language: "de", locale: "de-DE" });
    await renderMeter(screen, { usage: snapshot(12_345) });
    expect(trigger(screen).getAttribute("aria-label")).toContain("12.345");
    await focusMeter(screen);
    expect(popup()?.textContent).toContain("Limit unbekannt");
    expect(popup()?.textContent).toContain("12.345");
  });
});

function setup() {
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
}
