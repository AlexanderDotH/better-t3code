import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

import { ProviderSubscriptionAuthControls } from "./ProviderSubscriptionAuthControls";
import type { ProviderSubscriptionPresentation } from "./ProviderSubscriptionAuth";

const connectPresentation: ProviderSubscriptionPresentation = {
  action: "connect",
  actionLabel: "Connect",
  providerName: "ChatGPT Subscription",
  flows: ["browser", "device-code"],
  credential: null,
  canDisconnect: false,
  environmentCredential: false,
  account: null,
  plan: null,
  rateLimit: null,
  tone: "neutral",
};

const disconnectPresentation: ProviderSubscriptionPresentation = {
  action: "disconnect",
  actionLabel: "Disconnect",
  providerName: "ChatGPT Subscription",
  flows: ["browser", "device-code"],
  credential: null,
  canDisconnect: true,
  environmentCredential: false,
  account: "alex@example.com",
  plan: "Pro",
  rateLimit: null,
  tone: "neutral",
};

function renderControls(
  props: Partial<Parameters<typeof ProviderSubscriptionAuthControls>[0]> = {},
): ReactElement<Record<string, unknown>> {
  hooks.beginRender();
  return ProviderSubscriptionAuthControls({
    presentation: connectPresentation,
    flow: "browser",
    readOnly: false,
    event: null,
    onConnect: async () => {},
    onSetCredential: async () => {},
    onDisconnect: async () => {},
    ...props,
  }) as ReactElement<Record<string, unknown>>;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ProviderSubscriptionAuthControls", () => {
  beforeEach(() => hooks.reset());

  it("shows a static prominent connect button and preserves visible failures", async () => {
    const onConnect = vi.fn(async () => {});
    const initial = renderControls({ onConnect });
    const connectButton = visitElements(
      initial,
      (element) => element.props["aria-label"] === "Connect ChatGPT Subscription",
    );
    expect(connectButton).not.toBeNull();
    expect(String(connectButton?.props.className)).not.toContain("animate");

    (connectButton?.props.onClick as (() => void) | undefined)?.();
    await flushPromises();

    const failed = renderControls({
      onConnect,
      event: {
        type: "failed",
        failure: { code: "challenge-expired", reason: "Device code expired.", retryable: true },
      },
    });
    expect(
      visitElements(failed, (element) => element.props["data-provider-auth-state"] === "failed"),
    ).not.toBeNull();
    expect(onConnect).toHaveBeenCalledWith("browser");
  });

  it("renders the device URL and user code emitted by a remote flow", async () => {
    const onConnect = vi.fn(async () => {});
    const initial = renderControls({ flow: "device-code", onConnect });
    const connectButton = visitElements(
      initial,
      (element) => element.props["aria-label"] === "Connect ChatGPT Subscription",
    );
    (connectButton?.props.onClick as (() => void) | undefined)?.();
    await flushPromises();

    const challenge = renderControls({
      flow: "device-code",
      onConnect,
      event: {
        type: "deviceCodeChallenge",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-08-23T16:00:00.000Z",
        pollIntervalSeconds: 5,
      },
    });
    const state = visitElements(
      challenge,
      (element) => element.props["data-provider-auth-state"] === "device-code",
    );
    expect(state?.props.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ props: expect.any(Object) })]),
    );
    expect(onConnect).toHaveBeenCalledWith("device-code");
  });

  it("requires confirmation before disconnecting only the selected instance", async () => {
    const onDisconnect = vi.fn(async () => {});
    const initial = renderControls({
      presentation: disconnectPresentation,
      onDisconnect,
    });
    const disconnectButton = visitElements(
      initial,
      (element) => element.props["aria-label"] === "Disconnect ChatGPT Subscription",
    );
    (disconnectButton?.props.onClick as (() => void) | undefined)?.();
    expect(onDisconnect).not.toHaveBeenCalled();

    const confirmation = renderControls({
      presentation: disconnectPresentation,
      onDisconnect,
    });
    const confirmButton = visitElements(
      confirmation,
      (element) => element.props["aria-label"] === "Confirm disconnect ChatGPT Subscription",
    );
    (confirmButton?.props.onClick as (() => void) | undefined)?.();
    await flushPromises();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("shows read-only context without exposing auth actions", () => {
    const tree = renderControls({ readOnly: true });
    expect(
      visitElements(tree, (element) => element.props["data-provider-auth-read-only"] === true),
    ).not.toBeNull();
    expect(
      visitElements(tree, (element) => typeof element.props["aria-label"] === "string"),
    ).toBeNull();
  });

  it("lets authenticated OpenRouter replace or disconnect and clears a submitted key immediately", async () => {
    let resolveCredential: (() => void) | undefined;
    const onSetCredential = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCredential = resolve;
        }),
    );
    const presentation: ProviderSubscriptionPresentation = {
      ...connectPresentation,
      action: "set-credential",
      actionLabel: "Replace API key",
      providerName: "OpenRouter",
      credential: { kind: "api-key", label: "API key", placeholder: "sk-or-v1-…" },
      canDisconnect: true,
    };

    const initial = renderControls({ presentation, onSetCredential });
    const replaceButton = visitElements(
      initial,
      (element) => element.props["aria-label"] === "Replace API key for OpenRouter",
    );
    expect(
      visitElements(initial, (element) => element.props["aria-label"] === "Disconnect OpenRouter"),
    ).not.toBeNull();
    (replaceButton?.props.onClick as (() => void) | undefined)?.();

    const dialog = renderControls({ presentation, onSetCredential });
    const input = visitElements(
      dialog,
      (element) => element.props["aria-label"] === "OpenRouter API key",
    );
    (
      input?.props.onChange as ((event: { currentTarget: { value: string } }) => void) | undefined
    )?.({
      currentTarget: { value: "sk-or-v1-secret" },
    });

    const entered = renderControls({ presentation, onSetCredential });
    const saveButton = visitElements(
      entered,
      (element) => element.props["aria-label"] === "Save API key for OpenRouter",
    );
    (saveButton?.props.onClick as (() => void) | undefined)?.();

    const saving = renderControls({ presentation, onSetCredential });
    const clearedInput = visitElements(
      saving,
      (element) => element.props["aria-label"] === "OpenRouter API key",
    );
    expect(clearedInput?.props.value).toBe("");
    expect(JSON.stringify(saving)).not.toContain("sk-or-v1-secret");
    expect(onSetCredential).toHaveBeenCalledWith("sk-or-v1-secret");

    resolveCredential?.();
    await flushPromises();
  });

  it("explains that environment-backed credentials cannot be disconnected here", () => {
    const tree = renderControls({
      presentation: {
        ...connectPresentation,
        action: "set-credential",
        actionLabel: "Replace API key",
        providerName: "OpenRouter",
        credential: { kind: "api-key", label: "API key" },
        environmentCredential: true,
      },
    });

    expect(
      visitElements(
        tree,
        (element) => element.props["data-provider-auth-environment-credential"] === true,
      ),
    ).not.toBeNull();
  });

  it("constrains authentication metadata instead of widening the provider card", () => {
    const tree = renderControls({
      presentation: {
        ...connectPresentation,
        account: "or-key-…cafe",
        plan: "Developer",
      },
    });

    expect(String(tree.props.className)).toContain("min-w-0");
    expect(String(tree.props.className)).toContain("max-w-full");
    const detail = visitElements(
      tree,
      (element) => element.props["data-provider-auth-detail"] === true,
    );
    expect(String(detail?.props.className)).toContain("break-words");
  });
});
