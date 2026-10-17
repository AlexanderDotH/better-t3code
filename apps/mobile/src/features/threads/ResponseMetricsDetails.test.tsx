// @vitest-environment jsdom

import type { ResponseMetricsSnapshot } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../components/AppText", () => ({
  AppText: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));

import { ResponseMetricsDetails } from "./ResponseMetricsDetails";

let container: HTMLDivElement;
let root: Root;

const snapshot: ResponseMetricsSnapshot = {
  timeToFirstTokenMs: 800,
  responseDurationMs: 1000,
  tokenUsage: {
    usageStatus: "complete",
    usageScope: "main_agent",
    inputTokens: 1000,
    outputTokens: 42,
    hasSubagents: false,
  },
  contextUsedTokens: 64000,
  contextLimitTokens: 128000,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

function labels() {
  return Array.from(container.children, (element) => element.textContent);
}

it("updates the native footer labels when a response snapshot is corrected or removed", async () => {
  await act(() => root.render(<ResponseMetricsDetails snapshot={snapshot} />));
  expect(labels()).toEqual([
    "42 tok/s",
    "TTFT 0.8 s",
    "42 Tokens",
    "Context 64,000 / 128,000 (50%)",
  ]);

  await act(() =>
    root.render(<ResponseMetricsDetails snapshot={{ ...snapshot, contextUsedTokens: 96000 }} />),
  );
  expect(labels()[3]).toBe("Context 96,000 / 128,000 (75%)");

  await act(() => root.render(<ResponseMetricsDetails snapshot={null} />));
  expect(container.textContent).toBe("");
  expect(container.childNodes).toHaveLength(0);
});

it("keeps unavailable native measurements visible without inventing a snapshot", async () => {
  await act(() => root.render(<ResponseMetricsDetails snapshot={null} />));
  expect(labels()).toEqual([]);

  await act(() =>
    root.render(<ResponseMetricsDetails snapshot={{ contextLimitTokens: 128000 }} />),
  );
  expect(labels()).toEqual(["– tok/s", "TTFT –", "– Tokens", "Context – / 128,000"]);
});
