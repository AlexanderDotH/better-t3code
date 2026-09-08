import { act, createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";

const stageArtworkState = vi.hoisted(() => ({
  mode: "none" as "artwork" | "none",
  variant: null as "nightly" | "dev" | null,
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => stageArtworkState.mode,
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: ({ variant }: { variant: string }) => `stage-${variant}`,
  useSidebarStageBackdropVariant: (enabled = true) => (enabled ? stageArtworkState.variant : null),
}));

import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";

function renderPendingActions(isRunning: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      pendingAction: {
        questionIndex: 0,
        isLastQuestion: true,
        canAdvance: true,
        isResponding: false,
        isComplete: true,
      },
      isRunning,
      showPlanFollowUpPrompt: false,
      promptHasText: false,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: false,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

function renderRunningActions(showSendWhileRunning: boolean, hasSendableContent: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      pendingAction: null,
      isRunning: true,
      showPlanFollowUpPrompt: false,
      promptHasText: hasSendableContent,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent,
      showSendWhileRunning,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

function renderSendButton(sendDisabledReason: string | null = null) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      pendingAction: null,
      isRunning: false,
      showPlanFollowUpPrompt: false,
      promptHasText: true,
      isSendBusy: false,
      sendDisabledReason,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: true,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

afterEach(() => {
  stageArtworkState.mode = "none";
  stageArtworkState.variant = null;
  setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
});

describe("ComposerPrimaryActions", () => {
  it("updates pending actions and the plan banner when the interface language changes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(
          createElement(
            Fragment,
            null,
            createElement(ComposerPlanFollowUpBanner, { planTitle: "Keep this title" }),
            createElement(ComposerPrimaryActions, {
              compact: false,
              pendingAction: {
                questionIndex: 1,
                isLastQuestion: true,
                canAdvance: true,
                isResponding: false,
                isComplete: true,
              },
              isRunning: true,
              showPlanFollowUpPrompt: false,
              promptHasText: false,
              isSendBusy: false,
              sendDisabledReason: null,
              isConnecting: false,
              isEnvironmentUnavailable: false,
              isPreparingWorktree: false,
              hasSendableContent: false,
              onPreviousPendingQuestion: () => {},
              onInterrupt: () => {},
              onImplementPlanInNewThread: () => {},
            }),
          ),
        );
      });

      const submitButton = renderer!.root.find(
        (node) => node.type === "button" && node.props.type === "submit",
      );
      expect(submitButton.children).toEqual(["Submit answers"]);
      expect(JSON.stringify(renderer!.toJSON())).toContain("Plan ready");

      await act(async () => {
        setInterfaceLocaleRuntime({ language: "de", locale: "de-DE" });
      });
      expect(
        renderer!.root.find((node) => node.type === "button" && node.props.type === "submit"),
      ).toBe(submitButton);
      expect(submitButton.children).toEqual(["Antworten senden"]);
      expect(JSON.stringify(renderer!.toJSON())).toContain("Plan bereit");
      expect(renderer!.root.findAllByProps({ "aria-label": "Generierung stoppen" })).toHaveLength(
        1,
      );

      await act(async () => {
        setInterfaceLocaleRuntime({ language: "fr", locale: "fr-FR" });
      });
      expect(submitButton.children).toEqual(["Envoyer les réponses"]);
      expect(JSON.stringify(renderer!.toJSON())).toContain("Plan prêt");
      expect(JSON.stringify(renderer!.toJSON())).toContain("Keep this title");
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("disables and labels the send button while feedback is uploading", () => {
    const markup = renderSendButton("Sending feedback");

    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-label="Sending feedback"');
  });

  it("offers Stop generation while a running turn is waiting for user input", () => {
    expect(renderPendingActions(true)).toContain('aria-label="Stop generation"');
  });

  it("does not offer Stop generation for a pending request without a running turn", () => {
    expect(renderPendingActions(false)).not.toContain('aria-label="Stop generation"');
  });

  it("renders stage artwork inside the send button when artwork identification is active", () => {
    stageArtworkState.mode = "artwork";
    stageArtworkState.variant = "nightly";

    const markup = renderSendButton();

    expect(markup).toContain("stage-nightly");
  });

  it("hides stage artwork when artwork identification is inactive", () => {
    stageArtworkState.variant = "nightly";

    const markup = renderSendButton();

    expect(markup).not.toContain("stage-nightly");
  });

  it("only renders stop while running when Enter-to-send is available", () => {
    const markup = renderRunningActions(false, true);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Send message"');
  });

  it("renders send alongside stop while running when Enter-to-send is unavailable", () => {
    const markup = renderRunningActions(true, true);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).toContain('aria-label="Send message"');
    expect(markup).toContain('type="submit"');
  });

  it("keeps stop as the only action while running with an empty composer", () => {
    const markup = renderRunningActions(true, false);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Send message"');
  });
});
