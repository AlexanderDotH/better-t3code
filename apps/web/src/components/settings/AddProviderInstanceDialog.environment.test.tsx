import type { ReactElement } from "react";
import { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

const settingsHooks = vi.hoisted(() => ({
  read: vi.fn(() => ({
    providerInstances: { existing: { driver: ProviderDriverKind.make("codex"), enabled: false } },
  })),
}));
const commands = vi.hoisted(() => ({ update: vi.fn(), credential: vi.fn(), toast: vi.fn() }));

vi.mock("../../hooks/useInterfaceTranslator", async () => {
  const { createInterfaceTranslator } = await import("@t3tools/shared/interfaceLanguage");
  return {
    useInterfaceTranslator: () => createInterfaceTranslator({ language: "en", locale: "en-US" }),
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useRef: reactHookHarness.useRef,
    useMemo: reactHookHarness.useMemo,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: settingsHooks.read,
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: "update", setProviderAuthCredential: "credential" },
}));
vi.mock("./useSettingsMutation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useSettingsMutation")>()),
  useSettingsCommand: (command: string) =>
    command === "update" ? commands.update : commands.credential,
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: commands.toast } }));

import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";
import { ProviderSettingsForm } from "./ProviderSettingsForm";
import { AiEndpointDiscovery } from "./AiEndpointDiscovery";

const remoteEnvironmentId = EnvironmentId.make("remote-device");
const onAdded = vi.fn();
const onOpenChange = vi.fn();

function renderDialog() {
  hooks.beginRender();
  return AddProviderInstanceDialog({
    open: true,
    environmentId: remoteEnvironmentId,
    environmentLabel: "Remote device",
    onOpenChange,
    onAdded,
  });
}

function findElement(predicate: (element: ReactElement<Record<string, unknown>>) => boolean) {
  const element = visitElements(renderDialog(), predicate);
  expect(element).not.toBeNull();
  return element!.props;
}

function fillEndpoint() {
  (
    findElement((element) => element.props["aria-labelledby"] === "add-instance-driver-label")
      .onValueChange as (value: string) => void
  )("openaiCompatible");
  (
    findElement((element) => element.props.placeholder === "e.g. Work").onChange as (event: {
      target: { value: string };
    }) => void
  )({ target: { value: "Local" } });
  (
    findElement((element) => element.type === ProviderSettingsForm).onChange as (
      config: unknown,
    ) => void
  )({ baseUrl: "https://models.example/v1", defaultModel: "manual-model" });
  for (let step = 0; step < 2; step++) {
    (findElement((element) => element.props.children === "Next").onClick as () => void)();
  }
  (
    findElement((element) => element.props.type === "password").onChange as (event: {
      currentTarget: { value: string };
    }) => void
  )({ currentTarget: { value: "  endpoint-secret  " } });
}

function submit() {
  (findElement((element) => element.props.children === "Add instance").onClick as () => void)();
}

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("AddProviderInstanceDialog environment routing", () => {
  beforeEach(() => {
    hooks.reset();
    settingsHooks.read.mockClear();
    commands.update.mockReset().mockResolvedValue({});
    commands.credential.mockReset().mockResolvedValue({});
    commands.toast.mockReset();
    onAdded.mockReset();
    onOpenChange.mockReset();
  });

  it("saves the instance in its environment before sending its optional key separately", async () => {
    const settingsRequested = deferred<void>();
    const settingsSaved = deferred<unknown>();
    const added = deferred<void>();
    commands.update.mockImplementation(() => {
      settingsRequested.resolve();
      return settingsSaved.promise;
    });
    onAdded.mockImplementation(() => added.resolve());
    fillEndpoint();
    submit();

    await settingsRequested.promise;
    expect(commands.credential).not.toHaveBeenCalled();
    expect(commands.update).toHaveBeenCalledWith({
      environmentId: remoteEnvironmentId,
      input: {
        patch: {
          providerInstances: {
            existing: { driver: "codex", enabled: false },
            openaiCompatible_local: {
              driver: "openaiCompatible",
              enabled: true,
              displayName: "Local",
              config: { baseUrl: "https://models.example/v1", defaultModel: "manual-model" },
            },
          },
        },
      },
    });
    settingsSaved.resolve({});
    await added.promise;

    expect(settingsHooks.read).toHaveBeenCalledWith(remoteEnvironmentId);
    expect(commands.credential).toHaveBeenCalledWith({
      environmentId: remoteEnvironmentId,
      input: {
        instanceId: ProviderInstanceId.make("openaiCompatible_local"),
        credential: "endpoint-secret",
      },
    });
    expect(findElement((element) => element.props.type === "password").value).toBe("");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("clears entered keys and discovered model suggestions when the address changes", async () => {
    const added = deferred<void>();
    onAdded.mockImplementation(() => added.resolve());
    fillEndpoint();
    const adopt = findElement((element) => element.type === AiEndpointDiscovery).onAdopt as (
      endpoint: unknown,
    ) => void;
    adopt({
      baseUrl: "https://models.example/v1",
      kind: "openaiCompatible",
      verified: true,
      requiresApiKey: false,
      models: [{ id: "discovered-model" }],
    });
    expect(findElement((element) => element.type === ProviderSettingsForm).models).toEqual([
      { slug: "discovered-model", name: "discovered-model" },
    ]);
    (
      findElement((element) => element.props.type === "password").onChange as (event: {
        currentTarget: { value: string };
      }) => void
    )({ currentTarget: { value: "endpoint-secret" } });
    (
      findElement((element) => element.type === ProviderSettingsForm).onChange as (
        config: unknown,
      ) => void
    )({ baseUrl: "https://other.example/v1", defaultModel: "manual-model" });
    expect(findElement((element) => element.type === ProviderSettingsForm).models).toBeUndefined();
    expect(findElement((element) => element.props.type === "password").value).toBe("");
    submit();
    await added.promise;
    expect(commands.credential).not.toHaveBeenCalled();
  });

  it("opens the saved instance for correction when the endpoint rejects its key", async () => {
    const added = deferred<void>();
    onAdded.mockImplementation(() => added.resolve());
    commands.credential.mockRejectedValue(new Error("The endpoint rejected this API key."));
    fillEndpoint();
    submit();
    await added.promise;
    expect(onAdded).toHaveBeenCalledWith(ProviderInstanceId.make("openaiCompatible_local"));
    expect(commands.update).toHaveBeenCalledTimes(1);
    expect(commands.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        description: "The endpoint rejected this API key.",
      }),
    );
  });
});
