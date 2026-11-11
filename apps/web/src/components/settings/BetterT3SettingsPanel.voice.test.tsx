import { installMemoryStorage } from "../../../test/memoryStorage";
import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => ({
  settings: new Map<string, UnifiedSettings>(),
  updateSettings: vi.fn(),
  saveSettings: vi.fn(async (_request: unknown) => ({
    _tag: "Success" as const,
    value: undefined,
  })),
  profilesQuery: vi.fn((input: { environmentId: string; input: object }) => input),
  environments: [
    { environmentId: "local", label: "Local" },
    { environmentId: "remote", label: "Remote" },
  ],

  projects: [
    {
      environmentId: "local",
      id: "local-project",
      title: "Local project",
      workspaceRoot: "/local",
    },
    {
      environmentId: "remote",
      id: "remote-project",
      title: "Remote project",
      workspaceRoot: "/remote",
    },
  ],
}));
vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  useEnvironmentSettings: (environmentId: string) => fixture.settings.get(environmentId),
  useUpdateEnvironmentSettings: (environmentId: string) => (patch: unknown) =>
    fixture.updateSettings(environmentId, patch),
  usePrimarySettingsAvailable: () => true,
}));
vi.mock("../../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/environments")>()),
  useEnvironments: () => ({ environments: fixture.environments }),
}));
vi.mock("../../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/entities")>()),
  useProjects: () => fixture.projects,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => fixture.saveSettings,
}));
vi.mock("../../state/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/server")>();
  return {
    serverEnvironment: {
      ...actual.serverEnvironment,
      projectSpeechProfilesQuery: fixture.profilesQuery,
    },
  };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { profiles: [] },
    error: null,
    isPending: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  const translator = createInterfaceTranslator({ language: "en", locale: "en-US" });
  return { useInterfaceTranslator: () => translator };
});
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("../chat/ProviderModelPicker", () => ({
  ProviderModelPicker: (props: {
    triggerAriaLabel: string;
    disabled: boolean;
    onInstanceModelChange: (instanceId: string, model: string) => void;
  }) => (
    <button
      aria-label={props.triggerAriaLabel}
      disabled={props.disabled}
      onClick={() => props.onInstanceModelChange("codex", "selected-voice-model")}
    />
  ),
}));

import { BetterT3SettingsContent } from "./BetterT3SettingsPanel";
import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";
import { VoiceInputSettings } from "./VoiceInputSettings";

const translate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;

it("shows each voice setting once and keeps credentials, models, and projects in the selected environment", async () => {
  installMemoryStorage();
  window.localStorage.clear();
  fixture.updateSettings.mockClear();
  fixture.saveSettings.mockClear();
  fixture.profilesQuery.mockClear();
  for (const environmentId of ["local", "remote"]) {
    fixture.settings.set(environmentId, {
      ...DEFAULT_UNIFIED_SETTINGS,
      speechTranscription: {
        ...DEFAULT_UNIFIED_SETTINGS.speechTranscription,
        assemblyAi: {
          ...DEFAULT_UNIFIED_SETTINGS.speechTranscription.assemblyAi,
          apiKey: { value: `${environmentId}-key`, valueRedacted: false },
        },
      },
    });
  }
  const content = (environmentId: string, disabled = false) => (
    <BetterT3SettingsContent
      translate={translate}
      features={buildBetterT3ControlStates({
        registry: BETTER_T3_FEATURE_REGISTRY,
        device: DEFAULT_UNIFIED_SETTINGS.betterT3Device,
        environment: DEFAULT_UNIFIED_SETTINGS.betterT3Environment,
        surface: "web",
        capabilities: { environmentSettingsVersion: 1 },
      })}
      controls={{}}
      onSwitchChange={vi.fn()}
      voiceSettings={
        <VoiceInputSettings
          key={environmentId}
          environmentId={EnvironmentId.make(environmentId)}
          disabled={disabled}
        />
      }
    />
  );

  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(content("remote"));
    });
    expect(fixture.updateSettings).not.toHaveBeenCalled();
    const voiceRegion = renderer!.root.findByProps({ id: "better-t3-group-voice", role: "region" });
    const composerRegion = renderer!.root.findByProps({
      id: "better-t3-group-composer",
      role: "region",
    });
    expect(
      composerRegion.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props["data-better-t3-feature"] === "agent.promptImprovement",
      ),
    ).toHaveLength(1);
    for (const featureId of [
      "voice.assemblyAi",
      "voice.outputLanguage",
      "voice.credentials",
      "voice.transcriptPortability",
    ]) {
      expect(
        voiceRegion.findAll(
          (node) =>
            typeof node.type === "string" && node.props["data-better-t3-feature"] === featureId,
        ),
      ).toHaveLength(1);
    }
    const keyInput = () =>
      renderer!.root.findAllByType("input").find((node) => node.props.type === "password")!;
    expect(keyInput().props.value).toBe("remote-key");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Remote project");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Local project");
    expect(fixture.profilesQuery).toHaveBeenCalled();
    expect(
      fixture.profilesQuery.mock.calls.every(([request]) => request.environmentId === "remote"),
    ).toBe(true);

    await act(async () => {
      await keyInput().props.onChange({ target: { value: "updated-remote-key" } });
    });
    await act(async () => {
      await keyInput().props.onBlur();
    });
    expect(fixture.saveSettings).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: {
        patch: {
          speechTranscription: {
            assemblyAi: { apiKey: { value: "updated-remote-key", valueRedacted: false } },
          },
        },
      },
    });
    await act(async () => {
      await renderer!.root.findByProps({ "aria-label": "Voice translation model" }).props.onClick();
    });
    expect(fixture.updateSettings).toHaveBeenLastCalledWith("remote", {
      voiceTranslationModelSelection: { instanceId: "codex", model: "selected-voice-model" },
    });
    await act(async () => {
      await renderer!.root
        .findAllByType("button")
        .find((node) => node.props["aria-label"] === "Reset AssemblyAI API key to default")!
        .props.onClick({ stopPropagation: vi.fn(), nativeEvent: {} });
    });
    expect(fixture.saveSettings).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: {
        patch: {
          speechTranscription: { assemblyAi: { apiKey: { value: "", valueRedacted: false } } },
        },
      },
    });

    fixture.settings.set("remote", {
      ...fixture.settings.get("remote")!,
      voiceTranslationModelSelection: {
        instanceId: ProviderInstanceId.make("removed-provider"),
        model: "saved-remote-model",
      },
    });
    await act(async () => {
      await renderer!.update(content("remote"));
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("saved-remote-model");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Unavailable");
    expect(
      fixture.profilesQuery.mock.calls.every(([request]) => request.environmentId === "remote"),
    ).toBe(true);
    await act(async () => {
      await keyInput().props.onChange({ target: { value: "unsaved-remote-draft" } });
    });
    await act(async () => {
      await renderer!.update(content("local"));
    });
    expect(keyInput().props.value).toBe("local-key");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("saved-remote-model");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Local project");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Remote project");
    expect(fixture.profilesQuery).toHaveBeenLastCalledWith({ environmentId: "local", input: {} });

    const requestsBeforeDisabled = fixture.profilesQuery.mock.calls.length;
    await act(async () => {
      await renderer!.update(content("local", true));
    });
    expect(fixture.profilesQuery).toHaveBeenCalledTimes(requestsBeforeDisabled);
    expect(keyInput().props.disabled).toBe(true);
    expect(
      renderer!.root.findByProps({ "aria-label": "Voice translation model" }).props.disabled,
    ).toBe(true);
  } finally {
    await act(async () => {
      await renderer?.unmount();
    });
    vi.unstubAllGlobals();
  }
});
