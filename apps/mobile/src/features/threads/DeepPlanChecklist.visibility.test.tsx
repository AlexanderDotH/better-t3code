import {
  DeepPlanRunId,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type DeepPlanReview,
  type DeepPlanRun,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { AsyncResult } from "effect/reactivity";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: {},
  updateMobilePreferencesAtom: {},
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => AsyncResult.success({}),
  useAtomSet: () => () => {},
}));
vi.mock("react-native", () => {
  const Container = (props: { children?: ReactNode }) => createElement("div", {}, props.children);
  return { View: Container, ScrollView: Container, Pressable: Container };
});
vi.mock("../../components/ui/AppText", () => ({
  AppText: (props: { children?: ReactNode }) => createElement("span", {}, props.children),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/Button", () => ({ Button: () => null }));
vi.mock("../../components/ui/Dialog", () => ({}));
vi.mock("../../localization/useMobileInterfaceTranslator", () => ({
  useMobileInterfaceTranslator: () =>
    createInterfaceTranslator({ language: "en", locale: "en-US" }),
}));

import { DeepPlanChecklist } from "./DeepPlanChecklist";

const completedAt = "2026-10-19T10:00:00.000Z";
function completedRun(): DeepPlanRun {
  const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "model" };
  const threadId = ThreadId.make("thread");
  const review: DeepPlanReview = {
    round: 1,
    reviewThreadId: ThreadId.make("review"),
    reviewer: modelSelection,
    diff: null,
    verdict: "approved",
    summary: "Native checks passed",
    findings: [],
    retries: 0,
    startedAt: completedAt,
    completedAt,
  };
  return {
    schemaVersion: 2,
    id: DeepPlanRunId.make("completed"),
    threadId,
    phase: "completed",
    revision: 4,
    approvalKey: "approved",
    approval: {
      planVersion: 1,
      approvalKey: "approved",
      approvedAt: completedAt,
      implementation: modelSelection,
      reviewer: modelSelection,
      lanes: [{ laneId: "lane-1", threadId }],
      parallelism: 1,
      baseTurnCount: 0,
    },
    plan: {
      schemaVersion: 2,
      version: 1,
      goal: "Complete the plan",
      scope: ["Mobile"],
      nonGoals: [],
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
    chats: [],
    includeProjectChats: false,
    steps: [
      {
        stepId: "build",
        status: "verified",
        laneId: "lane-1",
        baseTurnCount: 0,
        submission: null,
        reviews: [review],
        roundLimit: 3,
        unsubmittedTurns: 0,
      },
    ],
    finalReview: {
      status: "approved",
      submission: null,
      reviews: [{ ...review, reviewThreadId: ThreadId.make("final-review") }],
      roundLimit: 3,
      unsubmittedTurns: 0,
    },
    activeTurns: [],
    operations: [],
    createdAt: completedAt,
    updatedAt: completedAt,
    pause: null,
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
  act(() =>
    root.render(
      <DeepPlanChecklist environmentId={EnvironmentId.make("local")} run={completedRun()} />,
    ),
  );
  expect(host.textContent).toContain("1/1 verified");
  act(() => vi.advanceTimersByTime(14_999));
  expect(host.textContent).toContain("Deep checklist");
  act(() => vi.advanceTimersByTime(1));
  expect(host.textContent).toBe("");
});

it("does not revive old composer checklists and retains the embedded plan checklist", () => {
  vi.advanceTimersByTime(600_000);
  act(() =>
    root.render(
      <DeepPlanChecklist environmentId={EnvironmentId.make("local")} run={completedRun()} />,
    ),
  );
  expect(host.textContent).toBe("");
  act(() =>
    root.render(
      <DeepPlanChecklist
        environmentId={EnvironmentId.make("local")}
        key="revisit"
        run={completedRun()}
      />,
    ),
  );
  expect(host.textContent).toBe("");
  act(() =>
    root.render(
      <DeepPlanChecklist
        environmentId={EnvironmentId.make("local")}
        run={completedRun()}
        embedded
      />,
    ),
  );
  expect(host.textContent).toContain("1/1 verified");
  expect(host.textContent).toContain("Native checks passed");
});

it("keeps active or paused plans visible after an earlier completion timer", () => {
  const run = completedRun();
  act(() =>
    root.render(<DeepPlanChecklist environmentId={EnvironmentId.make("local")} run={run} />),
  );
  const active = { ...run, id: DeepPlanRunId.make("next"), phase: "implementing" as const };
  act(() =>
    root.render(<DeepPlanChecklist environmentId={EnvironmentId.make("local")} run={active} />),
  );
  act(() => vi.advanceTimersByTime(120_000));
  expect(host.textContent).toContain("Deep checklist");
  act(() =>
    root.render(
      <DeepPlanChecklist
        environmentId={EnvironmentId.make("local")}
        run={{ ...active, phase: "paused" }}
      />,
    ),
  );
  act(() => vi.advanceTimersByTime(120_000));
  expect(host.textContent).toContain("Deep checklist");
});
