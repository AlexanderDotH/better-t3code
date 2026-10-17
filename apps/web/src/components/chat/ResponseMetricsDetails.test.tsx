// @vitest-environment jsdom

import type { ResponseMetricsSnapshot } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { ResponseMetricsDetails } from "./ResponseMetricsDetails";

let container: HTMLDivElement;
let root: Root;

const snapshot: ResponseMetricsSnapshot = {
  timeToFirstTokenMs: 250,
  responseDurationMs: 2000,
  tokenUsage: {
    usageStatus: "complete",
    usageScope: "main_agent",
    inputTokens: 1000,
    outputTokens: 300,
    reasoningTokens: 100,
    hasSubagents: false,
  },
  contextUsedTokens: 1300,
  contextLimitTokens: 2000,
};

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function triggers() {
  return [...container.querySelectorAll<HTMLElement>('[data-slot="tooltip-trigger"]')];
}

function popup() {
  return document.querySelector<HTMLElement>('[data-slot="tooltip-popup"]');
}

async function focusLabel(label: HTMLElement) {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    label.focus();
  });
}

it("shows separate text labels without a metrics button, icon, or popover", async () => {
  await act(() => root.render(<ResponseMetricsDetails snapshot={snapshot} />));

  expect(triggers().map((label) => label.textContent)).toEqual([
    "150 tok/s",
    "TTFT 0.25 s",
    "300 Tokens",
    "Context 1,300 / 2,000 (65%)",
  ]);
  expect(triggers().every((label) => label.tagName === "SPAN" && label.tabIndex === 0)).toBe(true);
  expect(container.querySelector('button, [role="button"], svg')).toBeNull();
  expect(document.querySelector('[data-slot^="popover-"]')).toBeNull();
  expect(popup()).toBeNull();
});

it("explains each metric on keyboard focus and closes with Escape", async () => {
  await act(() => root.render(<ResponseMetricsDetails snapshot={snapshot} />));
  const explanations = [
    "including tool waits",
    "provider turn start",
    "including reasoning",
    "Final context tokens",
  ];

  for (const [index, label] of triggers().entries()) {
    await focusLabel(label);
    expect(document.activeElement).toBe(label);
    expect(popup()?.textContent).toContain(explanations[index]);
    expect(label.getAttribute("aria-describedby")).toBe(popup()?.id);
    await act(() => {
      label.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(popup()).toBeNull();
  }
});

it("opens the hovered label's own tooltip", async () => {
  vi.useFakeTimers();
  await act(() => root.render(<ResponseMetricsDetails snapshot={snapshot} />));
  const outputLabel = triggers()[2]!;

  await act(() => {
    outputLabel.dispatchEvent(new MouseEvent("mouseenter"));
    outputLabel.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
  await act(() => vi.advanceTimersByTimeAsync(600));

  expect(popup()?.textContent).toContain("including reasoning");
  expect(popup()?.textContent).not.toContain("including tool waits");
});

it("keeps missing fields visible as en dashes", async () => {
  await act(() => root.render(<ResponseMetricsDetails snapshot={{ contextUsedTokens: 1600 }} />));

  expect(triggers().map((label) => label.textContent)).toEqual([
    "– tok/s",
    "TTFT –",
    "– Tokens",
    "Context 1,600 / –",
  ]);
  expect(container.textContent).not.toContain("Not available");
});

it("updates late usage and clears labels and open tooltips when the snapshot disappears", async () => {
  await act(() => root.render(<ResponseMetricsDetails snapshot={snapshot} />));
  await focusLabel(triggers()[3]!);
  await act(() =>
    root.render(<ResponseMetricsDetails snapshot={{ ...snapshot, contextUsedTokens: 1600 }} />),
  );
  expect(triggers()[3]?.textContent).toBe("Context 1,600 / 2,000 (80%)");

  await act(() => root.render(<ResponseMetricsDetails snapshot={null} />));
  expect(container.textContent).toBe("");
  expect(triggers()).toHaveLength(0);
  expect(popup()).toBeNull();
  expect(document.body.textContent).not.toContain("1,600");

  await act(() => root.render(<ResponseMetricsDetails snapshot={{}} />));
  expect(triggers().map((label) => label.textContent)).toEqual([
    "– tok/s",
    "TTFT –",
    "– Tokens",
    "Context –",
  ]);
});

it("renders nothing without a response snapshot", async () => {
  await act(() => root.render(<ResponseMetricsDetails snapshot={null} />));

  expect(container.childNodes).toHaveLength(0);
  expect(popup()).toBeNull();
});
