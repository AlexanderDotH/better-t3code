import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

function renderStopAction(abortPhase: "interrupting" | "force-stopping" | null) {
  return renderToStaticMarkup(
    <ComposerPrimaryActions
      compact={false}
      pendingAction={null}
      isRunning
      abortPhase={abortPhase}
      showPlanFollowUpPrompt={false}
      promptHasText={false}
      isSendBusy={false}
      sendDisabledReason={null}
      isConnecting={false}
      isEnvironmentUnavailable={false}
      isPreparingWorktree={false}
      hasSendableContent={false}
      onPreviousPendingQuestion={vi.fn()}
      onInterrupt={vi.fn()}
      onImplementPlan={vi.fn()}
      onImplementPlanInNewThread={vi.fn()}
    />,
  );
}

describe("ComposerPrimaryActions stop action", () => {
  it("offers an enabled stop action before cancellation starts", () => {
    const markup = renderStopAction(null);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain(" disabled=");
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup).toContain("<rect");
  });

  it("offers an enabled force-stop action during cooperative cancellation", () => {
    const markup = renderStopAction("interrupting");

    expect(markup).toContain('aria-label="Force stop generation"');
    expect(markup).not.toContain(" disabled=");
    expect(markup).not.toContain('aria-busy="true"');
    expect(markup).not.toContain("animate-spin");
    expect(markup).toContain("<rect");
  });

  it("shows a disabled force-stopping indicator during forced termination", () => {
    const markup = renderStopAction("force-stopping");

    expect(markup).toContain('aria-label="Force stopping generation"');
    expect(markup).toContain(" disabled=");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("animate-spin");
    expect(markup).not.toContain("<rect");
  });
});
