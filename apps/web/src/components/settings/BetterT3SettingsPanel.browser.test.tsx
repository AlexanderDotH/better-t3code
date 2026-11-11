import { act, render as renderTest, type Screen } from "../../../test/render";
import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { mergeClientSettingsPatch } from "@t3tools/client-runtime/client-settings";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { BetterT3SettingsContent } from "./BetterT3SettingsPanel";
import { BetterT3FeatureChoice } from "./BetterT3SettingsPreview";
import { buildBetterT3SettingsPreviewModel } from "./BetterT3SettingsPreview.logic";
import {
  buildBetterT3ControlStates,
  buildReasoningDisplaySettingsPatch,
} from "./BetterT3SettingsPanel.logic";
import { SettingsSearchTargetProvider } from "./settingsLayout";
vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  usePrimarySettingsAvailable: () => true,
}));
it("keeps all reasoning choices directly visible and updates their existing settings together", async () => {
  await using fixture = await setupFixture();
  const { render, ReasoningSettingsHarness, translate, click } = fixture;
  const onChange = vi.fn();
  await render(<ReasoningSettingsHarness onChange={onChange} />);
  expect(
    fixture.host.querySelector('[data-better-t3-feature="agent.reasoningWorkingOverlay"]'),
  ).toBeNull();
  const row = fixture.host.querySelector('[data-better-t3-feature="agent.reasoningVisibility"]')!;
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
it("keeps the Project Index decision selector in its model group exactly once", async () => {
  await using fixture = await setupFixture();
  const { render, features, translate } = fixture;
  await render(
    <BetterT3SettingsContent
      features={features}
      translate={translate}
      controls={{
        "knowledge.projectIndexingDecisionModel": <button>Decision model</button>,
      }}
      projectIndexingSettings={<span>Project Index settings</span>}
      onSwitchChange={vi.fn()}
    />,
  );
  expect(fixture.host.textContent).toContain("Project Index settings");
  expect(
    fixture.host.querySelectorAll(
      '[data-better-t3-feature="knowledge.projectIndexingDecisionModel"]',
    ),
  ).toHaveLength(1);
  expect(fixture.host.textContent).toContain("Decision model");
});
it("shows every feature row without any folded group", async () => {
  await using fixture = await setupFixture();
  const { render, features, translate } = fixture;
  await render(
    <BetterT3SettingsContent
      features={features}
      translate={translate}
      controls={{}}
      languageControl={<span>Interface language</span>}
      usagePacingControl={<span>Usage pacing</span>}
      chatWidthSettings={<span>Adjust chat width</span>}
      visualSettings={<span>Glass opacity</span>}
      onSwitchChange={vi.fn()}
    />,
  );
  expect(fixture.host.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();
  expect(
    Array.from(fixture.host.querySelectorAll<HTMLElement>("[data-better-t3-feature]"))
      .map((row) => row.dataset.betterT3Feature)
      .sort(),
  ).toEqual(
    features
      .map(({ descriptor }) => descriptor.id)
      .filter((id) => id !== "agent.reasoningWorkingOverlay" && id !== "agent.reasoningInMessage")
      .sort(),
  );
});
it("focuses a model row from its search destination", async () => {
  await using fixture = await setupFixture();
  const { render, features, translate } = fixture;
  const handled = vi.fn();
  await render(
    <SettingsSearchTargetProvider targetId="agent.fetchModel" onTargetHandled={handled}>
      <BetterT3SettingsContent
        features={features}
        translate={translate}
        controls={{
          "agent.fetchModel": <input aria-label="Fetch model" />,
        }}
        onSwitchChange={vi.fn()}
      />
    </SettingsSearchTargetProvider>,
  );
  const target = fixture.host.querySelector('[id="agent.fetchModel"]');
  expect(target).not.toBeNull();
  expect(target?.closest('[inert], [aria-hidden="true"]')).toBeNull();
  expect(document.activeElement).toBe(target);
  expect(handled).toHaveBeenCalledOnce();
});
it("shows one category as a page and leaves the others out", async () => {
  await using fixture = await setupFixture();
  const { render, features, translate } = fixture;
  await render(
    <BetterT3SettingsContent
      activeCategory="agents"
      features={features}
      controls={{}}
      translate={translate}
      onSwitchChange={vi.fn()}
    />,
  );
  expect(
    Array.from(fixture.host.querySelectorAll("[data-better-t3-group]")).map(
      (group) => (group as HTMLElement).dataset.betterT3Group,
    ),
  ).toEqual(["agents"]);
});
it("shows only available device categories when there is no environment", async () => {
  await using fixture = await setupFixture();
  const { render, translate } = fixture;
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
  expect(Array.from(fixture.host.querySelectorAll("h2")).map((title) => title.textContent)).toEqual(
    ["Allgemein", "Chat", "Eingabe"],
  );
  expect(fixture.host.querySelectorAll("[data-better-t3-subgroup]")).toHaveLength(3);
});
async function setupFixture() {
  const fixtureResources = new AsyncDisposableStack();
  const translate = createInterfaceTranslator({
    language: "de",
    locale: "de-DE",
  }).message;
  const features = buildBetterT3ControlStates({
    registry: BETTER_T3_FEATURE_REGISTRY,
    device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
    surface: "web",
    capabilities: {},
  });
  let host: HTMLDivElement;
  let screen: Screen;
  const scrollIntoView = vi.fn();
  const render = async (content: ReactNode) =>
    await act(async () => {
      await screen.rerender(content);
    });
  const click = async (element: Element | null) => {
    expect(element).not.toBeNull();
    await act(async () => {
      await (element as HTMLElement).click();
    });
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
  fixtureResources.defer(async () => {
    await act(async () => {
      await screen.unmount();
    });
    host.remove();
    scrollIntoView.mockClear();
    vi.unstubAllGlobals();
  });
  try {
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
      value: () => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    screen = fixtureResources.use(
      await renderTest(null, {
        container: host,
        /* The fixture exercises local state without router navigation.*/ router: false,
      }),
    );
    return {
      translate,
      features,
      get host() {
        return host;
      },
      set host(value: HTMLDivElement) {
        host = value;
      },
      get screen() {
        return screen;
      },
      set screen(value: Screen) {
        screen = value;
      },
      scrollIntoView,
      render,
      click,
      DraftControl,
      ReasoningSettingsHarness,
      async [Symbol.asyncDispose]() {
        await fixtureResources.disposeAsync();
      },
    };
  } catch (error) {
    await fixtureResources.disposeAsync();
    throw error;
  }
}
