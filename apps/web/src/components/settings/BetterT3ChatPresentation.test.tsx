// @vitest-environment jsdom
import {
  CHAT_VISUAL_MODES,
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLIENT_SETTINGS,
  type ChatVisualMode,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { BetterT3FeatureChoice } from "./BetterT3SettingsPreview";
import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";
import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";

const translate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;
let root: Root;
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("switches all three modes in order and returns to Current without changing motion", async () => {
  await act(() => root.render(<PresentationHarness />));
  const radios = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
    "Current",
    "Classic",
    "Better T3",
  ]);
  for (const index of [2, 1, 0]) {
    await act(() => radios[index]!.click());
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toEqual([
      radios[index],
    ]);
    expect(container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
  }
  await act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelectorAll(".better-t3-preview-presentation-reveal")).toHaveLength(1);
  expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
  await act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
});

it("removes reasoning from every mode when off and moves it from inline to Working", async () => {
  const thought = translate("settings.betterT3.preview.chat.thought");
  const workingTrace = translate("settings.betterT3.preview.reasoning.current");
  await act(() => root.render(<PresentationHarness />));
  expect(container.textContent).not.toContain(thought);
  expect(container.textContent).not.toContain(workingTrace);
  await act(() => root.render(<PresentationHarness reasoning="inline" />));
  expect(container.textContent).toContain(thought);
  expect(container.textContent).not.toContain(workingTrace);
  await act(() => root.render(<PresentationHarness reasoning="working" />));
  expect(container.textContent).not.toContain(thought);
  expect(container.textContent).toContain(workingTrace);
  await act(() => root.render(<PresentationHarness />));
  expect(container.textContent).not.toContain(thought);
  expect(container.textContent).not.toContain(workingTrace);
});

it.each([false, true])(
  "keeps presentation and text motion independent with character streaming set to %s",
  async (characterStreamingMotion) => {
    await act(() =>
      root.render(<PresentationHarness characterStreamingMotion={characterStreamingMotion} />),
    );
    const transitions = container.querySelector<HTMLButtonElement>("button")!;
    expect(container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
    await act(() => transitions.click());
    expect(container.querySelectorAll(".better-t3-preview-presentation-reveal")).toHaveLength(
      characterStreamingMotion ? 1 : 0,
    );
    await act(() =>
      root.render(<PresentationHarness characterStreamingMotion={!characterStreamingMotion} />),
    );
    expect(container.querySelectorAll(".better-t3-preview-presentation-reveal")).toHaveLength(
      characterStreamingMotion ? 0 : 1,
    );
    await act(() => transitions.click());
    expect(container.querySelector(".better-t3-preview-presentation-reveal")).toBeNull();
  },
);
