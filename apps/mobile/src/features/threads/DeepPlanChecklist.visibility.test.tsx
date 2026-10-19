// @vitest-environment jsdom

import { DeepPlanRunId, ProviderInstanceId, ThreadId, type DeepPlanRun } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => {
  const Container = (props: { children?: ReactNode }) => createElement("div", {}, props.children);
  return { View: Container, ScrollView: Container, Pressable: Container };
});
vi.mock("../../components/AppText", () => ({
  AppText: (props: { children?: ReactNode }) => createElement("span", {}, props.children),
}));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));

import { DeepPlanChecklist } from "./DeepPlanChecklist";

const completedAt = "2026-10-19T10:00:00.000Z";
function completedRun(): DeepPlanRun {
  const evidence = [
    { kind: "test" as const, summary: "Native checks passed", createdAt: completedAt },
  ];
  return {
    id: DeepPlanRunId.make("completed"),
    threadId: ThreadId.make("thread"),
    phase: "completed",
    revision: 4,
    approvalKey: "approved",
    approval: {
      planVersion: 1,
      approvalKey: "approved",
      approvedAt: completedAt,
      approvedBy: "user",
      implementation: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
      implementationThreadId: ThreadId.make("thread"),
      implementerId: "agent",
    },
    plan: {
      schemaVersion: 1,
      version: 1,
      goal: "Complete the plan",
      scope: ["Mobile"],
      decisions: [],
      affectedAreas: [],
      steps: [
        {
          id: "build",
          title: "Build",
          description: "Implement the feature",
          dependencies: [],
          acceptanceCriteria: [{ id: "check", description: "Works", checkMethod: "Run tests" }],
        },
      ],
      finalValidation: { description: "Final check", checkMethod: "Run tests" },
    },
    sources: [],
    sourceCoverage: [],
    stepStates: [{ stepId: "build", status: "verified", evidence, updatedAt: completedAt }],
    finalValidation: {
      status: "passed",
      evidence,
      updatedAt: completedAt,
      attempt: 1,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    operations: [],
    createdAt: completedAt,
    updatedAt: completedAt,
    pauseReason: null,
  };
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(completedAt);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("hides completed composer checklists after the remaining minute", () => {
  vi.advanceTimersByTime(45_000);
  act(() => root.render(<DeepPlanChecklist run={completedRun()} />));
  expect(host.textContent).toContain("1 of 1 verified");
  act(() => vi.advanceTimersByTime(14_999));
  expect(host.textContent).toContain("Deep checklist");
  act(() => vi.advanceTimersByTime(1));
  expect(host.textContent).toBe("");
});

it("does not revive old composer checklists and retains the embedded plan checklist", () => {
  vi.advanceTimersByTime(600_000);
  act(() => root.render(<DeepPlanChecklist run={completedRun()} />));
  expect(host.textContent).toBe("");
  act(() => root.render(<DeepPlanChecklist key="revisit" run={completedRun()} />));
  expect(host.textContent).toBe("");
  act(() => root.render(<DeepPlanChecklist run={completedRun()} embedded />));
  expect(host.textContent).toContain("1 of 1 verified");
  expect(host.textContent).toContain("Native checks passed");
});

it("keeps active or paused plans visible after an earlier completion timer", () => {
  const run = completedRun();
  act(() => root.render(<DeepPlanChecklist run={run} />));
  const active = { ...run, id: DeepPlanRunId.make("next"), phase: "implementing" as const };
  act(() => root.render(<DeepPlanChecklist run={active} />));
  act(() => vi.advanceTimersByTime(120_000));
  expect(host.textContent).toContain("Deep checklist");
  act(() => root.render(<DeepPlanChecklist run={{ ...active, phase: "paused" }} />));
  act(() => vi.advanceTimersByTime(120_000));
  expect(host.textContent).toContain("Deep checklist");
});
