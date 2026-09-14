import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  type BetterT3FeatureSection,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { act, Children, isValidElement, useState, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { BetterT3SettingsContent } from "./BetterT3SettingsPanel";
import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";
import { SettingsSearchTargetProvider } from "./settingsLayout";

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
const sectionTitles = Object.fromEntries(
  features.map(({ descriptor }) => [descriptor.section, descriptor.section]),
) as Record<BetterT3FeatureSection, string>;

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

it("keeps every setting mounted across category jumps and search jumps to former advanced settings", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const scrollIntoView = vi.fn();
  const focus = vi.fn();
  const onTargetHandled = vi.fn();
  const nodes = new Map<string, unknown>();
  vi.stubGlobal("document", { getElementById: (id: string) => nodes.get(id) });
  let renderer: ReactTestRenderer | undefined;
  const renderContent = (targetId: string | null) => (
    <SettingsSearchTargetProvider targetId={targetId} onTargetHandled={onTargetHandled}>
      <BetterT3SettingsContent
        features={features}
        sectionTitles={sectionTitles}
        translate={translate}
        controls={{}}
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
          };
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
    const settingIds = () =>
      root
        .findAll((node) => typeof node.type === "string" && !!node.props["data-better-t3-feature"])
        .map((node) => node.props["data-better-t3-feature"])
        .sort();
    const expectedIds = features.map(({ descriptor }) => descriptor.id).sort();
    expect(settingIds()).toEqual(expectedIds);
    expect(root.findAllByType("a").map((link) => link.children.join(""))).toEqual([
      "Allgemein",
      "Agenten",
      "Workspace",
      "System",
    ]);

    await act(() =>
      root.findByType("input").props.onChange({ currentTarget: { value: "Unsaved draft" } }),
    );
    for (const group of ["system", "general", "agents"]) {
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
      expect(root.findByType("input").props.value).toBe("Unsaved draft");
    }

    await act(() => renderer!.update(renderContent("knowledge.rebuild")));
    expect(focus).toHaveBeenLastCalledWith("knowledge.rebuild");
    expect(scrollIntoView).toHaveBeenLastCalledWith("knowledge.rebuild", {
      behavior: "auto",
      block: "center",
    });
    expect(onTargetHandled).toHaveBeenCalledOnce();
    expect(root.findByType("input").props.value).toBe("Unsaved draft");

    await act(() => renderer!.update(renderContent("better-t3-group-workspace")));
    expect(focus).toHaveBeenLastCalledWith("better-t3-group-workspace");
    expect(scrollIntoView).toHaveBeenLastCalledWith("better-t3-group-workspace", {
      behavior: "auto",
      block: "start",
    });
  } finally {
    await act(() => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
