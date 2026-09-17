import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";
import { mergeClientSettingsPatch } from "@t3tools/client-runtime/client-settings";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, Children, isValidElement, useState, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
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

vi.mock("./BetterT3SettingsSearch", () => ({ BetterT3SettingsSearch: () => null }));

const translate = createInterfaceTranslator({ language: "de", locale: "de-DE" }).message;
const features = buildBetterT3ControlStates({
  registry: BETTER_T3_FEATURE_REGISTRY,
  device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  surface: "web",
  capabilities: {},
});
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
                  : "chat"
            }
            onChange={(value) => {
              if (value !== "none" && value !== "chat" && value !== "working") return;
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

it("keeps all three reasoning choices visible and switches display and compatibility settings together", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onChange = vi.fn();
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(<ReasoningSettingsHarness onChange={onChange} />);
    });
    expect(renderer!.root.findAllByType("details")).toHaveLength(0);
    expect(
      renderer!.root.findAllByProps({ "data-better-t3-feature": "agent.reasoningWorkingOverlay" }),
    ).toHaveLength(0);
    const reasoningRow = renderer!.root.findByProps({
      id: "agent.reasoningVisibility",
      "data-slot": "settings-row",
    });
    expect(reasoningRow.findAllByProps({ role: "switch" })).toHaveLength(0);
    const radios = () => renderer!.root.findAllByProps({ role: "radio" });
    expect(radios().map((node) => node.props["aria-checked"])).toEqual([true, false, false]);
    for (const index of [1, 2, 0, 2, 1, 0]) {
      await act(() => radios()[index]!.props.onClick());
      expect(radios().map((node) => node.props["aria-checked"])).toEqual(
        [0, 1, 2].map((value) => value === index),
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
          },
        },
      });
    }
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});

it("keeps every setting mounted across category jumps and search jumps to former advanced settings", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const scrollIntoView = vi.fn();
  const focus = vi.fn();
  const onTargetHandled = vi.fn();
  const nodes = new Map<string, unknown>();
  const navigationStyles = new Map<string, string>();
  const navigation = {
    offsetHeight: 182,
    parentElement: {
      style: {
        setProperty: (name: string, value: string) => navigationStyles.set(name, value),
        removeProperty: (name: string) => navigationStyles.delete(name),
      },
    },
  };
  let resizeNavigation = () => {};
  const disconnectNavigation = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeNavigation = callback;
      }
      observe = vi.fn();
      disconnect = disconnectNavigation;
    },
  );
  vi.stubGlobal("document", { getElementById: (id: string) => nodes.get(id) });
  let renderer: ReactTestRenderer | undefined;
  const renderContent = (targetId: string | null) => (
    <SettingsSearchTargetProvider targetId={targetId} onTargetHandled={onTargetHandled}>
      <BetterT3SettingsContent
        features={features}
        translate={translate}
        controls={{}}
        languageControl={<span>Interface language</span>}
        usagePacingControl={<span>Usage pacing</span>}
        visualSettings={<span>Glass opacity</span>}
        featureChoices={Object.fromEntries(
          features.map(({ descriptor }) => [
            descriptor.id,
            descriptor.id === "agent.fetchModel" ? (
              <DraftControl key={descriptor.id} />
            ) : (
              descriptor.id
            ),
          ]),
        )}
        onSwitchChange={vi.fn()}
      />
    </SettingsSearchTargetProvider>
  );

  try {
    await act(() => {
      renderer = create(renderContent(null), {
        createNodeMock: (element) => {
          const props = element.props as {
            id?: string;
            children?: ReactNode;
            onFocusCapture?: () => void;
            "data-better-t3-navigation"?: boolean;
          };
          if (props["data-better-t3-navigation"] !== undefined) return navigation;
          if (!props.id) return null;
          const id = props.id;
          const header = Children.toArray(props.children).find(
            (child) =>
              isValidElement<Record<string, unknown>>(child) &&
              child.props["data-settings-scroll-target"] !== undefined,
          );
          const node = {
            dataset: {},
            querySelector: () =>
              isValidElement<Record<string, unknown>>(header)
                ? {
                    dataset: { settingsScrollTarget: header.props["data-settings-scroll-target"] },
                    scrollIntoView: (options: ScrollIntoViewOptions) => scrollIntoView(id, options),
                  }
                : null,
            scrollIntoView: (options: ScrollIntoViewOptions) => scrollIntoView(id, options),
            focus: () => {
              focus(id);
              props.onFocusCapture?.();
            },
            classList: { remove: vi.fn() },
          };
          nodes.set(id, node);
          return node;
        },
      });
    });
    const root = renderer!.root;
    expect(navigationStyles.get("--better-t3-navigation-height")).toBe("182px");
    const settingIds = () =>
      root
        .findAll((node) => typeof node.type === "string" && !!node.props["data-better-t3-feature"])
        .map((node) => node.props["data-better-t3-feature"])
        .sort();
    const expectedIds = features
      .map(({ descriptor }) => descriptor.id)
      .filter((id) => id !== "agent.reasoningWorkingOverlay")
      .sort();
    expect(settingIds()).toEqual(expectedIds);
    expect(root.findAllByType("a").map((link) => link.children.join(""))).toEqual([
      "Allgemein",
      "Darstellung",
      "Chat",
      "Seitenleiste",
      "Nutzung",
      "Agenten",
      "Workspace",
      "Spracheingabe",
      "Wissen",
      "System",
      "Integrationen",
    ]);
    for (const [group, featureId] of [
      ["appearance", "chat.presentation"],
      ["chat", "chat.characterStreamingMotion"],
      ["chat", "agent.reasoningVisibility"],
      ["sidebar", "chat.sorting"],
      ["agents", "agent.deepThinking"],
      ["workspace", "workspace.checkpoints"],
      ["voice", "voice.outputLanguage"],
      ["voice", "agent.promptImprovement"],
      ["knowledge", "knowledge.graph"],
      ["system", "resource.diagnostics"],
      ["integrations", "integration.mcp"],
    ]) {
      const region = root.findByProps({ id: `better-t3-group-${group}`, role: "region" });
      expect(
        region.findByProps({ id: featureId, "data-better-t3-feature": featureId }),
      ).toBeDefined();
    }
    for (const [group, label] of [
      ["general", "Interface language"],
      ["appearance", "Glass opacity"],
      ["usage", "Usage pacing"],
    ]) {
      const region = root.findByProps({ id: `better-t3-group-${group}`, role: "region" });
      expect(region.findAllByType("span").map((node) => node.children.join(""))).toContain(label);
    }

    await act(() =>
      root
        .findByProps({ "aria-label": "Draft setting" })
        .props.onChange({ currentTarget: { value: "Unsaved draft" } }),
    );
    for (const group of [
      "general",
      "appearance",
      "chat",
      "sidebar",
      "usage",
      "agents",
      "workspace",
      "voice",
      "knowledge",
      "system",
      "integrations",
    ]) {
      await act(() => {
        root.findByProps({ href: `#better-t3-group-${group}` }).props.onClick({
          preventDefault: vi.fn(),
        });
      });
      expect(focus).toHaveBeenLastCalledWith(`better-t3-group-${group}`);
      expect(scrollIntoView).toHaveBeenLastCalledWith(`better-t3-group-${group}`, {
        behavior: "auto",
        block: "start",
      });
      expect(settingIds()).toEqual(expectedIds);
      expect(root.findByProps({ "aria-label": "Draft setting" }).props.value).toBe("Unsaved draft");
    }

    navigation.offsetHeight = 326;
    resizeNavigation();
    expect(navigationStyles.get("--better-t3-navigation-height")).toBe("326px");

    await act(() => renderer!.update(renderContent("knowledge.rebuild")));
    expect(focus).toHaveBeenLastCalledWith("knowledge.rebuild");
    expect(scrollIntoView).toHaveBeenLastCalledWith("knowledge.rebuild", {
      behavior: "auto",
      block: "center",
    });
    expect(onTargetHandled).toHaveBeenCalledOnce();
    expect(root.findByProps({ "aria-label": "Draft setting" }).props.value).toBe("Unsaved draft");

    await act(() => renderer!.update(renderContent("better-t3-group-sidebar")));
    expect(focus).toHaveBeenLastCalledWith("better-t3-group-sidebar");
    expect(scrollIntoView).toHaveBeenLastCalledWith("better-t3-group-sidebar", {
      behavior: "auto",
      block: "start",
    });
    await act(() => renderer!.unmount());
    renderer = undefined;
    expect(disconnectNavigation).toHaveBeenCalledOnce();
    expect(navigationStyles.size).toBe(0);
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
