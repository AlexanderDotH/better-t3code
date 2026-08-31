import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import type { ResolvedInterfaceLocale } from "@t3tools/shared/interfaceLanguage";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const atoms = vi.hoisted(() => ({
  providers: null as ReadonlyArray<ServerProvider> | null,
  providersAtom: Symbol("providers"),
  refreshProviders: Symbol("refreshProviders"),
  updateProvider: Symbol("updateProvider"),
}));

const commands = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateProvider: vi.fn(),
}));

const settingsState = vi.hoisted(() => ({
  value: null as UnifiedSettings | null,
  readEnvironmentIds: [] as EnvironmentId[],
  updateEnvironmentIds: [] as EnvironmentId[],
  updateSettings: vi.fn(),
}));

const localeState = vi.hoisted(() => ({
  value: { language: "en", locale: "en-US" } as ResolvedInterfaceLocale,
}));

const rendered = vi.hoisted(() => ({
  buttons: [] as Array<Record<string, unknown>>,
  providerCards: [] as Array<Record<string, unknown>>,
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => atoms.providers,
}));

vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: {
    providersValueAtom: () => atoms.providersAtom,
    refreshProviders: atoms.refreshProviders,
    updateProvider: atoms.updateProvider,
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) =>
    atom === atoms.refreshProviders ? commands.refresh : commands.updateProvider,
}));

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: (environmentId: EnvironmentId) => {
    settingsState.readEnvironmentIds.push(environmentId);
    return settingsState.value;
  },
  useUpdateEnvironmentSettings: (environmentId: EnvironmentId) => {
    settingsState.updateEnvironmentIds.push(environmentId);
    return settingsState.updateSettings;
  },
}));

vi.mock("../../interfaceLanguageRuntime", () => ({
  useInterfaceLocaleRuntime: () => localeState.value,
}));

vi.mock("../../environments/primary", () => ({
  usePrimarySessionState: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));

vi.mock("../../state/session", () => ({
  useEnvironmentSessionState: () => ({ data: null, hasError: false, isPending: true }),
}));

vi.mock("../ui/button", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/button")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Button: (props: Record<string, unknown>) => {
      rendered.buttons.push(props);
      return createElement(
        "button",
        {
          "aria-label": props["aria-label"],
          disabled: props.disabled,
        },
        props.children as ReactNode,
      );
    },
  };
});

vi.mock("../ui/tooltip", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    Tooltip: (props: Record<string, unknown>) =>
      createElement(Fragment, null, props.children as ReactNode),
    TooltipPopup: (props: Record<string, unknown>) =>
      createElement("span", null, props.children as ReactNode),
    TooltipTrigger: (props: Record<string, unknown>) =>
      createElement(Fragment, null, props.render as ReactNode),
  };
});

vi.mock("./ProviderInstanceCard", async () => {
  const { createElement } = await import("react");
  return {
    ProviderInstanceCard: (props: Record<string, unknown>) => {
      rendered.providerCards.push(props);
      return createElement("div", {
        "data-instance-id": String(props.instanceId),
        "data-provider-mode": String(props.mode),
        "data-read-only": props.readOnly === true ? "true" : "false",
      });
    },
  };
});

import {
  buildDeleteProviderInstancePatch,
  buildResetDefaultProviderInstancePatch,
} from "./ProviderSettingsPanel.logic";
import { EnvironmentProviderSettings } from "./ProviderSettingsPanel";

const environmentId = EnvironmentId.make("remote-device");
const codexId = ProviderInstanceId.make("codex");
const customId = ProviderInstanceId.make("codex_work");
const chatGptId = ProviderInstanceId.make("chatgpt_work");
const openAiId = ProviderInstanceId.make("openai_work");

function provider(): ServerProvider {
  return {
    instanceId: codexId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-24T12:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      updateCommand: "pnpm add -g @openai/codex@latest",
      canUpdate: true,
      checkedAt: "2026-07-24T12:00:00.000Z",
      message: "Update available.",
    },
  };
}

function renderPanel(options?: {
  readonly readOnly?: boolean;
  readonly authFlow?: "browser" | "device-code";
}): string {
  rendered.buttons = [];
  rendered.providerCards = [];
  return renderToStaticMarkup(
    <EnvironmentProviderSettings
      environmentId={environmentId}
      environmentLabel="Remote device"
      {...(options?.readOnly === undefined ? {} : { readOnly: options.readOnly })}
      {...(options?.authFlow === undefined ? {} : { authFlow: options.authFlow })}
    />,
  );
}

function renderedButton(label: string): Record<string, unknown> | undefined {
  return rendered.buttons.find((button) => button["aria-label"] === label);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("EnvironmentProviderSettings routing", () => {
  beforeEach(() => {
    atoms.providers = null;
    settingsState.value = DEFAULT_UNIFIED_SETTINGS;
    settingsState.readEnvironmentIds = [];
    settingsState.updateEnvironmentIds = [];
    settingsState.updateSettings.mockReset();
    commands.refresh.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.updateProvider.mockReset().mockResolvedValue({ _tag: "Success" });
    localeState.value = { language: "en", locale: "en-US" };
    rendered.buttons = [];
    rendered.providerCards = [];
  });

  it("coalesces a nullable provider snapshot before rendering array-backed UI", () => {
    expect(() => renderPanel()).not.toThrow();
    expect(settingsState.readEnvironmentIds).toEqual([environmentId]);
    expect(settingsState.updateEnvironmentIds).toEqual([environmentId]);
  });

  it("routes refresh and provider update commands to the selected environment", async () => {
    atoms.providers = [provider()];
    renderPanel();

    const refreshButton = renderedButton("Refresh provider status");
    expect(refreshButton).toBeDefined();
    (refreshButton?.onClick as (() => void) | undefined)?.();
    await flushPromises();
    expect(commands.refresh).toHaveBeenCalledWith({ environmentId, input: {} });

    const providerCard = rendered.providerCards.find(
      (card) => card.instanceId === codexId && card.mode === "editor",
    );
    expect(providerCard).toBeDefined();
    (providerCard?.onRunUpdate as (() => void) | undefined)?.();
    await flushPromises();
    expect(commands.updateProvider).toHaveBeenCalledWith({
      environmentId,
      input: { provider: ProviderDriverKind.make("codex"), instanceId: codexId },
    });
  });

  it("keeps provider selection available while write controls are read only", () => {
    settingsState.value = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [customId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
    };
    atoms.providers = [provider()];
    const markup = renderPanel({ readOnly: true });

    const customRow = rendered.providerCards.find(
      (card) => card.instanceId === customId && card.mode === "list",
    );
    expect(customRow?.readOnly).toBe(true);
    expect(customRow?.onSelect).toBeTypeOf("function");
    expect(markup).toContain("Limited permissions");
    expect(renderedButton("Refresh provider status")).toBeUndefined();
    expect(renderedButton("Add provider")).toBeUndefined();
  });

  it("keeps the editable layout interactive when not read only", () => {
    atoms.providers = [provider()];
    const markup = renderPanel();
    expect(markup).not.toContain("Limited permissions");
    expect(renderedButton("Refresh provider status")).toBeDefined();
    expect(renderedButton("Add provider")).toBeDefined();
  });

  it("passes auth routing to the provider card without a duplicate onboarding row", () => {
    settingsState.value = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [chatGptId]: { driver: ProviderDriverKind.make("chatgpt"), enabled: true },
      },
    };
    atoms.providers = [
      {
        ...provider(),
        instanceId: chatGptId,
        driver: ProviderDriverKind.make("chatgpt"),
        auth: {
          status: "unauthenticated",
          capabilities: { flows: ["device-code"], canDisconnect: false },
        },
      },
    ];

    const markup = renderPanel({ authFlow: "device-code", readOnly: true });
    const card = rendered.providerCards.find((candidate) => candidate.instanceId === chatGptId);
    expect(card?.environmentId).toBe(environmentId);
    expect(card?.providerAuthFlow).toBe("device-code");
    expect(card?.readOnly).toBe(true);
    expect(markup).not.toContain("ChatGPT Subscription");
  });

  it("separates Better T3 providers without changing provider selection", () => {
    settingsState.value = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [customId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
        [chatGptId]: { driver: ProviderDriverKind.make("chatgpt"), enabled: true },
        [openAiId]: { driver: ProviderDriverKind.make("openai"), enabled: true },
      },
    };

    const markup = renderPanel();
    const coreGroupIndex = markup.indexOf('data-provider-group="core"');
    const additionalGroupIndex = markup.indexOf('data-provider-group="better-t3"');
    const customIndex = markup.indexOf(`data-instance-id="${customId}"`);
    const chatGptIndex = markup.indexOf(`data-instance-id="${chatGptId}"`);
    const openAiIndex = markup.indexOf(`data-instance-id="${openAiId}"`);

    expect(coreGroupIndex).toBeGreaterThan(-1);
    expect(additionalGroupIndex).toBeGreaterThan(coreGroupIndex);
    expect(customIndex).toBeGreaterThan(coreGroupIndex);
    expect(customIndex).toBeLessThan(additionalGroupIndex);
    expect(chatGptIndex).toBeGreaterThan(additionalGroupIndex);
    expect(openAiIndex).toBeGreaterThan(additionalGroupIndex);
    expect(markup).toContain("Additional Better T3 providers");
  });

  it("localizes the Better T3 provider separator", () => {
    localeState.value = { language: "de", locale: "de-DE" };
    settingsState.value = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [chatGptId]: { driver: ProviderDriverKind.make("chatgpt"), enabled: true },
      },
    };

    expect(renderPanel()).toContain("Zusätzliche Better-T3-Provider");
  });

  it("builds delete and reset patches without erasing shared preferences", () => {
    const settings: UnifiedSettings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      providerInstances: {
        [codexId]: { driver: ProviderDriverKind.make("codex"), enabled: false },
        [customId]: { driver: ProviderDriverKind.make("codex"), enabled: true },
      },
      providerModelPreferences: {
        [customId]: { hiddenModels: ["hidden"], modelOrder: ["model"] },
      },
      favorites: [{ provider: customId, model: "favorite" }],
    };

    expect(buildDeleteProviderInstancePatch(settings, customId)).toEqual({
      providerInstances: {
        [codexId]: settings.providerInstances?.[codexId],
      },
    });

    const resetPatch = buildResetDefaultProviderInstancePatch(
      settings,
      ProviderDriverKind.make("codex"),
    );
    expect(Object.keys(resetPatch ?? {}).sort()).toEqual(["providerInstances", "providers"]);
    expect(resetPatch).not.toHaveProperty("favorites");
    expect(resetPatch).not.toHaveProperty("providerModelPreferences");
    expect(resetPatch?.providerInstances).toEqual({
      [customId]: settings.providerInstances?.[customId],
    });
  });
});
