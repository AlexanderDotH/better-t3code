import type { ComponentProps, FormEvent } from "react";
import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { shouldShowPlanAnalysis, shouldShowPlanFollowUpPrompt } from "../ChatView.logic";
import { TooltipProvider } from "../ui/tooltip";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";

vi.mock("~/hooks/useSettings", () => ({ useEnvironmentIdentificationMode: () => "none" }));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

function setup() {
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  const implement = vi.fn();
  const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
  const element = (overrides: Partial<ComponentProps<typeof ComposerPrimaryActions>> = {}) => (
    <TooltipProvider>
      <form id="plan-analysis-composer" onSubmit={submit}>
        <ComposerPrimaryActions
          formId="plan-analysis-composer"
          compact={false}
          canOperateThread
          canInterrupt={false}
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
    </TooltipProvider>
  );
  return { implement, submit, element };
}

it("waits for reviewed implementation in Build while keeping typed messages as normal sends", async () => {
  const { element, implement, submit } = setup();
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
  await using screen = await render(
    element({ ...planActions, planParallelismReviewStatus: "reviewing" }),
  );
  await expect
    .element(screen.getByRole("button", { name: "Implement with 4 subagents" }))
    .toBeDisabled();
  await expect.element(screen.getByText("Analyzing plan…", { exact: true })).toBeVisible();
  await screen.rerender(element({ ...planActions, planParallelismReviewStatus: "ready" }));
  await screen.getByRole("button", { name: "Implement with 4 subagents" }).click();
  expect(implement).toHaveBeenCalledExactlyOnceWith({ kind: "subagents", count: 4 });
  expect(submit).not.toHaveBeenCalled();
  await screen.rerender(
    element({
      ...planActions,
      planParallelismReviewStatus: "reviewing",
      promptHasText: true,
      hasSendableContent: true,
    }),
  );
  await expect.element(screen.getByText("Refine", { exact: true })).not.toBeInTheDocument();
  await expect
    .element(screen.getByText("Analyzing plan…", { exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Submit message" }).click();
  expect(submit).toHaveBeenCalledOnce();
  expect(implement).toHaveBeenCalledOnce();
});

it("keeps Plan-mode text refinement and hides actions when analysis is unavailable", async () => {
  const { element, implement, submit } = setup();
  await using screen = await render(
    element({ showPlanFollowUpPrompt: true, promptHasText: true, hasSendableContent: true }),
  );
  await screen.getByRole("button", { name: "Refine", exact: true }).click();
  expect(submit).toHaveBeenCalledOnce();
  expect(implement).not.toHaveBeenCalled();
  await screen.rerender(element({ showPlanImplementationActions: false }));
  await expect.element(screen.getByRole("button", { name: "Submit message" })).toBeDisabled();
});

it("keeps the stop action while a turn is running", async () => {
  const { element } = setup();
  await using screen = await render(element({ isRunning: true, canInterrupt: true }));
  await expect.element(screen.getByRole("button", { name: "Stop generation" })).toBeVisible();
  await expect.element(screen.getByText("Implement", { exact: true })).not.toBeInTheDocument();
});

it.each([false, true])(
  "updates pending actions and plan estimates without remounting for locale changes (Deep Plan: %s)",
  async (deepPlan) => {
    const { element } = setup();
    onTestFinished(() => {
      setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
    });
    await using screen = await render(
      <TooltipProvider>
        <ComposerPlanFollowUpBanner
          planTitle="Keep this title"
          deepPlan={deepPlan}
          estimate={{
            model: "Test model",
            reasoning: "High",
            speed: null,
            fast: false,
            hasSpeedOption: false,
            workUnits: 1,
            minMinutes: deepPlan ? 94 : 2,
            maxMinutes: deepPlan ? 282 : 5,
          }}
        />
        {element({
          compact: false,
          pendingAction: {
            questionIndex: 1,
            isLastQuestion: true,
            canAdvance: true,
            isResponding: false,
            isComplete: true,
          },
          isRunning: true,
          canInterrupt: true,
          showPlanFollowUpPrompt: false,
          showPlanImplementationActions: false,
        })}
      </TooltipProvider>,
    );
    await expect
      .element(screen.getByRole("button", { name: "Submit answers", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText(deepPlan ? "Deep Plan ready" : "Plan ready", { exact: true }))
      .toBeVisible();
    const submitButton = screen.container.querySelector('button[type="submit"]');
    await act(() => {
      setInterfaceLocaleRuntime({ language: "de", locale: "de-DE" });
    });
    await expect
      .element(screen.getByRole("button", { name: "Antworten senden", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText(deepPlan ? "Deep Plan bereit" : "Plan bereit", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(deepPlan ? "Ca. 1,6–4,7 Std. ab Start" : "Ca. 2–5 Min. ab Start", {
          exact: true,
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Generierung stoppen", exact: true }))
      .toBeVisible();
    expect(screen.container.querySelector('button[type="submit"]')).toBe(submitButton);
    await act(() => {
      setInterfaceLocaleRuntime({ language: "fr", locale: "fr-FR" });
    });
    await expect
      .element(screen.getByRole("button", { name: "Envoyer les réponses", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText(deepPlan ? "Deep Plan prêt" : "Plan prêt", { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("Keep this title", { exact: true })).toBeVisible();
  },
);
