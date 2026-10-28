// @vitest-environment jsdom

import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  DeepPlanRunId,
  DeepPlanExportId,
  type ClientOrchestrationCommand,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type OrchestrationProposedPlan,
  type ServerProvider,
  type PlanParallelismReviewInput,
  type ComposerMode,
  type DeepPlanRun,
  type DeepPlanSourceRef,
} from "@t3tools/contracts";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { DeepPlanSourcePicker, type DeepPlanSourceOption } from "./DeepPlanSourcePicker";
import { DeepPlanAnalysisProgress, DeepPlanChecklist } from "./DeepPlanProgress";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { usePlanParallelismReview } from "../../hooks/usePlanParallelismReview";
import {
  __resetPlanParallelismReviewCacheForTests,
  resolvePlanImplementationSuggestion,
} from "@t3tools/client-runtime/plan-implementation";
import {
  formatDeepPlanMarkdown,
  getDeepPlanProposalBlockReason,
  continueDeepPlanForTurn,
  type DeepPlanningApi,
} from "@t3tools/client-runtime/deep-planning";
import { DeepPlanReviewCard } from "./DeepPlanReviewCard";

vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <div>{text}</div> }));
const planReview = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => planReview.request }));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: () => false,
  useEnvironmentIdentificationMode: () => "none",
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { DeepPlanRunControls } from "./DeepPlanRunControls";
import { ComposerInteractionModeButton } from "./ComposerInteractionModeButton";
import { getNextComposerMode } from "@t3tools/client-runtime/deep-planning";
import { TooltipProvider } from "../ui/tooltip";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("owner");
const createdAt = "2026-10-16T10:00:00.000Z";
const sourceId = DeepPlanSourceId.make("source");
const evidence = [
  {
    kind: "test" as const,
    summary: "Focused workflow checks passed",
    reference: "vp test run workflow.test.ts",
    createdAt,
  },
];

function makeRun(overrides: Partial<DeepPlanRun> = {}): DeepPlanRun {
  return {
    id: DeepPlanRunId.make("run"),
    threadId,
    phase: "awaitingApproval",
    revision: 3,
    plan: {
      schemaVersion: 1,
      version: 1,
      goal: "Ship Deep Planning",
      scope: ["All connected clients"],
      decisions: [],
      affectedAreas: ["Composer"],
      steps: [
        {
          id: "build",
          title: "Build the workflow",
          description: "Implement source-aware planning",
          dependencies: [],
          acceptanceCriteria: [
            {
              id: "build-check",
              description: "Archived sources are included",
              checkMethod: "Run source collection tests",
            },
          ],
        },
        {
          id: "verify",
          title: "Verify the workflow",
          description: "Check integrated behavior",
          dependencies: ["build"],
          acceptanceCriteria: [
            {
              id: "verify-check",
              description: "Implementation respects the approved plan",
              checkMethod: "Inspect durable execution evidence",
            },
          ],
        },
      ],
      finalValidation: {
        description: "Validate the complete integration",
        checkMethod: "Run final integration checks",
      },
    },
    approval: null,
    approvalKey: "approval-key",
    sources: [
      {
        sourceId,
        origin: { environmentId, projectId, threadId: ThreadId.make("archive") },
        projectTitle: "Project",
        threadTitle: "Archived research",
        archived: true,
        capturedAt: createdAt,
        contentVersion: "v1",
        contentHash: "hash",
        messageCount: 1,
        activityCount: 0,
        attachmentCount: 0,
        recordCount: 1,
        forkOrigin: null,
      },
    ],
    sourceCoverage: [
      {
        sourceId,
        status: "summarized",
        importedRecordCount: 1,
        readRecordCount: 1,
        summary: {
          requirements: ["Preserve archived research"],
          decisions: [],
          openIssues: [],
          rejectedApproaches: [],
          conflicts: [],
          citedRecordIds: ["record"],
        },
        error: null,
        updatedAt: createdAt,
      },
    ],
    stepStates: [],
    finalValidation: {
      status: "pending",
      evidence: [],
      updatedAt: null,
      attempt: 0,
      requestId: null,
      turnId: null,
    },
    procedureAdjustments: [],
    operations: [],
    createdAt,
    updatedAt: createdAt,
    pauseReason: null,
    ...overrides,
  };
}

const implementationProvider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: createdAt,
  version: null,
  models: [],
  slashCommands: [],
  skills: [],
  nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 8 },
};
const reviewerSelection = { instanceId: implementationProvider.instanceId, model: "reviewer" };

function proposal(run: DeepPlanRun): OrchestrationProposedPlan {
  return {
    id: `proposal-${run.plan!.version}`,
    turnId: null,
    planMarkdown: formatDeepPlanMarkdown(run.plan!),
    deepPlan: { runId: run.id, planVersion: run.plan!.version },
    implementedAt: null,
    implementationThreadId: null,
    createdAt,
    updatedAt: createdAt,
  };
}
function PlanComposer({
  run,
  plan,
  onImplement,
}: {
  run: DeepPlanRun;
  plan: OrchestrationProposedPlan;
  onImplement: (
    strategy: import("@t3tools/client-runtime/plan-implementation").PlanImplementationStrategy,
  ) => void;
}) {
  const available = getDeepPlanProposalBlockReason(plan, run) === null;
  const review = usePlanParallelismReview({
    enabled: available,
    environmentId,
    threadId,
    plan,
    implementationProvider,
    reviewerProvider: implementationProvider,
    reviewerSelection,
  });
  const suggestion = resolvePlanImplementationSuggestion({
    featureEnabled: true,
    planMarkdown: plan.planMarkdown,
    provider: implementationProvider,
    reviewedSubagentCount: review.reviewedSubagentCount,
  });
  return (
    <>
      <DeepPlanAnalysisProgress run={run} />
      <DeepPlanReviewCard
        run={run}
        environmentId={environmentId}
        threadRef={{ environmentId, threadId }}
        workspaceRoot={undefined}
      />
      <ComposerPrimaryActions
        compact={false}
        pendingAction={null}
        isRunning={false}
        showPlanFollowUpPrompt={available}
        promptHasText={false}
        isSendBusy={false}
        sendDisabledReason={null}
        isConnecting={false}
        isEnvironmentUnavailable={false}
        isPreparingWorktree={false}
        hasSendableContent={false}
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
        planImplementationSuggestion={suggestion}
        planParallelismReviewStatus={review.status}
        onImplementPlan={onImplement}
        onImplementPlanInNewThread={() => {}}
      />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  __resetPlanParallelismReviewCacheForTests();
  planReview.request
    .mockReset()
    .mockImplementation(async ({ input }: { input: PlanParallelismReviewInput }) => ({
      _tag: "Success",
      value: {
        planId: input.planId,
        planUpdatedAt: input.expectedPlanUpdatedAt,
        implementationProviderInstanceId: input.implementationProviderInstanceId,
        recommendedSubagents: 4,
      },
    }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function button(text: string): HTMLButtonElement {
  const result = [...document.querySelectorAll("button")].find(
    (entry) => entry.textContent === text || entry.getAttribute("aria-label") === text,
  );
  if (!result) throw new Error(`Button not found: ${text}`);
  return result;
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("selects and removes extra archived chats without changing automatically included project chats", async () => {
  const remoteRef = {
    environmentId: EnvironmentId.make("remote"),
    projectId: ProjectId.make("other"),
    threadId: ThreadId.make("research"),
  };
  const options: DeepPlanSourceOption[] = [
    {
      ref: { environmentId, projectId, threadId },
      environmentLabel: "This Mac",
      projectTitle: "Project",
      title: "Current work",
      archived: false,
      available: true,
    },
    {
      ref: { environmentId, projectId, threadId: ThreadId.make("archive") },
      environmentLabel: "This Mac",
      projectTitle: "Project",
      title: "Project archive",
      archived: true,
      available: true,
    },
    {
      ref: remoteRef,
      environmentLabel: "Remote",
      projectTitle: "Other project",
      title: "Remote design",
      archived: true,
      available: true,
    },
  ];
  function Sources() {
    const [selected, setSelected] = useState<readonly DeepPlanSourceRef[]>([]);
    return (
      <DeepPlanSourcePicker
        currentProject={{ environmentId, projectId }}
        projectSourceCount={2}
        options={options}
        selected={selected}
        loading={false}
        error={null}
        onOpen={() => {}}
        onChange={setSelected}
      />
    );
  }
  await act(() => root.render(<Sources />));
  expect(container.textContent).toContain("2 project chats");
  await act(() => button("Add chats").click());
  const included = [...document.querySelectorAll<HTMLElement>('[data-slot="checkbox"]')].filter(
    (entry) => entry.getAttribute("aria-disabled") === "true",
  );
  expect(included).toHaveLength(2);
  expect(included.every((entry) => entry.getAttribute("aria-checked") === "true")).toBe(true);
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search chats…"]')!;
  await act(() => setInputValue(search, "Remote"));
  expect(document.querySelector('[data-slot="dialog-popup"]')?.textContent).not.toContain(
    "Current work",
  );
  const extra = document.querySelector<HTMLElement>('[data-slot="checkbox"]:not([data-disabled])')!;
  await act(() => extra.click());
  await act(() => button("Done").click());
  expect(container.textContent).toContain("Remote design");
  await act(() => button("Remove Remote design").click());
  expect(container.textContent).not.toContain("Remote design");
  expect(container.textContent).toContain("2 project chats");
  await act(() =>
    root.render(
      <DeepPlanSourcePicker
        currentProject={{ environmentId, projectId }}
        projectSourceCount={2}
        options={options}
        selected={[remoteRef]}
        loading={false}
        error={null}
        disabled
        frozen
        onOpen={() => {}}
        onChange={() => {}}
      />,
    ),
  );
  expect(container.textContent).toContain("Sources are fixed for this Deep Plan.");
  expect(button("Remove Remote design").disabled).toBe(true);
});

it("keeps the unfinished source visible as reading advances to a saved summary", async () => {
  const base = makeRun();
  const finished = base.sources[0]!;
  const reading = {
    ...finished,
    sourceId: DeepPlanSourceId.make("large-source"),
    threadTitle: "Large pipeline history",
    recordCount: 100,
  };
  let current = makeRun({
    phase: "planning",
    plan: null,
    sources: [finished, reading],
    sourceCoverage: [
      base.sourceCoverage[0]!,
      {
        ...base.sourceCoverage[0]!,
        sourceId: reading.sourceId,
        status: "ready",
        summary: null,
        importedRecordCount: 100,
        readRecordCount: 37,
      },
    ],
  });
  await act(() => root.render(<DeepPlanAnalysisProgress run={current} />));
  expect(container.textContent).toContain("1 of 2 sources analyzed");
  expect(container.querySelector("li")?.textContent).toContain("Large pipeline history");
  expect(container.querySelector("li")?.textContent).toContain("Reading · 37%");
  current = {
    ...current,
    sourceCoverage: current.sourceCoverage.map((entry) =>
      entry.sourceId === reading.sourceId ? { ...entry, readRecordCount: 100 } : entry,
    ),
  };
  await act(() => root.render(<DeepPlanAnalysisProgress run={current} />));
  expect(container.textContent).toContain("1 of 2 sources analyzed");
  expect(container.querySelector("li")?.textContent).toContain("Read · summary pending");
  expect(container.textContent).not.toContain("Reading · 37%");
  current = {
    ...current,
    sourceCoverage: current.sourceCoverage.map((entry) =>
      entry.sourceId === reading.sourceId
        ? { ...entry, status: "summarized", summary: base.sourceCoverage[0]!.summary }
        : entry,
    ),
  };
  await act(() => root.render(<DeepPlanAnalysisProgress run={current} />));
  expect(container.textContent).toContain("2 of 2 sources analyzed");
  expect(
    [...container.querySelectorAll("li")].every((row) => row.textContent?.includes("Done")),
  ).toBe(true);
});

it("automatically finishes preparation before starting analysis without a Resume click", async () => {
  let current = makeRun({
    phase: "collecting",
    revision: 0,
    plan: null,
    sources: [],
    sourceCoverage: [],
  });
  const source = makeRun().sources[0]!;
  let releaseExport!: (result: Awaited<ReturnType<DeepPlanningApi["exportSources"]>>) => void;
  let notifyExportStarted!: () => void;
  const exportStarted = new Promise<void>((resolve) => {
    notifyExportStarted = resolve;
  });
  const exported = new Promise<Awaited<ReturnType<DeepPlanningApi["exportSources"]>>>((resolve) => {
    releaseExport = resolve;
  });
  const commands: ClientOrchestrationCommand[] = [];
  const api: DeepPlanningApi = {
    getRun: async () => current,
    dispatchCommand: async (command) => {
      commands.push(command);
      if (command.type === "thread.deep-plan.start")
        current = { ...current, id: command.runId, revision: 0, phase: "collecting" };
      if (command.type === "thread.deep-plan.update")
        current = { ...current, revision: current.revision + 1, phase: "paused" };
    },
    catalogSources: async () => {
      throw new Error("Unexpected metadata request");
    },
    exportSources: () => {
      notifyExportStarted();
      return exported;
    },
    initializeSources: async (input) => {
      current = {
        ...current,
        sources: input.snapshots,
        sourceCoverage: input.snapshots.map((snapshot) => ({
          sourceId: snapshot.sourceId,
          status: "ready",
          importedRecordCount: snapshot.recordCount,
          readRecordCount: 0,
          summary: null,
          error: null,
          updatedAt: createdAt,
        })),
        phase: "planning",
        revision: 1,
      };
      renderRun();
      return { runId: current.id, sources: current.sources, coverage: current.sourceCoverage };
    },
    readExportChunk: async () => {
      throw new Error("Local histories are already imported");
    },
    importSourceChunk: async () => {
      throw new Error("Local histories must not be uploaded again");
    },
  };
  let nextId = 0;
  let continuation: Promise<DeepPlanRun> | undefined;
  const resume = async () => {
    continuation = continueDeepPlanForTurn({
      run: current,
      environmentId,
      projectId,
      fallbackModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      runtimeMode: "full-access",
      apiForEnvironment: () => api,
      createId: () => `resumed-${++nextId}`,
      now: () => createdAt,
    });
    await continuation;
  };
  function renderRun() {
    root.render(
      <>
        <DeepPlanAnalysisProgress run={current} />
        <DeepPlanRunControls
          environmentId={environmentId}
          run={current}
          disabled={false}
          canContinue
          onResume={resume}
          onFinalValidation={resume}
        />
      </>,
    );
  }
  await act(renderRun);
  expect(container.textContent).toContain("Preparing chat histories…");
  expect(container.textContent).not.toContain("0 of 0");
  expect(container.querySelector("progress")).toBeNull();
  await exportStarted;
  expect(container.textContent).not.toContain("Resume to finish");
  expect(container.textContent).not.toContain("Resume");
  expect(commands.some((command) => command.type === "thread.turn.start")).toBe(false);
  await act(async () => {
    releaseExport({
      exportId: DeepPlanExportId.make("resumed-export"),
      capturedAt: createdAt,
      sources: [source],
      nextCursor: null,
    });
    await continuation;
  });
  expect(container.textContent).toContain("0 of 1 sources analyzed");
  expect(container.textContent).toContain("Archived research");
  expect(commands.filter((command) => command.type === "thread.turn.start")).toHaveLength(1);
});

it("keeps frozen sources with missing coverage visible and blocks approval", async () => {
  const run = makeRun({ sourceCoverage: [] });
  const implement = vi.fn();
  await act(() =>
    root.render(<PlanComposer run={run} plan={proposal(run)} onImplement={implement} />),
  );
  expect(container.textContent).toContain("Archived research");
  expect(container.textContent).toContain("0 of 1 sources analyzed");
  expect(getDeepPlanProposalBlockReason(proposal(run), run)).toContain("fully read and summarized");
  expect(container.querySelector("[data-chat-composer-implement-actions]")).toBeNull();
  expect(planReview.request).not.toHaveBeenCalled();
  expect(implement).not.toHaveBeenCalled();
});

it("separates implemented work from verified steps and final validation while keeping checklist disclosure state", async () => {
  const run = makeRun({
    phase: "implementing",
    stepStates: [
      { stepId: "build", status: "implemented", evidence, updatedAt: createdAt },
      { stepId: "verify", status: "inProgress", evidence: [], updatedAt: createdAt },
    ],
  });
  await act(() =>
    root.render(<DeepPlanChecklist environmentId={environmentId} key="owner" run={run} />),
  );
  expect(container.textContent).toContain("0 of 2 verified");
  expect(container.textContent).toContain("Current: Verify the workflow");
  expect(container.textContent).toContain("Final validation has not run");
  const firstStep = container.querySelector("details")!;
  await act(() => {
    firstStep.open = true;
  });
  expect(firstStep.textContent).toContain("Archived sources are included");
  expect(firstStep.textContent).toContain("Focused workflow checks passed");
  await act(() => button("Collapse checklist").click());
  expect(container.querySelector("details")).toBeNull();
  const verified = {
    ...run,
    stepStates: run.stepStates.map((state) => ({
      ...state,
      status: "verified" as const,
      evidence,
    })),
  };
  await act(() =>
    root.render(<DeepPlanChecklist environmentId={environmentId} key="owner" run={verified} />),
  );
  expect(container.textContent).toContain("2 of 2 verified");
  expect(button("Expand checklist").getAttribute("aria-expanded")).toBe("false");
  await act(() =>
    root.render(
      <DeepPlanChecklist
        environmentId={environmentId}
        key="different-thread"
        run={makeRun({ id: DeepPlanRunId.make("different-run"), threadId: ThreadId.make("other") })}
      />,
    ),
  );
  expect(button("Collapse checklist").getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).not.toContain("Focused workflow checks passed");
});

it.each([false, true])("restores the checklist expansion %s after remounting", async (expanded) => {
  const run = makeRun();
  await act(() => root.render(<DeepPlanChecklist environmentId={environmentId} run={run} />));
  await act(() => button("Collapse checklist").click());
  if (expanded) await act(() => button("Expand checklist").click());

  await act(() => root.unmount());
  root = createRoot(container);
  await act(() => root.render(<DeepPlanChecklist environmentId={environmentId} run={run} />));

  expect(container.querySelector("ol") !== null).toBe(expanded);
  expect(
    button(expanded ? "Collapse checklist" : "Expand checklist").getAttribute("aria-expanded"),
  ).toBe(String(expanded));
});

it("keeps checklist choices separate by chat and environment, including implementation chats", async () => {
  const run = makeRun();
  const implementationThreadId = ThreadId.make("implementation");
  const remoteEnvironmentId = EnvironmentId.make("remote");
  const render = (
    environment = environmentId,
    currentThreadId = threadId,
    placement: "composer" | "plan" = "composer",
  ) =>
    root.render(
      <DeepPlanChecklist
        run={run}
        environmentId={environment}
        threadId={currentThreadId}
        placement={placement}
      />,
    );

  await act(() => render(environmentId, implementationThreadId));
  await act(() => button("Collapse checklist").click());
  await act(() => render());
  expect(container.querySelector("ol")).not.toBeNull();
  await act(() => render(remoteEnvironmentId, implementationThreadId));
  expect(container.querySelector("ol")).not.toBeNull();
  await act(() => render(environmentId, implementationThreadId, "plan"));
  expect(container.querySelector("ol")).toBeNull();
  await act(() => button("Expand checklist").click());
  await act(() => render(environmentId, implementationThreadId));
  expect(container.querySelector("ol")).not.toBeNull();
});

function completedRun(updatedAt: string): DeepPlanRun {
  const run = makeRun();
  return {
    ...run,
    phase: "completed",
    updatedAt,
    approval: {
      planVersion: 1,
      approvalKey: run.approvalKey!,
      approvedAt: updatedAt,
      approvedBy: "user",
      implementation: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
      implementationThreadId: threadId,
      implementerId: "same-agent",
    },
    stepStates: run.plan!.steps.map((step) => ({
      stepId: step.id,
      status: "verified",
      evidence,
      updatedAt,
    })),
    finalValidation: { ...run.finalValidation, status: "passed", evidence, updatedAt },
  };
}

it("removes the composer checklist a minute after an active run completes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(createdAt);
  const run = completedRun(createdAt);
  await act(() =>
    root.render(
      <DeepPlanChecklist environmentId={environmentId} run={{ ...run, phase: "implementing" }} />,
    ),
  );
  await act(() => vi.advanceTimersByTime(120_000));
  expect(container.textContent).toContain("Deep checklist");

  const finished = { ...run, updatedAt: new Date().toISOString() };
  await act(() => root.render(<DeepPlanChecklist environmentId={environmentId} run={finished} />));
  await act(() => vi.advanceTimersByTime(59_999));
  expect(container.textContent).toContain("2 of 2 verified");
  await act(() => vi.advanceTimersByTime(1));
  expect(container.textContent).toBe("");
});

it("keeps old completed checklists out of the composer on revisit but available in the plan", async () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-16T10:10:00.000Z");
  const run = completedRun(createdAt);
  await act(() => root.render(<DeepPlanChecklist environmentId={environmentId} run={run} />));
  expect(container.textContent).toBe("");
  await act(() =>
    root.render(<DeepPlanChecklist environmentId={environmentId} key="revisit" run={run} />),
  );
  expect(container.textContent).toBe("");

  await act(() =>
    root.render(<DeepPlanChecklist environmentId={environmentId} run={run} placement="plan" />),
  );
  expect(container.textContent).toContain("2 of 2 verified");
  expect(container.textContent).toContain("Focused workflow checks passed");
});

it("uses the remaining completion time and cancels it when another plan becomes active", async () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-16T10:00:45.000Z");
  await act(() =>
    root.render(<DeepPlanChecklist environmentId={environmentId} run={completedRun(createdAt)} />),
  );
  await act(() => vi.advanceTimersByTime(14_999));
  expect(container.textContent).toContain("Deep checklist");
  await act(() => vi.advanceTimersByTime(1));
  expect(container.textContent).toBe("");

  const next = makeRun({ id: DeepPlanRunId.make("next"), phase: "implementing" });
  await act(() => root.render(<DeepPlanChecklist environmentId={environmentId} run={next} />));
  await act(() => vi.advanceTimersByTime(120_000));
  expect(container.textContent).toContain("Current: Build the workflow");

  const finished = completedRun(new Date().toISOString());
  await act(() => root.render(<DeepPlanChecklist environmentId={environmentId} run={finished} />));
  await act(() => root.render(<DeepPlanChecklist environmentId={environmentId} run={next} />));
  await act(() => vi.advanceTimersByTime(60_000));
  expect(container.textContent).toContain("Current: Build the workflow");
});

it("shows the structured Deep Plan and its interactive checklist in the normal plan card", async () => {
  const run = makeRun();
  await act(() =>
    root.render(
      <DeepPlanReviewCard
        run={run}
        environmentId={environmentId}
        threadRef={{ environmentId, threadId }}
        workspaceRoot={undefined}
      />,
    ),
  );
  const card = container.querySelector('[data-plan-kind="deep-plan"]')!;
  expect(card.querySelector("h3")?.textContent).toBe("Ship Deep Planning");
  expect(card.querySelector("[data-deep-plan-checklist]")).not.toBeNull();
  expect(card.textContent).toContain("Project / Archived research");
  expect(card.textContent).not.toContain("build-check");
  const summary = [...card.querySelectorAll("summary")].find((item) =>
    item.textContent?.includes("Build the workflow"),
  )!;
  await act(() => summary.click());
  expect(summary.parentElement?.hasAttribute("open")).toBe(true);
  expect(summary.parentElement?.textContent).toContain("Run source collection tests");
  expect(card.querySelector("input")).toBeNull();
  expect(card.textContent).not.toContain("Implement plan");
});

it("keeps the in-plan checklist live with named sources, dependencies and final checks", async () => {
  const initial = makeRun();
  const run = makeRun({
    plan: {
      ...initial.plan!,
      steps: initial.plan!.steps.map((step) => ({
        ...step,
        sources: [{ sourceId, recordIds: ["private-message-reference"] }],
        acceptanceCriteria: step.acceptanceCriteria.map((criterion) => ({
          ...criterion,
          sources: [{ sourceId, recordIds: ["private-message-reference"] }],
        })),
      })),
    },
  });
  await act(() =>
    root.render(<DeepPlanChecklist environmentId={environmentId} run={run} placement="plan" />),
  );
  const checklist = container.querySelector("[data-deep-plan-checklist]")!;
  const steps = checklist.querySelectorAll("details");
  await act(() => {
    steps[1]!.open = true;
  });
  expect(steps[1]!.textContent).toContain("Depends on: Build the workflow");
  expect(steps[1]!.textContent).toContain("Project / Archived research");
  expect(steps[1]!.textContent).not.toContain("private-message-reference");
  expect(checklist.textContent).toContain("Run final integration checks");
  await act(() =>
    root.render(
      <DeepPlanChecklist
        environmentId={environmentId}
        run={{
          ...run,
          stepStates: [{ stepId: "build", status: "verified", evidence, updatedAt: createdAt }],
        }}
        placement="plan"
      />,
    ),
  );
  expect(checklist.textContent).toContain("1 of 2 verified");
  expect(steps[1]!.open).toBe(true);
  await act(() => button("Collapse checklist").click());
  expect(checklist.querySelector("details")).toBeNull();
});

it("analyzes a Deep Plan through the normal composer and offers the reviewed agent count", async () => {
  const run = makeRun();
  const plan = proposal(run);
  const implement = vi.fn();
  let resolveReview!: (result: unknown) => void;
  planReview.request.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveReview = resolve;
    }),
  );
  await act(() => root.render(<PlanComposer run={run} plan={plan} onImplement={implement} />));
  expect(button("Analyzing plan…").disabled).toBe(true);
  expect(planReview.request).toHaveBeenCalledWith({
    environmentId,
    input: {
      threadId,
      planId: plan.id,
      expectedPlanUpdatedAt: plan.updatedAt,
      implementationProviderInstanceId: implementationProvider.instanceId,
    },
  });
  const card = container.querySelector('[data-plan-kind="deep-plan"]')!;
  expect(card.querySelector("[data-chat-composer-implement-actions]")).toBeNull();
  await act(() =>
    resolveReview({
      _tag: "Success",
      value: {
        planId: plan.id,
        planUpdatedAt: plan.updatedAt,
        implementationProviderInstanceId: implementationProvider.instanceId,
        recommendedSubagents: 4,
      },
    }),
  );
  const action = button("Implement with 4 subagents");
  expect(action.disabled).toBe(false);
  await act(() => action.click());
  expect(implement).toHaveBeenCalledWith({ kind: "subagents", count: 4 });
  await act(() => button("Implementation actions").click());
  const menu = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
  expect(menu).toContain("Implement normally");
  expect(menu.some((label) => label?.includes("new thread"))).toBe(true);
});

it("keeps Resume and retry errors in the checklist when collapsed", async () => {
  const run = {
    ...completedRun(createdAt),
    phase: "paused" as const,
    pauseReason: "Reconnect to continue.",
  };
  const resume = vi.fn(async () => {
    throw new Error("Connection is still unavailable.");
  });
  await act(() =>
    root.render(
      <DeepPlanRunControls
        run={run}
        environmentId={environmentId}
        disabled={false}
        onResume={resume}
        onFinalValidation={async () => {}}
      />,
    ),
  );
  const checklist = container.querySelector("[data-deep-plan-checklist]")!;
  expect(button("Resume").parentElement).toBe(button("Collapse checklist").parentElement);
  await act(() => button("Collapse checklist").click());
  expect(checklist.querySelector("ol")).toBeNull();
  expect(checklist.contains(button("Resume"))).toBe(true);
  await act(() => button("Resume").click());
  expect(resume).toHaveBeenCalledTimes(1);
  expect(checklist.querySelector('[role="alert"]')?.textContent).toBe(
    "Connection is still unavailable.",
  );
  expect(button("Resume").disabled).toBe(false);
});

it("shows a recoverable resume error without hiding the durable blocker", async () => {
  const run = makeRun({ phase: "blocked", pauseReason: "Reconnect the source environment." });
  await act(() =>
    root.render(
      <DeepPlanRunControls
        environmentId={environmentId}
        run={run}
        disabled={false}
        onResume={async () => {
          throw new Error("The source is still offline.");
        }}
        onFinalValidation={async () => {}}
      />,
    ),
  );
  expect(container.textContent).toContain("Reconnect the source environment.");
  await act(() => button("Resume").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "The source is still offline.",
  );
  expect(button("Resume").disabled).toBe(false);
});

it("keeps final validation separate after all steps are verified", async () => {
  const initial = makeRun();
  const approval = {
    planVersion: 1,
    approvalKey: "approval-key",
    approvedAt: createdAt,
    approvedBy: "user",
    implementation: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
    implementationThreadId: threadId,
    implementerId: `thread:${threadId}`,
  };
  const run = makeRun({
    phase: "implementing",
    approval,
    stepStates: initial.plan!.steps.map((step) => ({
      stepId: step.id,
      status: "verified",
      evidence,
      updatedAt: createdAt,
    })),
  });
  const render = (value: DeepPlanRun) =>
    root.render(
      <>
        <DeepPlanRunControls
          environmentId={environmentId}
          run={value}
          disabled={false}
          onResume={async () => {}}
          onFinalValidation={async () => {}}
        />
      </>,
    );
  await act(() => render(run));
  expect(container.textContent).toContain("2 of 2 verified");
  expect(container.textContent).toContain("Final validation has not run");
  expect(button("Run final validation").disabled).toBe(false);
  await act(() =>
    render({
      ...run,
      phase: "validating",
      finalValidation: {
        ...run.finalValidation,
        status: "inProgress",
        requestId: "validation-request",
        attempt: 1,
        updatedAt: createdAt,
      },
    }),
  );
  expect(container.textContent).not.toContain("Run final validation");
  expect(container.querySelector("[data-deep-plan-final-validation]")?.textContent).toContain(
    "In progress",
  );
});

it("selects Deep Plan from the compact menu and explains unsupported environments", async () => {
  function Modes({ reason }: { reason: string | null }) {
    const [mode, setMode] = useState<ComposerMode>("plan");
    return (
      <>
        <output>{mode}</output>
        <CompactComposerControlsMenu
          interactionMode="plan"
          composerMode={mode}
          deepPlanningDisabledReason={reason}
          runtimeMode="full-access"
          showInteractionModeToggle
          onToggleInteractionMode={() => {}}
          onComposerModeChange={setMode}
          onRuntimeModeChange={() => {}}
        />
      </>
    );
  }
  await act(() => root.render(<Modes reason="This server needs an update." />));
  await act(() => container.querySelector("button")!.click());
  const disabledDeepPlan = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ].find((entry) => entry.textContent?.includes("Deep Plan"))!;
  expect(disabledDeepPlan.getAttribute("aria-disabled")).toBe("true");
  expect(disabledDeepPlan.textContent).toContain("This server needs an update.");
  await act(() => root.render(<Modes reason={null} />));
  const deepPlan = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (entry) => entry.textContent === "Deep Plan",
  )!;
  await act(() => deepPlan.click());
  expect(container.querySelector("output")?.textContent).toBe("deep-plan");
});

it("cycles the existing composer control through Build, Plan, and Deep Plan with click and Shift+Tab", async () => {
  function ModeButton() {
    const [mode, setMode] = useState<ComposerMode>("default");
    return (
      <TooltipProvider>
        <ComposerInteractionModeButton
          mode={mode}
          onCycle={() => setMode((current) => getNextComposerMode(current))}
        />
      </TooltipProvider>
    );
  }
  await act(() => root.render(<ModeButton />));
  expect(button("Build").getAttribute("aria-pressed")).toBe("false");
  await act(() => button("Build").click());
  expect(button("Plan").getAttribute("aria-pressed")).toBe("true");
  await act(() =>
    button("Plan").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(button("Deep Plan").getAttribute("aria-pressed")).toBe("true");
  await act(() => button("Deep Plan").click());
  expect(button("Build").getAttribute("aria-pressed")).toBe("false");
});

it("automatically continues once per idle turn, including under Strict Mode", async () => {
  const resume = vi.fn(async () => {});
  let run = makeRun({ phase: "planning", plan: null });
  let latestTurnId = TurnId.make("initial-turn");
  const renderControls = (canContinue = true) =>
    root.render(
      <StrictMode>
        <DeepPlanRunControls
          environmentId={environmentId}
          run={run}
          disabled={!canContinue}
          canContinue={canContinue}
          latestTurnId={latestTurnId}
          onResume={resume}
          onFinalValidation={resume}
        />
      </StrictMode>,
    );
  await act(() => renderControls());
  expect(resume).toHaveBeenCalledExactlyOnceWith(true);
  expect(button("Resume").disabled).toBe(false);
  run = { ...run, revision: run.revision + 1 };
  await act(() => renderControls());
  expect(resume).toHaveBeenCalledTimes(1);
  latestTurnId = TurnId.make("continued-turn");
  await act(() => renderControls(false));
  expect(resume).toHaveBeenCalledTimes(1);
  await act(() => renderControls());
  expect(resume).toHaveBeenCalledTimes(2);
  run = { ...run, phase: "paused", pauseReason: "Stopped by the user." };
  latestTurnId = TurnId.make("stopped-turn");
  await act(() => renderControls());
  expect(resume).toHaveBeenCalledTimes(2);
  expect(button("Resume").disabled).toBe(false);
});

it("shows a failed automatic continuation and lets the user retry", async () => {
  const resume = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("Source environment disconnected"))
    .mockResolvedValue(undefined);
  await act(() =>
    root.render(
      <DeepPlanRunControls
        environmentId={environmentId}
        run={makeRun({ phase: "planning", plan: null })}
        disabled={false}
        canContinue
        onResume={resume}
        onFinalValidation={resume}
      />,
    ),
  );
  expect(resume).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Source environment disconnected",
  );
  await act(() => button("Resume").click());
  expect(resume).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("automatically retries unfinished work after reconnecting", async () => {
  const resume = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("Environment disconnected"))
    .mockResolvedValue(undefined);
  const run = makeRun({ phase: "collecting", plan: null });
  const renderControls = (connected: boolean) =>
    root.render(
      <DeepPlanRunControls
        environmentId={environmentId}
        run={run}
        connected={connected}
        disabled={!connected}
        canContinue={connected}
        onResume={resume}
        onFinalValidation={resume}
      />,
    );
  await act(() => renderControls(true));
  expect(resume).toHaveBeenCalledTimes(1);
  await act(() => renderControls(false));
  expect(resume).toHaveBeenCalledTimes(1);
  await act(() => renderControls(true));
  expect(resume).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("does not automatically repeat a manual Resume while startup is being acknowledged", async () => {
  let run = makeRun({ phase: "paused", plan: null });
  const resume = vi.fn(async () => {});
  const latestTurnId = TurnId.make("last-completed-turn");
  const renderControls = (canContinue = true) =>
    root.render(
      <DeepPlanRunControls
        environmentId={environmentId}
        run={run}
        disabled={!canContinue}
        canContinue={canContinue}
        latestTurnId={latestTurnId}
        onResume={resume}
        onFinalValidation={resume}
      />,
    );
  await act(() => renderControls());
  await act(() => button("Resume").click());
  expect(resume).toHaveBeenCalledTimes(1);
  run = { ...run, phase: "planning", revision: run.revision + 1 };
  await act(() => renderControls(false));
  await act(() => renderControls());
  expect(resume).toHaveBeenCalledTimes(1);
});
