import { act, render as renderTest, type Screen } from "../../../test/render";
import {
  CHAT_VISUAL_MODES,
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLIENT_SETTINGS,
  type ChatVisualMode,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { BetterT3FeatureChoice } from "./BetterT3SettingsPreview";
import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";
import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";
it("switches all three modes in order and returns to Current without changing motion", async () => {
  await using fixture = await setupFixture();
  const { PresentationHarness } = fixture;
  await act(async () => {
    await fixture.screen.rerender(<PresentationHarness />);
  });
  const radios = Array.from(
    fixture.container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  );
  expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
    "Current",
    "Classic",
    "Better T3",
  ]);
  for (const index of [2, 1, 0]) {
    await act(async () => {
      await radios[index]!.click();
    });
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toEqual([
      radios[index],
    ]);
    expect(fixture.container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
  }
  await act(async () => {
    await fixture.container.querySelector<HTMLButtonElement>("button")!.click();
  });
  expect(fixture.container.querySelectorAll(".better-t3-preview-presentation-reveal")).toHaveLength(
    1,
  );
  expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
  await act(async () => {
    await fixture.container.querySelector<HTMLButtonElement>("button")!.click();
  });
  expect(fixture.container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
});
it("removes reasoning from every mode when off and moves it from inline to Working", async () => {
  await using fixture = await setupFixture();
  const { translate, PresentationHarness } = fixture;
  const thought = translate("settings.betterT3.preview.chat.thought");
  const workingTrace = translate("settings.betterT3.preview.reasoning.current");
  await act(async () => {
    await fixture.screen.rerender(<PresentationHarness />);
  });
  expect(fixture.container.textContent).not.toContain(thought);
  expect(fixture.container.textContent).not.toContain(workingTrace);
  await act(async () => {
    await fixture.screen.rerender(<PresentationHarness reasoning="inline" />);
  });
  expect(fixture.container.textContent).toContain(thought);
  expect(fixture.container.textContent).not.toContain(workingTrace);
  await act(async () => {
    await fixture.screen.rerender(<PresentationHarness reasoning="working" />);
  });
  expect(fixture.container.textContent).not.toContain(thought);
  expect(fixture.container.textContent).toContain(workingTrace);
  await act(async () => {
    await fixture.screen.rerender(<PresentationHarness />);
  });
  expect(fixture.container.textContent).not.toContain(thought);
  expect(fixture.container.textContent).not.toContain(workingTrace);
});
it.each([false, true])(
  "keeps presentation and text motion independent with character streaming set to %s",
  async (characterStreamingMotion) => {
    await using fixture = await setupFixture();
    const { PresentationHarness } = fixture;
    await act(async () => {
      await fixture.screen.rerender(
        <PresentationHarness characterStreamingMotion={characterStreamingMotion} />,
      );
    });
    const transitions = fixture.container.querySelector<HTMLButtonElement>("button")!;
    expect(fixture.container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
    await act(async () => {
      await transitions.click();
    });
    expect(
      fixture.container.querySelectorAll(".better-t3-preview-presentation-reveal"),
    ).toHaveLength(characterStreamingMotion ? 1 : 0);
    await act(async () => {
      await fixture.screen.rerender(
        <PresentationHarness characterStreamingMotion={!characterStreamingMotion} />,
      );
    });
    expect(
      fixture.container.querySelectorAll(".better-t3-preview-presentation-reveal"),
    ).toHaveLength(characterStreamingMotion ? 0 : 1);
    await act(async () => {
      await transitions.click();
    });
    expect(fixture.container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
  },
);
async function setupFixture() {
  const fixtureResources = new AsyncDisposableStack();
  const translate = createInterfaceTranslator({
    language: "en",
    locale: "en-US",
  }).message;
  let screen: Screen;
  let container: HTMLDivElement;
  function PresentationHarness({
    reasoning = "off",
    characterStreamingMotion = true,
  }: {
    reasoning?: "off" | "inline" | "working";
    characterStreamingMotion?: boolean;
  }) {
    const [mode, setMode] = useState<ChatVisualMode>("current");
    const [motion, setMotion] = useState(false);
    const features = buildBetterT3ControlStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: {
        ...DEFAULT_CLIENT_SETTINGS.betterT3Device,
        flags: {
          "agent.reasoningVisibility": true,
          "agent.reasoningWorkingOverlay": reasoning === "working",
          "chat.presentationMotion": motion,
          "chat.characterStreamingMotion": characterStreamingMotion,
        },
      },
      environment: DEFAULT_CLIENT_SETTINGS.betterT3Device,
      surface: "web",
      capabilities: {},
    });
    return (
      <>
        <button onClick={() => setMotion((current) => !current)}>Toggle transitions</button>
        <BetterT3FeatureChoice
          disabled={false}
          featureId="chat.presentation"
          model={buildBetterT3SettingsPreviewModel({
            features,
            chatVisualMode: mode,
            showReasoning: reasoning !== "off",
            sidebarPosition: "left",
            contextWindowSelector: "native",
          })}
          onChange={(value) => {
            const selected = CHAT_VISUAL_MODES.find((mode) => mode === value);
            if (selected) setMode(selected);
          }}
          translate={translate}
          value={mode}
        />
      </>
    );
  }
  fixtureResources.defer(async () => {
    await act(async () => {
      await screen.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });
  try {
    container = document.createElement("div");
    document.body.append(container);
    screen = fixtureResources.use(
      await renderTest(null, {
        container: container,
        /* The fixture exercises local state without router navigation.*/ router: false,
      }),
    );
    return {
      translate,
      get screen() {
        return screen;
      },
      set screen(value: Screen) {
        screen = value;
      },
      get container() {
        return container;
      },
      set container(value: HTMLDivElement) {
        container = value;
      },
      PresentationHarness,
      async [Symbol.asyncDispose]() {
        await fixtureResources.disposeAsync();
      },
    };
  } catch (error) {
    await fixtureResources.disposeAsync();
    throw error;
  }
}
