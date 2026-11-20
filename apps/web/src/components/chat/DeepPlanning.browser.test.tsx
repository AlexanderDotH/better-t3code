import { act, fakeTimers, render } from "../../../test/render";
import { getNextComposerMode } from "@t3tools/client-runtime/deep-planning";
import {
  DeepPlanRunId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  deriveDeepPlanImplementationThreadId,
  type ComposerMode,
  type DeepPlanReview,
  type DeepPlanRun,
  type DeepPlanSourceRef,
  type ModelSelection,
  type StoredDeepPlanRun,
} from "@t3tools/contracts";
import { StrictMode, useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent, type Locator } from "vite-plus/test/browser";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { TooltipProvider } from "../ui/tooltip";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerInteractionModeButton } from "./ComposerInteractionModeButton";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { DeepPlanChecklist } from "./DeepPlanProgress";
import { DeepPlanRunControls } from "./DeepPlanRunControls";
import { DeepPlanSourcePicker, type DeepPlanSourceOption } from "./DeepPlanSourcePicker";
import { runtimeModeConfig } from "./runtimeModeConfig";
import { useDeepPlanChat } from "./useDeepPlanChat";

vi.mock("../ChatMarkdown", () => ({ default: ({ text }: { text: string }) => <div>{text}</div> }));
const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => mocks.dispatch,
}));
vi.mock("../../hooks/useSettings", async (original) => ({
  ...(await original<typeof import("../../hooks/useSettings")>()),
  useClientSettings: () => false,
  useEnvironmentIdentificationMode: () => "none",
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("owner");
const owner = { environmentId, threadId };
const createdAt = "2026-10-16T10:00:00.000Z";
const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "implementation",
};

function makeRun(overrides: Partial<DeepPlanRun> = {}): DeepPlanRun {
  const steps = ["build", "verify", "document", "package", "test"].map((id) => ({
    id,
    title: `Step ${id}`,
    description: `Complete ${id}`,
    dependencies: [],
    acceptanceCriteria: [
      { id: `${id}-check`, description: "The workflow runs", checkMethod: "Run focused tests" },
    ],
  }));
  return {
    schemaVersion: 2,
    id: DeepPlanRunId.make("run"),
    threadId,
    phase: "awaitingApproval",
    revision: 3,
    plan: {
      schemaVersion: 2,
      version: 1,
      goal: "Ship Deep Planning",
      scope: ["All connected clients"],
      nonGoals: [],
      decisions: [],
      affectedAreas: ["Composer"],
      steps,
      finalValidation: { description: "Validate the integration", checkMethod: "Run checks" },
    },
    chats: [],
    includeProjectChats: false,
    approval: null,
    approvalKey: "approval-key",
    steps: [],
    finalReview: {
      status: "pending",
      reviews: [],
      submission: null,
      roundLimit: 3,
      unsubmittedTurns: 0,
    },
    activeTurns: [],
    pause: null,
    operations: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function ComposerDeepPlanContent({
  run,
  working = false,
  readOnlyReview = false,
  supported = true,
}: {
  run: StoredDeepPlanRun | null;
  working?: boolean;
  readOnlyReview?: boolean;
  supported?: boolean;
}) {
  const chat = useDeepPlanChat({
    environmentId,
    threadRef: owner,
    projectId,
    workspaceRoot: undefined,
    draftTarget: owner,
    mode: "deep-plan",
    run,
    threadShells: [],
    supported,
    connected: true,
    canOperate: true,
    working,
    readOnlyReview,
    providers: [],
    modelSelection,
    getModelSelection: () => modelSelection,
  });
  const implementation = chat.implementation;
  return (
    <>
      {chat.content}
      {implementation ? (
        <ComposerPrimaryActions
          compact={false}
          canOperateThread
          canInterrupt={false}
          pendingAction={null}
          isRunning={false}
          showPlanFollowUpPrompt={false}
          showPlanImplementationActions
          planTone="deep-plan"
          promptHasText={false}
          isSendBusy={implementation.pending}
          sendDisabledReason={null}
          isEnvironmentUnavailable={false}
          isPreparingWorktree={false}
          hasSendableContent={false}
          onPreviousPendingQuestion={() => {}}
          onInterrupt={() => {}}
          planImplementationSuggestion={implementation.suggestion}
          onImplementPlan={(strategy) => implementation.implement(strategy, false)}
          onImplementPlanInNewThread={(strategy) => implementation.implement(strategy, true)}
        />
      ) : null}
    </>
  );
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const matches = (entry: HTMLButtonElement) =>
    entry.textContent === text || entry.getAttribute("aria-label") === text;
  const result =
    [...container.querySelectorAll("button")].find(matches) ??
    [...document.querySelectorAll("button")].find(matches);
  if (!result) throw new Error(`Button not found: ${text}`);
  return result;
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("selects and removes extra archived chats without changing automatically included project chats", async () => {
  setup();
  await using screen = await render(null);
  const container = screen.container;

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
        includeProjectChats
        loading={false}
        error={null}
        onOpen={() => {}}
        onChange={setSelected}
      />
    );
  }
  await act(() => screen.rerender(<Sources />));
  expect(container.textContent).toContain("2 project chats");
  await act(() => button(container, "Add chats").click());
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
  const extra = document.querySelector<HTMLElement>(
    '[data-slot="checkbox"][aria-label="Remote design"]',
  )!;
  await act(() => extra.click());
  await act(() => button(container, "Done").click());
  expect(container.textContent).toContain("Remote design");
  await act(() => button(container, "Remove Remote design").click());
  expect(container.textContent).not.toContain("Remote design");
  expect(container.textContent).toContain("2 project chats");
});

it("starts without project chats and can opt in", async () => {
  setup();
  const archive = { environmentId, projectId, threadId: ThreadId.make("archive") };
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
      ref: archive,
      environmentLabel: "This Mac",
      projectTitle: "Project",
      title: "Project archive",
      archived: true,
      available: true,
    },
  ];
  const onChange = vi.fn();
  function Sources() {
    const [state, setState] = useState<{
      refs: readonly DeepPlanSourceRef[];
      include: boolean;
    }>({ refs: [], include: false });
    return (
      <DeepPlanSourcePicker
        currentProject={{ environmentId, projectId }}
        projectSourceCount={2}
        options={options}
        selected={state.refs}
        includeProjectChats={state.include}
        loading={false}
        error={null}
        onOpen={() => {}}
        onChange={(refs, include) => {
          onChange(refs, include);
          setState({ refs, include });
        }}
      />
    );
  }
  await using screen = await render(<Sources />);
  // The dialog's inert backdrop covers its content without the app stylesheet.
  const clickInDialog = async (locator: Locator) => {
    await expect.element(locator).toBeInTheDocument();
    await act(() => (locator.element() as HTMLElement).click());
  };
  await userEvent.click(screen.getByRole("button", { name: "Add chats" }));
  const includeAll = page.getByRole("checkbox", { name: "Include all chats from this project" });
  await expect.element(includeAll).not.toBeChecked();
  await expect.element(page.getByRole("checkbox", { name: "Current work" })).not.toBeChecked();
  await expect.element(screen.getByText("No project chats")).toBeInTheDocument();
  await clickInDialog(page.getByRole("checkbox", { name: "Project archive" }));
  expect(onChange).toHaveBeenLastCalledWith([archive], false);
  await expect.element(screen.getByText("1 project chat")).toBeInTheDocument();
  await clickInDialog(includeAll);
  expect(onChange).toHaveBeenLastCalledWith([], true);
  await expect.element(page.getByRole("checkbox", { name: "Current work" })).toBeChecked();
  await expect.element(screen.getByText("2 project chats")).toBeInTheDocument();
});

it("offers chat selection only before a run starts", async () => {
  setup();
  await using screen = await render(<ComposerDeepPlanContent run={null} />);
  const sources = screen.getByRole("button", { name: "Add chats" });
  await expect.element(sources).toBeVisible();

  await screen.rerender(<ComposerDeepPlanContent run={null} working />);
  await expect.element(sources).not.toBeInTheDocument();

  await screen.rerender(
    <ComposerDeepPlanContent run={makeRun({ phase: "planning", plan: null })} />,
  );
  await expect.element(sources).not.toBeInTheDocument();

  await screen.rerender(<ComposerDeepPlanContent run={makeRun({ phase: "cancelled" })} />);
  await expect.element(sources).toBeVisible();
});

it.each(["current", "new"] as const)("approves in a %s chat with one dispatch", async (target) => {
  setup();
  const run = makeRun();
  await using screen = await render(<ComposerDeepPlanContent run={run} />);
  using navigate = vi.spyOn(screen.router!, "navigate").mockResolvedValue(undefined);
  if (target === "new") {
    await userEvent.click(screen.getByRole("button", { name: "Implementation actions" }));
    const item = page.getByRole("menuitem", { name: "Implement with 4 lanes in a new thread" });
    await expect.element(item).toBeVisible();
    await act(() => (item.element() as HTMLElement).click());
  } else {
    await userEvent.click(screen.getByRole("button", { name: "Implement with 4 lanes" }));
  }
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: expect.objectContaining({
      type: "thread.deep-plan.update",
      threadId,
      runId: run.id,
      expectedRevision: 3,
      mutation: {
        type: "approve",
        planVersion: 1,
        approvalKey: "approval-key",
        implementation: modelSelection,
        implementationThread: target,
        parallelism: 4,
      },
    }),
  });
  if (target === "new") {
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: deriveDeepPlanImplementationThreadId(run.id, 1) },
    });
    expect(mocks.dispatch).toHaveBeenCalledBefore(navigate);
  } else {
    expect(navigate).not.toHaveBeenCalled();
  }
});

it("leaves idle Deep Plan runs to the server under Strict Mode", async () => {
  setup();
  const planning = makeRun({ phase: "planning", plan: null });
  const controls = (run: DeepPlanRun) => (
    <StrictMode>
      <DeepPlanRunControls
        run={run}
        threadRef={owner}
        threadShells={[]}
        disabled={false}
        supported
      />
    </StrictMode>
  );
  await using screen = await render(controls(planning));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Planning");
  await screen.rerender(controls({ ...planning, phase: "implementing", revision: 4 }));
  await expect.element(screen.getByRole("status")).toHaveTextContent("Waiting for the next step");
  await screen.rerender(
    controls({
      ...planning,
      phase: "paused",
      revision: 5,
      pause: { kind: "user", reason: "Stopped by the user.", at: createdAt },
    }),
  );
  expect(mocks.dispatch).not.toHaveBeenCalled();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Paused by you");
  await userEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: expect.objectContaining({
      type: "thread.deep-plan.update",
      threadId,
      runId: planning.id,
      expectedRevision: 5,
      mutation: { type: "resume" },
    }),
  });
});

it("shows findings from the last verdict and links to the current review", async () => {
  setup();
  const review: DeepPlanReview = {
    round: 1,
    reviewThreadId: ThreadId.make("review-round-1"),
    reviewer: modelSelection,
    diff: null,
    verdict: "changesRequested",
    summary: "The disconnect path needs a test.",
    findings: [
      {
        severity: "major",
        title: "Missing reconnect coverage",
        detail: "Exercise the reconnect path with a queued message.",
        file: "chat.ts",
        line: 42,
      },
    ],
    retries: 0,
    startedAt: createdAt,
    completedAt: createdAt,
  };
  const currentReview = {
    ...review,
    round: 2,
    reviewThreadId: ThreadId.make("review-round-2"),
    verdict: null,
    summary: null,
    findings: [],
    completedAt: null,
  };
  const run = makeRun({
    phase: "implementing",
    approval: {
      planVersion: 1,
      approvalKey: "approval-key",
      approvedAt: createdAt,
      implementation: modelSelection,
      reviewer: modelSelection,
      parallelism: 1,
      lanes: [{ laneId: "lane-1", threadId }],
      baseTurnCount: 0,
    },
    steps: [
      {
        stepId: "build",
        status: "inReview",
        laneId: "lane-1",
        baseTurnCount: 0,
        submission: null,
        reviews: [review, currentReview],
        roundLimit: 3,
        unsubmittedTurns: 0,
      },
    ],
  });
  await using screen = await render(<DeepPlanChecklist run={run} environmentId={environmentId} />);
  const firstStep = screen.getByText("1. Step build");
  await userEvent.click(firstStep);
  await expect
    .element(screen.getByText("In review · Lane 1 · Round 2/3 · Changes requested"))
    .toBeVisible();
  await expect.element(screen.getByText("The disconnect path needs a test.")).toBeVisible();
  await expect.element(screen.getByText("Major · Missing reconnect coverage")).toBeVisible();
  await expect.element(screen.getByText("chat.ts:42")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Open review" }))
    .toHaveAttribute("href", "/local/review-round-2");
});

it("suggests a fresh Deep Plan only for unfinished legacy runs that can start one", async () => {
  setup();
  const legacy: StoredDeepPlanRun = {
    schemaVersion: 1,
    kind: "legacy",
    id: DeepPlanRunId.make("old"),
    threadId,
    goal: "Earlier plan",
    finished: false,
    updatedAt: createdAt,
  };
  const notice = /started in an earlier version/;
  await using screen = await render(<ComposerDeepPlanContent run={legacy} />);
  await expect.element(screen.getByText(notice)).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Add chats" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Resume" }).query()).toBeNull();
  expect(screen.getByRole("button", { name: "Implementation actions" }).query()).toBeNull();
  await screen.rerender(<ComposerDeepPlanContent run={{ ...legacy, finished: true }} />);
  await expect.element(screen.getByText(notice)).not.toBeInTheDocument();
  await screen.rerender(<ComposerDeepPlanContent run={legacy} supported={false} />);
  await expect.element(screen.getByText(notice)).not.toBeInTheDocument();
});

it("shows only a read-only notice in reviewer chats", async () => {
  setup();
  await using screen = await render(<ComposerDeepPlanContent run={makeRun()} readOnlyReview />);
  await expect.element(screen.getByText("This review chat is read-only.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Implementation actions" }).query()).toBeNull();
  expect(screen.getByRole("button", { name: "Pause" }).query()).toBeNull();
});

it.each([
  ["completed", "Complete · 0/5 verified"],
  ["cancelled", "Cancelled"],
] as const)(
  "expires %s runs in the composer while keeping the plan checklist",
  async (phase, label) => {
    setup();
    await using screen = await render(null);
    using _timers = fakeTimers();
    vi.setSystemTime(createdAt);
    const run = makeRun({
      phase,
      approval: {
        planVersion: 1,
        approvalKey: "approval-key",
        approvedAt: createdAt,
        implementation: modelSelection,
        reviewer: modelSelection,
        parallelism: 1,
        lanes: [{ laneId: "lane-1", threadId }],
        baseTurnCount: 0,
      },
    });
    await screen.rerender(
      <DeepPlanRunControls
        run={run}
        threadRef={owner}
        threadShells={[]}
        disabled={false}
        supported
      />,
    );
    expect(screen.container.textContent).toContain(label);
    expect(screen.container.textContent).toContain("Deep checklist");
    await act(() => vi.advanceTimersByTime(60_000));
    expect(screen.container.textContent).not.toContain(label);
    expect(screen.container.textContent).not.toContain("Deep checklist");
    await screen.rerender(
      <DeepPlanChecklist run={run} environmentId={environmentId} placement="plan" />,
    );
    expect(screen.container.textContent).toContain("Deep checklist");
  },
);

it("selects Deep Plan from the compact menu and explains unsupported environments", async () => {
  setup();
  await using screen = await render(null);
  const container = screen.container;

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
          runtimeModeOptions={[{ mode: "full-access", ...runtimeModeConfig["full-access"] }]}
          showInteractionModeToggle
          onToggleInteractionMode={() => {}}
          onComposerModeChange={setMode}
          onRuntimeModeChange={() => {}}
        />
      </>
    );
  }
  await act(() => screen.rerender(<Modes reason="This server needs an update." />));
  await act(() => container.querySelector("button")!.click());
  const disabledDeepPlan = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
  ].find((entry) => entry.getAttribute("aria-label") === "Deep Plan")!;
  expect(disabledDeepPlan.getAttribute("aria-disabled")).toBe("true");
  expect(disabledDeepPlan.textContent).toContain("This server needs an update.");
  await act(() => screen.rerender(<Modes reason={null} />));
  const deepPlan = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
    (entry) => entry.getAttribute("aria-label") === "Deep Plan",
  )!;
  await act(() => deepPlan.click());
  expect(container.querySelector("output")?.textContent).toBe("deep-plan");
});

it("cycles Build, Plan, Deep Plan and Chat with click and Shift+Tab", async () => {
  setup();
  await using screen = await render(null);
  const container = screen.container;

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
  await act(() => screen.rerender(<ModeButton />));
  expect(button(container, "Build").getAttribute("aria-pressed")).toBe("false");
  await act(() => button(container, "Build").click());
  expect(button(container, "Plan").getAttribute("aria-pressed")).toBe("true");
  await act(() =>
    button(container, "Plan").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
    ),
  );
  expect(button(container, "Deep Plan").getAttribute("aria-pressed")).toBe("true");
  await act(() => button(container, "Deep Plan").click());
  expect(button(container, "Chat").getAttribute("aria-pressed")).toBe("true");
  await act(() => button(container, "Chat").click());
  expect(button(container, "Build").getAttribute("aria-pressed")).toBe("false");
});

function setup() {
  localStorage.clear();
  mocks.dispatch.mockReset().mockResolvedValue({ _tag: "Success", value: { sequence: 1 } });
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
}
