// @vitest-environment jsdom
import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { mergeClientSettingsPatch } from "@t3tools/client-runtime/client-settings";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { BetterT3SettingsContent } from "./BetterT3SettingsPanel";
import { BetterT3FeatureChoice } from "./BetterT3SettingsPreview";
import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";
import {
  buildBetterT3ControlStates,
  buildReasoningDisplaySettingsPatch,
} from "./BetterT3SettingsPanel.logic";
import { SettingsSearchTargetProvider, SettingsSearchTarget } from "./settingsLayout";
import { BetterT3SettingsSubgroup } from "./BetterT3SettingsSubgroup";

vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  usePrimarySettingsAvailable: () => true,
}));

const translate = createInterfaceTranslator({ language: "de", locale: "de-DE" }).message;
const features = buildBetterT3ControlStates({
  registry: BETTER_T3_FEATURE_REGISTRY,
  device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  surface: "web",
  capabilities: {},
});
let host: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  scrollIntoView.mockClear();
  vi.unstubAllGlobals();
});
const render = async (content: ReactNode) => act(() => root.render(content));
const click = async (element: Element | null) => {
  expect(element).not.toBeNull();
  await act(() => (element as HTMLElement).click());
};

function DraftControl() {
  const [draft, setDraft] = useState("");
  return (
    <input
      aria-label="Draft setting"
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
    />
  );
}
function ReasoningSettingsHarness(props: { onChange: (settings: ClientSettings) => void }) {
  const [settings, setSettings] = useState(DEFAULT_CLIENT_SETTINGS);
  const controls = buildBetterT3ControlStates({
    registry: BETTER_T3_FEATURE_REGISTRY,
    device: settings.betterT3Device,
    environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    surface: "web",
    capabilities: {},
  });
  return (
    <BetterT3SettingsContent
      features={controls}
      translate={translate}
      controls={{}}
      onSwitchChange={vi.fn()}
      featureChoices={{
        "agent.reasoningVisibility": (
          <BetterT3FeatureChoice
            featureId="agent.reasoningVisibility"
            disabled={false}
            model={buildBetterT3SettingsPreviewModel({
              features: controls,
              chatVisualMode: "current",
              contextWindowSelector: "native",
              sidebarPosition: "left",
            })}
            translate={translate}
            value={
              !settings.showReasoning
                ? "none"
                : settings.betterT3Device.flags["agent.reasoningWorkingOverlay"]
                  ? "working"
                  : settings.betterT3Device.flags["agent.reasoningInMessage"]
                    ? "message"
                    : "chat"
            }
            onChange={(value) => {
              if (
                value !== "none" &&
                value !== "chat" &&
                value !== "working" &&
                value !== "message"
              )
                return;
              const next = mergeClientSettingsPatch(
                settings,
                buildReasoningDisplaySettingsPatch(value),
              );
              setSettings(next);
              props.onChange(next);
            }}
          />
        ),
      }}
    />
  );
}

it("keeps all reasoning choices directly visible and updates their existing settings together", async () => {
  const onChange = vi.fn();
  await render(<ReasoningSettingsHarness onChange={onChange} />);
  expect(host.querySelector('[data-better-t3-feature="agent.reasoningWorkingOverlay"]')).toBeNull();
  const row = host.querySelector('[data-better-t3-feature="agent.reasoningVisibility"]')!;
  expect(row.querySelector('[role="switch"]')).toBeNull();
  const radios = () => Array.from(row.querySelectorAll<HTMLElement>('[role="radio"]'));
  expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
    "false",
    "false",
  ]);
  expect(radios().map((radio) => radio.getAttribute("aria-label"))).toEqual([
    translate("settings.betterT3.reasoning.none"),
    translate("settings.betterT3.reasoning.chat"),
    translate("settings.betterT3.reasoning.working"),
    translate("settings.betterT3.reasoning.message"),
  ]);
  for (const index of [1, 2, 3, 0, 3, 2, 1, 0]) {
    await click(radios()[index]!);
    expect(radios().map((radio) => radio.getAttribute("aria-checked"))).toEqual(
      [0, 1, 2, 3].map((value) => String(value === index)),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_CLIENT_SETTINGS,
      showReasoning: index !== 0,
      betterT3Device: {
        ...DEFAULT_CLIENT_SETTINGS.betterT3Device,
        flags: {
          ...DEFAULT_CLIENT_SETTINGS.betterT3Device.flags,
          "agent.reasoningVisibility": index !== 0,
          "agent.reasoningWorkingOverlay": index === 2,
          "agent.reasoningInMessage": index === 3,
        },
      },
    });
  }
});

it("keeps the Project Index decision selector in its collapsed model group exactly once", async () => {
  await render(
    <BetterT3SettingsContent
      features={features}
      translate={translate}
      controls={{ "knowledge.projectIndexingDecisionModel": <button>Decision model</button> }}
      projectIndexingSettings={<span>Project Index settings</span>}
      onSwitchChange={vi.fn()}
    />,
  );
  expect(host.textContent).toContain("Project Index settings");
  expect(
    host.querySelector('[data-better-t3-feature="knowledge.projectIndexingDecisionModel"]'),
  ).toBeNull();
  await click(host.querySelector('[data-better-t3-subgroup="indexing-models"] button'));
  expect(
    host.querySelectorAll('[data-better-t3-feature="knowledge.projectIndexingDecisionModel"]'),
  ).toHaveLength(1);
  expect(host.textContent).toContain("Decision model");
});

it("keeps every row available and preserves drafts through category navigation and collapsing", async () => {
  const onSwitchChange = vi.fn();
  await render(
    <BetterT3SettingsContent
      features={features}
      translate={translate}
      controls={{}}
      languageControl={<span>Interface language</span>}
      usagePacingControl={<span>Usage pacing</span>}
      chatWidthSettings={<span>Adjust chat width</span>}
      visualSettings={<span>Glass opacity</span>}
      featureChoices={{ "agent.fetchModel": <DraftControl /> }}
      onSwitchChange={onSwitchChange}
    />,
  );
  for (const trigger of Array.from(
    host.querySelectorAll<HTMLElement>('[data-slot="collapsible-trigger"]'),
  ))
    await click(trigger);
  const actualIds = Array.from(host.querySelectorAll<HTMLElement>("[data-better-t3-feature]"))
    .map((row) => row.dataset.betterT3Feature)
    .sort();
  expect(actualIds).toEqual(
    features
      .map(({ descriptor }) => descriptor.id)
      .filter((id) => id !== "agent.reasoningWorkingOverlay" && id !== "agent.reasoningInMessage")
      .sort(),
  );
  const draft = host.querySelector<HTMLInputElement>('[aria-label="Draft setting"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      draft,
      "Unsaved draft",
    );
    draft.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const link of Array.from(host.querySelectorAll<HTMLAnchorElement>("nav a"))) {
    await click(link);
    expect(document.activeElement?.id).toBe(link.hash.slice(1));
    expect(host.querySelector<HTMLInputElement>('[aria-label="Draft setting"]')!.value).toBe(
      "Unsaved draft",
    );
  }
  const fetchTrigger = host.querySelector<HTMLElement>(
    '[data-better-t3-subgroup="fetch"] [data-slot="collapsible-trigger"]',
  )!;
  await click(fetchTrigger);
  expect(draft.closest("[inert]")).not.toBeNull();
  await click(fetchTrigger);
  expect(draft.closest("[inert]")).toBeNull();
  expect(host.querySelector('[aria-label="Draft setting"]')).toBe(draft);
  expect(draft.value).toBe("Unsaved draft");
  expect(onSwitchChange).not.toHaveBeenCalled();
});

it("opens a lazy model group before focusing its search destination", async () => {
  const handled = vi.fn();
  await render(
    <SettingsSearchTargetProvider targetId="agent.fetchModel" onTargetHandled={handled}>
      <BetterT3SettingsContent
        features={features}
        translate={translate}
        controls={{ "agent.fetchModel": <input aria-label="Fetch model" /> }}
        onSwitchChange={vi.fn()}
      />
    </SettingsSearchTargetProvider>,
  );
  const target = host.querySelector('[id="agent.fetchModel"]');
  expect(target).not.toBeNull();
  expect(target?.closest('[inert], [aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(target);
  expect(handled).toHaveBeenCalledOnce();
});

it("finds character streaming motion in inline search and focuses it on repeated selections", async () => {
  const motionTargetId = "chat.characterStreamingMotion";
  const motionLabel = "Character streaming motion";
  const englishTranslate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;
  await render(
    <SettingsSearchTargetProvider targetId={null}>
      <BetterT3SettingsContent
        features={features}
        translate={englishTranslate}
        controls={{}}
        onSwitchChange={vi.fn()}
      />
    </SettingsSearchTargetProvider>,
  );
  const target = document.getElementById(motionTargetId)!;
  expect(target).not.toBeNull();
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;

  for (let selection = 0; selection < 2; selection++) {
    await act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        motionLabel,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const result = Array.from(document.querySelectorAll('[role="option"]')).find((option) =>
      option.textContent?.includes(motionLabel),
    );
    await click(result ?? null);
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(target);
    expect(document.activeElement).toBe(target);
    expect(input.value).toBe("");
    expect(target.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
  }
});

it("indexes moved language and decision controls before their specialized groups ever open", async () => {
  const movedIds = ["voice.outputLanguage", "knowledge.projectIndexingDecisionModel"] as const;
  await render(
    <SettingsSearchTargetProvider targetId={null}>
      <BetterT3SettingsContent
        features={features.filter((feature) => movedIds.some((id) => id === feature.descriptor.id))}
        consumedFeatureIds={movedIds}
        controls={{}}
        translate={translate}
        onSwitchChange={vi.fn()}
        voiceSettings={
          <BetterT3SettingsSubgroup groupId="voice-translation">
            <SettingsSearchTarget id="voice.outputLanguage">Language control</SettingsSearchTarget>
          </BetterT3SettingsSubgroup>
        }
        projectIndexingSettings={
          <BetterT3SettingsSubgroup groupId="indexing-models">
            <SettingsSearchTarget id="knowledge.projectIndexingDecisionModel">
              Decision control
            </SettingsSearchTarget>
          </BetterT3SettingsSubgroup>
        }
      />
    </SettingsSearchTargetProvider>,
  );
  const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  for (const id of movedIds) {
    expect(document.getElementById(id)).toBeNull();
    const label = translate(`betterT3.${id}.label`);
    await act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, label);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).some((option) =>
        option.textContent?.includes(label),
      ),
    ).toBe(true);
  }
});

it("shows only available device categories when there is no environment", async () => {
  await render(
    <BetterT3SettingsContent
      features={[]}
      controls={{}}
      translate={translate}
      onSwitchChange={vi.fn()}
      languageControl={<span>Interface language</span>}
      chatSettings={<span>Response metrics</span>}
      composerSettings={<span>Context meter</span>}
    />,
  );
  expect(Array.from(host.querySelectorAll("nav a")).map((link) => link.textContent)).toEqual([
    "Allgemein",
    "Chat",
    "Eingabe",
  ]);
  expect(host.querySelectorAll('[data-slot="settings-section-body"]')).toHaveLength(3);
});
