// @vitest-environment jsdom

import { EventId, TurnId } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import { ContextWindowMeter } from "./ContextWindowMeter";

function snapshot(usedTokens: number, maxTokens?: number) {
  const usage = deriveLatestContextWindowSnapshot([
    {
      id: EventId.make("activity-1"),
      tone: "info",
      kind: "context-window.updated",
      summary: "Context updated",
      payload: { usedTokens, maxTokens },
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-08-24T12:00:00.000Z",
    },
  ]);
  if (!usage) throw new Error("Context fixture did not produce usage.");
  return usage;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderMeter(overrides: Partial<ComponentProps<typeof ContextWindowMeter>> = {}) {
  await act(() =>
    root.render(<ContextWindowMeter usage={snapshot(100_000, 1_000_000)} {...overrides} />),
  );
}

function trigger() {
  const button = container.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("Context meter trigger is missing.");
  return button;
}

function popup() {
  return document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
}

async function focusMeter() {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    trigger().focus();
  });
}

describe("ContextWindowMeter", () => {
  it("opens details on keyboard focus and closes with Escape without reopening", async () => {
    await renderMeter({ onCompact: () => {} });
    expect(popup()).toBeNull();
    await focusMeter();
    expect(popup()?.textContent).toContain("Used tokens100,000");
    expect(popup()?.textContent).toContain("Limit1,000,000");
    const compact = popup()!.querySelector<HTMLButtonElement>("button")!;
    await act(() => compact.focus());
    await act(() => {
      compact.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
    await act(() => trigger().blur());
    await focusMeter();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("retains click opening and compacts only when the action is available", async () => {
    const onCompact = vi.fn();
    await renderMeter({
      onCompact,
      compactDisabled: true,
      compactDisabledReason: "Wait for the current turn",
    });
    await act(() => {
      trigger().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      trigger().focus();
    });
    expect(popup()).toBeNull();
    await act(() => trigger().click());
    const compact = () =>
      [...(popup()?.querySelectorAll("button") ?? [])].find((button) =>
        button.textContent?.includes("Compact context"),
      )!;
    expect(compact().disabled).toBe(true);
    expect(popup()?.textContent).toContain("Wait for the current turn");
    await act(() => compact().click());
    expect(onCompact).not.toHaveBeenCalled();
    await renderMeter({ onCompact });
    await act(() => compact().click());
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it("shows valid zero usage with a known limit", async () => {
    await renderMeter({ usage: snapshot(0, 200_000) });
    expect(trigger().getAttribute("aria-label")).toContain("0 of 200,000 tokens (0% used)");
    await focusMeter();
    expect(popup()?.textContent).toContain("Used tokens0");
    expect(popup()?.textContent).toContain("0%");
  });

  it("shows unknown limits without inventing a percentage", async () => {
    await renderMeter({ usage: snapshot(12_345) });
    expect(trigger().textContent).toBe("–");
    expect(trigger().getAttribute("aria-label")).toContain("12,345 tokens used. Limit unknown");
    await focusMeter();
    expect(popup()?.textContent).toContain("Used tokens12,345");
    expect(popup()?.textContent).toContain("Limit unknown");
    expect(popup()?.textContent).not.toContain("%");
    expect(popup()?.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("preserves overflowing token counts and percentages while bounding the gauge", async () => {
    await renderMeter({ usage: snapshot(250_000, 200_000) });
    expect(trigger().getAttribute("aria-label")).toContain("250,000 of 200,000 tokens (125% used)");
    await focusMeter();
    const progress = popup()?.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("100");
    expect(progress?.getAttribute("aria-valuetext")).toContain("125% used");
    expect(popup()?.textContent).toContain("Used tokens250,000");
    await renderMeter({ usage: snapshot(90_100, 100_000) });
    expect(trigger().getAttribute("aria-label")).toContain("90.1% used");
  });

  it("clears previous-thread details for loading and threads without usage", async () => {
    await renderMeter();
    await focusMeter();
    expect(popup()).not.toBeNull();
    await renderMeter({ usage: null, reserveSpace: true });
    expect(container.querySelector("button")).toBeNull();
    expect(popup()).toBeNull();
    expect(document.body.textContent).not.toContain("100,000");
    await renderMeter({ usage: null });
    expect(container.childElementCount).toBe(0);
    await renderMeter({ usage: snapshot(0) });
    await focusMeter();
    expect(popup()?.textContent).toContain("Used tokens0");
    expect(popup()?.textContent).not.toContain("100,000");
  });

  it("localizes unknown-limit details and accessible values", async () => {
    setInterfaceLocaleRuntime({ language: "de", locale: "de-DE" });
    await renderMeter({ usage: snapshot(12_345) });
    expect(trigger().getAttribute("aria-label")).toContain("12.345");
    await focusMeter();
    expect(popup()?.textContent).toContain("Limit unbekannt");
    expect(popup()?.textContent).toContain("12.345");
  });
});
