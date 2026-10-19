// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  DeepPlanRunId,
  DeepPlanSourceId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
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
  await act(() => root.render(<DeepPlanChecklist key="owner" run={run} />));
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
  await act(() => root.render(<DeepPlanChecklist key="owner" run={verified} />));
  expect(container.textContent).toContain("2 of 2 verified");
  expect(button("Expand checklist").getAttribute("aria-expanded")).toBe("false");
  await act(() =>
    root.render(
      <DeepPlanChecklist
        key="different-thread"
        run={makeRun({ id: DeepPlanRunId.make("different-run") })}
      />,
    ),
  );
  expect(button("Collapse checklist").getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).not.toContain("Focused workflow checks passed");
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
  await act(() => root.render(<DeepPlanChecklist run={{ ...run, phase: "implementing" }} />));
  await act(() => vi.advanceTimersByTime(120_000));
  expect(container.textContent).toContain("Deep checklist");

  const finished = { ...run, updatedAt: new Date().toISOString() };
  await act(() => root.render(<DeepPlanChecklist run={finished} />));
  await act(() => vi.advanceTimersByTime(59_999));
  expect(container.textContent).toContain("2 of 2 verified");
  await act(() => vi.advanceTimersByTime(1));
  expect(container.textContent).toBe("");
});

it("keeps old completed checklists out of the composer on revisit but available in the plan", async () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-16T10:10:00.000Z");
  const run = completedRun(createdAt);
  await act(() => root.render(<DeepPlanChecklist run={run} />));
  expect(container.textContent).toBe("");
  await act(() => root.render(<DeepPlanChecklist key="revisit" run={run} />));
  expect(container.textContent).toBe("");

  await act(() => root.render(<DeepPlanChecklist run={run} placement="plan" />));
  expect(container.textContent).toContain("2 of 2 verified");
  expect(container.textContent).toContain("Focused workflow checks passed");
});

it("uses the remaining completion time and cancels it when another plan becomes active", async () => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-16T10:00:45.000Z");
  await act(() => root.render(<DeepPlanChecklist run={completedRun(createdAt)} />));
  await act(() => vi.advanceTimersByTime(14_999));
  expect(container.textContent).toContain("Deep checklist");
  await act(() => vi.advanceTimersByTime(1));
  expect(container.textContent).toBe("");

  const next = makeRun({ id: DeepPlanRunId.make("next"), phase: "implementing" });
  await act(() => root.render(<DeepPlanChecklist run={next} />));
  await act(() => vi.advanceTimersByTime(120_000));
  expect(container.textContent).toContain("Current: Build the workflow");

  const finished = completedRun(new Date().toISOString());
  await act(() => root.render(<DeepPlanChecklist run={finished} />));
  await act(() => root.render(<DeepPlanChecklist run={next} />));
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
  await act(() => root.render(<DeepPlanChecklist run={run} placement="plan" />));
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

it("shows a recoverable resume error without hiding the durable blocker", async () => {
  const run = makeRun({ phase: "blocked", pauseReason: "Reconnect the source environment." });
  await act(() =>
    root.render(
      <DeepPlanRunControls
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
        <DeepPlanChecklist run={value} />
        <DeepPlanRunControls
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
