import type {
  ButtonHTMLAttributes,
  Dispatch,
  InputHTMLAttributes,
  ReactNode,
  SetStateAction,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentId,
  type ModelSelection,
  ProjectId,
  type ProjectSpeechProfile,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  settings: {
    speechTranscription: {
      assemblyAi: { apiKey: { value: "", valueRedacted: false } },
    },
    textGenerationModelSelection: {
      instanceId: "codex" as ReturnType<typeof ProviderInstanceId.make>,
      model: "gpt-5.6-luna",
    } satisfies ModelSelection,
    voiceTranslationModelSelection: null as ModelSelection | null,
  },
  projects: [] as EnvironmentProject[],
  environments: [] as Array<{ environmentId: EnvironmentId; label: string }>,
  updateSettings: vi.fn(),
  listProfiles: vi.fn(),
  indexProfile: vi.fn(),
  createBasicProfile: vi.fn(),
  modelPickerOnChange: undefined as
    | undefined
    | ((instanceId: ReturnType<typeof ProviderInstanceId.make>, model: string) => void),
  buttonOnClickByLabel: new Map<string, () => void>(),
  resetOnClickByLabel: new Map<string, () => void>(),
}));

const hooks = vi.hoisted(() => {
  let cursor = 0;
  let stateOrdinal = 0;
  let slots: unknown[] = [];
  let stateInitials: unknown[] = [];
  let effectsEnabled = false;

  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
      stateOrdinal = 0;
    },
    reset() {
      cursor = 0;
      stateOrdinal = 0;
      slots = [];
      stateInitials = [];
      effectsEnabled = false;
    },
    setStateInitials(values: unknown[]) {
      stateInitials = values;
    },
    enableEffects() {
      effectsEnabled = true;
    },
    useCallback<T>(callback: T): T {
      nextIndex();
      return callback;
    },
    useEffect(effect: () => void | (() => void)) {
      const index = nextIndex();
      if (!effectsEnabled || slots[index] === true) return;
      slots[index] = true;
      effect();
    },
    useMemo<T>(factory: () => T): T {
      nextIndex();
      return factory();
    },
    useMemoCache(size: number): unknown[] {
      const index = nextIndex();
      if (!Object.hasOwn(slots, index)) {
        slots[index] = Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel"));
      }
      return slots[index] as unknown[];
    },
    useState<T>(initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
      const index = nextIndex();
      const ordinal = stateOrdinal++;
      if (!Object.hasOwn(slots, index)) {
        slots[index] = Object.hasOwn(stateInitials, ordinal)
          ? stateInitials[ordinal]
          : typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      const setValue: Dispatch<SetStateAction<T>> = (nextValue) => {
        const previous = slots[index] as T;
        slots[index] =
          typeof nextValue === "function" ? (nextValue as (value: T) => T)(previous) : nextValue;
      };
      return [slots[index] as T, setValue];
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: hooks.useCallback,
    useEffect: hooks.useEffect,
    useMemo: hooks.useMemo,
    useState: hooks.useState,
  };
});

vi.mock("react/compiler-runtime", () => ({
  c: hooks.useMemoCache,
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => [],
}));

vi.mock("@t3tools/shared/serverSettings", () => ({
  resolveVoiceTranslationModelSelection: (settings: typeof testState.settings) =>
    settings.voiceTranslationModelSelection ?? settings.textGenerationModelSelection,
}));

vi.mock("../../environmentApi", () => ({
  listProjectSpeechProfilesForEnvironment: testState.listProfiles,
  indexProjectSpeechProfileForEnvironment: testState.indexProfile,
  createBasicProjectSpeechProfileForEnvironment: testState.createBasicProfile,
}));

vi.mock("../../hooks/useSettings", () => ({
  usePrimarySettings: () => testState.settings,
  useUpdatePrimarySettings: () => testState.updateSettings,
}));

vi.mock("../../modelSelection", () => ({
  getCustomModelOptionsByInstance: () => new Map(),
  resolveAppModelSelectionState: (settings: typeof testState.settings) =>
    settings.textGenerationModelSelection,
}));

vi.mock("../../providerInstances", () => ({
  applyProviderInstanceSettings: (entries: ReadonlyArray<unknown>) => entries,
  deriveProviderInstanceEntries: () => [],
  sortProviderInstanceEntries: (entries: ReadonlyArray<unknown>) => entries,
}));

vi.mock("../../state/server", () => ({
  primaryServerProvidersAtom: Symbol("primaryServerProvidersAtom"),
}));

vi.mock("../../state/entities", () => ({
  useProjects: () => testState.projects,
}));

vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: testState.environments }),
}));

vi.mock("../ui/badge", () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../chat/ProviderModelPicker", () => ({
  ProviderModelPicker: ({
    activeInstanceId,
    model,
    triggerAriaLabel,
    onInstanceModelChange,
  }: {
    activeInstanceId: ReturnType<typeof ProviderInstanceId.make>;
    model: string;
    triggerAriaLabel?: string;
    onInstanceModelChange: (
      instanceId: ReturnType<typeof ProviderInstanceId.make>,
      model: string,
    ) => void;
  }) => {
    testState.modelPickerOnChange = onInstanceModelChange;
    return (
      <button aria-label={triggerAriaLabel} data-instance-id={activeInstanceId}>
        {model}
      </button>
    );
  },
}));

vi.mock("../ui/button", () => ({
  Button: (
    inputProps: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; variant?: string },
  ) => {
    const { children, size: _size, variant: _variant, ...props } = inputProps;
    const label = props["aria-label"];
    if (typeof label === "string" && props.onClick) {
      testState.buttonOnClickByLabel.set(label, () => props.onClick?.({} as never));
    }
    return <button {...props}>{children}</button>;
  },
}));

vi.mock("../ui/collapsible", () => ({
  Collapsible: ({ children, open }: { children?: ReactNode; open?: boolean }) => (
    <div data-open={open}>{children}</div>
  ),
  CollapsibleTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  CollapsiblePanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../ui/draft-input", () => ({
  DraftInput: ({
    onCommit: _onCommit,
    nativeInput: _nativeInput,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & {
    onCommit?: (value: string) => void;
    nativeInput?: boolean;
  }) => <input {...props} readOnly />,
}));

vi.mock("../ui/spinner", () => ({
  Spinner: () => <span>Loading</span>,
}));

vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
  SettingsSection: ({
    children,
    title,
    headerAction,
  }: {
    children?: ReactNode;
    title: string;
    headerAction?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {headerAction}
      {children}
    </section>
  ),
  SettingsRow: ({
    title,
    description,
    status,
    resetAction,
    control,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    status?: ReactNode;
    resetAction?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
      {status}
      {resetAction}
      {control}
      {children}
    </div>
  ),
  SettingResetButton: ({ label, onClick }: { label: string; onClick: () => void }) => {
    testState.resetOnClickByLabel.set(label, onClick);
    return <button aria-label={`Reset ${label} to default`} onClick={onClick} />;
  },
}));

import { VoiceInputSettings } from "./VoiceInputSettings";

const environmentA = "env-a" as EnvironmentId;
const environmentB = "env-b" as EnvironmentId;
const sharedProjectId = ProjectId.make("shared-project");
const now = "2026-07-20T12:34:56.000Z";

function project(environmentId: EnvironmentId, title: string, workspaceRoot: string) {
  return {
    environmentId,
    id: sharedProjectId,
    title,
    workspaceRoot,
    defaultModelSelection: null,
    checkpointsEnabled: true,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  } as EnvironmentProject;
}

function profile(
  source: "indexed" | "basic",
  prompt: string,
  keyterms: string[],
  technologies: string[],
  warning: string | null,
): ProjectSpeechProfile {
  return {
    projectId: sharedProjectId,
    projectTitle: source === "indexed" ? "Alpha" : "Beta",
    workspaceRoot: source === "indexed" ? "/work/alpha" : "/work/beta",
    repositoryKey: null,
    source,
    contextPrompt: prompt,
    keyterms,
    technologies,
    createdAt: now,
    updatedAt: now,
    warning,
  };
}

function renderSettings(): string {
  hooks.beginRender();
  return renderToStaticMarkup(<VoiceInputSettings />);
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("VoiceInputSettings", () => {
  beforeEach(() => {
    hooks.reset();
    testState.settings = {
      speechTranscription: {
        assemblyAi: { apiKey: { value: "", valueRedacted: false } },
      },
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-luna",
      },
      voiceTranslationModelSelection: null,
    };
    testState.projects = [];
    testState.environments = [];
    testState.modelPickerOnChange = undefined;
    testState.buttonOnClickByLabel.clear();
    testState.resetOnClickByLabel.clear();
    testState.updateSettings.mockReset();
    testState.listProfiles.mockReset();
    testState.listProfiles.mockResolvedValue({ profiles: [] });
    testState.indexProfile.mockReset();
    testState.createBasicProfile.mockReset();
  });

  it("renders each environment's exact AssemblyAI profile payload", () => {
    const indexedProfile = profile(
      "indexed",
      "Prefer AlphaWidget and preserve slash commands exactly.",
      ["AlphaWidget", "/deploy"],
      ["TypeScript", "React"],
      "Some ignored files were omitted.",
    );
    const basicProfile = profile("basic", "Project Beta at /work/beta.", ["Beta"], ["Rust"], null);
    testState.projects = [
      project(environmentA, "Alpha", "/work/alpha"),
      project(environmentB, "Beta", "/work/beta"),
    ];
    testState.environments = [
      { environmentId: environmentA, label: "Local" },
      { environmentId: environmentB, label: "Remote" },
    ];
    hooks.setStateInitials([
      new Map([
        [environmentA, { status: "ready", profiles: new Map([[sharedProjectId, indexedProfile]]) }],
        [environmentB, { status: "ready", profiles: new Map([[sharedProjectId, basicProfile]]) }],
      ]),
    ]);

    const markup = renderSettings();

    expect(markup).toContain("Prefer AlphaWidget and preserve slash commands exactly.");
    expect(markup).toContain("Project Beta at /work/beta.");
    for (const exactValue of [
      "AlphaWidget",
      "/deploy",
      "TypeScript",
      "React",
      "Beta",
      "Rust",
      "Some ignored files were omitted.",
      "Indexed",
      "Basic context",
    ]) {
      expect(markup).toContain(exactValue);
    }
    expect(markup).toContain(`dateTime="${now}"`);
  });

  it("configures a dedicated voice post-processing model without changing the global model", () => {
    const inheritedMarkup = renderSettings();

    expect(inheritedMarkup).toContain("Voice post-processing model");
    expect(inheritedMarkup).toContain("AssemblyAI still handles live speech recognition");
    expect(inheritedMarkup).toContain('aria-label="Voice post-processing model"');
    expect(inheritedMarkup).toContain("gpt-5.6-luna");

    testState.modelPickerOnChange?.(ProviderInstanceId.make("codex_personal"), "gpt-5.6-terra");

    expect(testState.updateSettings).toHaveBeenCalledWith({
      voiceTranslationModelSelection: {
        instanceId: "codex_personal",
        model: "gpt-5.6-terra",
      },
    });

    testState.updateSettings.mockReset();
    testState.settings.voiceTranslationModelSelection = {
      instanceId: ProviderInstanceId.make("codex_personal"),
      model: "gpt-5.6-terra",
    };
    renderSettings();
    testState.resetOnClickByLabel.get("voice post-processing model")?.();

    expect(testState.updateSettings).toHaveBeenCalledWith({
      voiceTranslationModelSelection: null,
    });
  });

  it("indexes and creates basic context through the environment helpers, then refreshes", async () => {
    const indexedProfile = profile("indexed", "Alpha context.", ["Alpha"], ["TypeScript"], null);
    testState.projects = [project(environmentA, "Alpha", "/work/alpha")];
    testState.environments = [{ environmentId: environmentA, label: "Local" }];
    hooks.setStateInitials([
      new Map([
        [environmentA, { status: "ready", profiles: new Map([[sharedProjectId, indexedProfile]]) }],
      ]),
    ]);
    testState.indexProfile.mockResolvedValue(indexedProfile);
    testState.createBasicProfile.mockResolvedValue(indexedProfile);
    testState.listProfiles.mockResolvedValue({ profiles: [indexedProfile] });
    renderSettings();

    const reindex = testState.buttonOnClickByLabel.get("Reindex Alpha speech profile");
    const useBasicContext = testState.buttonOnClickByLabel.get("Use basic context for Alpha");
    expect(reindex).toBeDefined();
    expect(useBasicContext).toBeDefined();

    reindex?.();
    await flushPromises();
    useBasicContext?.();
    await flushPromises();

    expect(testState.indexProfile).toHaveBeenCalledWith(environmentA, sharedProjectId);
    expect(testState.createBasicProfile).toHaveBeenCalledWith(environmentA, sharedProjectId);
    expect(testState.listProfiles).toHaveBeenCalledTimes(2);
    expect(testState.listProfiles).toHaveBeenNthCalledWith(1, environmentA);
    expect(testState.listProfiles).toHaveBeenNthCalledWith(2, environmentA);
  });

  it("loads profiles once for each distinct project environment on mount", async () => {
    testState.projects = [
      project(environmentA, "Alpha", "/work/alpha"),
      { ...project(environmentA, "Alpha tools", "/work/alpha-tools"), id: ProjectId.make("tools") },
      project(environmentB, "Beta", "/work/beta"),
    ];
    testState.environments = [
      { environmentId: environmentA, label: "Local" },
      { environmentId: environmentB, label: "Remote" },
    ];
    hooks.enableEffects();

    renderSettings();

    expect(testState.listProfiles).toHaveBeenCalledTimes(2);
    expect(testState.listProfiles).toHaveBeenNthCalledWith(1, environmentA);
    expect(testState.listProfiles).toHaveBeenNthCalledWith(2, environmentB);
    await flushPromises();
  });
});
