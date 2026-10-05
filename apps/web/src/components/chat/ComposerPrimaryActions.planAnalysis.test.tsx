// @vitest-environment jsdom

import { act, type ComponentProps, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { shouldShowPlanAnalysis, shouldShowPlanFollowUpPrompt } from "../ChatView.logic";
import { TooltipProvider } from "../ui/tooltip";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

let container: HTMLDivElement;
let root: Root;
const implement = vi.fn();
const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

beforeEach(() => {
  vi.clearAllMocks();
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

async function renderActions(
  overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {},
) {
  await act(() => {
    root.render(
      <TooltipProvider>
        <form id="plan-analysis-composer" onSubmit={submit}>
          <ComposerPrimaryActions
            formId="plan-analysis-composer"
            compact={false}
            pendingAction={null}
            isRunning={false}
            showPlanFollowUpPrompt={false}
            showPlanImplementationActions
            promptHasText={false}
            isSendBusy={false}
            sendDisabledReason={null}
            isConnecting={false}
            isEnvironmentUnavailable={false}
            isPreparingWorktree={false}
            hasSendableContent={false}
            onPreviousPendingQuestion={() => {}}
            onInterrupt={() => {}}
            onImplementPlan={implement}
            onImplementPlanInNewThread={() => {}}
            planImplementationSuggestion={{
              strategy: { kind: "subagents", count: 4 },
              supportedCounts: [2, 4, 8],
            }}
            {...overrides}
          />
        </form>
      </TooltipProvider>,
    );
  });
}

function labeledButton(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

it("restores reviewed implementation in Build while keeping typed messages as normal sends", async () => {
  const availability = {
    pendingUserInputCount: 0,
    latestTurnSettled: true,
    hasActionableProposedPlan: true,
    hasComposerAttachments: false,
    interactionMode: "default" as const,
  };
  const planActions = {
    showPlanImplementationActions: shouldShowPlanAnalysis(availability),
    showPlanFollowUpPrompt: shouldShowPlanFollowUpPrompt(availability),
  };
  await renderActions({ ...planActions, planParallelismReviewStatus: "reviewing" });
  const reviewing = labeledButton("Analyzing plan");
  expect(reviewing.disabled).toBe(true);
  await act(() => reviewing.click());
  expect(implement).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();

  await renderActions({ ...planActions, planParallelismReviewStatus: "ready" });
  const ready = labeledButton("Implement with 4 subagents");
  expect(ready.disabled).toBe(false);
  await act(() => ready.click());
  expect(implement).toHaveBeenCalledExactlyOnceWith({ kind: "subagents", count: 4 });
  expect(submit).not.toHaveBeenCalled();

  await renderActions({
    ...planActions,
    planParallelismReviewStatus: "reviewing",
    promptHasText: true,
    hasSendableContent: true,
  });
  expect(container.textContent).not.toContain("Refine");
  expect(container.textContent).not.toContain("Analyzing plan");
  const send = container.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect(send).not.toBeNull();
  expect(send!.disabled).toBe(false);
  await act(() => send!.click());
  expect(submit).toHaveBeenCalledOnce();
  expect(implement).toHaveBeenCalledOnce();
});

it("keeps Plan-mode text refinement and hides actions when analysis is unavailable", async () => {
  await renderActions({
    showPlanFollowUpPrompt: true,
    promptHasText: true,
    hasSendableContent: true,
  });
  await act(() => labeledButton("Refine").click());
  expect(submit).toHaveBeenCalledOnce();
  expect(implement).not.toHaveBeenCalled();

  await renderActions({ showPlanImplementationActions: false });
  expect(container.textContent).not.toContain("Implement");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});

it("keeps the stop action while a turn is running", async () => {
  await renderActions({ isRunning: true });
  expect(container.textContent).not.toContain("Implement");
  expect(container.querySelector('button[aria-label="Stop generation"]')).not.toBeNull();
});
