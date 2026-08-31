import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import {
  ProviderSubscriptionAuthControlsView,
  type ProviderSubscriptionAuthControlsViewProps,
} from "./ProviderSubscriptionAuthControls";
import type { ProviderSubscriptionPresentation } from "./ProviderSubscriptionAuth";

const translate = createInterfaceTranslator({
  language: "en",
  locale: "en-US",
}).message;

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
  ...connectPresentation,
  action: "disconnect",
  actionLabel: "Disconnect",
  canDisconnect: true,
  account: "alex@example.com",
  plan: "Pro",
};

const noOp = () => {};

function renderControls(
  props: Partial<ProviderSubscriptionAuthControlsViewProps> = {},
): ReactElement<Record<string, unknown>> {
  const presentation = props.presentation ?? connectPresentation;
  return ProviderSubscriptionAuthControlsView({
    presentation,
    readOnly: false,
    detail: [presentation.account, presentation.plan].filter(Boolean).join(" · ") || null,
    actionLabel: presentation.actionLabel,
    dialog: null,
    connectState: null,
    disconnecting: false,
    credentialSaving: false,
    translate,
    onPrimaryAction: noOp,
    onDisconnectRequest: noOp,
    onClose: noOp,
    onRetry: noOp,
    onCredentialChange: noOp,
    onSaveCredential: noOp,
    onConfirmDisconnect: noOp,
    ...props,
  }) as ReactElement<Record<string, unknown>>;
}

describe("ProviderSubscriptionAuthControlsView", () => {
  it("shows a static prominent connect button and preserves visible failures", () => {
    const onPrimaryAction = vi.fn();
    const initial = renderControls({ onPrimaryAction });
    const connectButton = visitElements(
      initial,
      (element) => element.props["aria-label"] === "Connect for ChatGPT Subscription",
    );
    expect(connectButton).not.toBeNull();
    expect(String(connectButton?.props.className)).not.toContain("animate");
    (connectButton?.props.onClick as (() => void) | undefined)?.();
    expect(onPrimaryAction).toHaveBeenCalledOnce();

    const failed = renderControls({
      dialog: { kind: "connect", state: { status: "starting" } },
      connectState: { status: "failed", message: "Device code expired." },
    });
    expect(
      visitElements(
        failed,
        (element) =>
          (element.props.state as { readonly status?: string } | undefined)?.status === "failed",
      ),
    ).not.toBeNull();
  });

  it("renders the device URL and user code emitted by a remote flow", () => {
    const challenge = renderControls({
      dialog: { kind: "connect", state: { status: "starting" } },
      connectState: {
        status: "device-code",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "ABCD-EFGH",
      },
    });
    const state = visitElements(
      challenge,
      (element) =>
        (element.props.state as { readonly status?: string } | undefined)?.status === "device-code",
    );
    expect(state?.props.providerName).toBe("ChatGPT Subscription");
  });

  it("requires confirmation before disconnecting only the selected instance", () => {
    const onDisconnectRequest = vi.fn();
    const initial = renderControls({
      presentation: disconnectPresentation,
      actionLabel: "Disconnect",
      onPrimaryAction: onDisconnectRequest,
    });
    const disconnectButton = visitElements(
      initial,
      (element) => element.props["aria-label"] === "Disconnect for ChatGPT Subscription",
    );
    (disconnectButton?.props.onClick as (() => void) | undefined)?.();
    expect(onDisconnectRequest).toHaveBeenCalledOnce();

    const onConfirmDisconnect = vi.fn();
    const confirmation = renderControls({
      presentation: disconnectPresentation,
      actionLabel: "Disconnect",
      dialog: { kind: "disconnect", state: "confirm" },
      onConfirmDisconnect,
    });
    const confirmButton = visitElements(
      confirmation,
      (element) => element.props["aria-label"] === "Confirm disconnect ChatGPT Subscription",
    );
    (confirmButton?.props.onClick as (() => void) | undefined)?.();
    expect(onConfirmDisconnect).toHaveBeenCalledOnce();
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

  it("lets authenticated OpenRouter replace or disconnect without retaining a submitted key", () => {
    const presentation: ProviderSubscriptionPresentation = {
      ...connectPresentation,
      action: "set-credential",
      actionLabel: "Replace API key",
      providerName: "OpenRouter",
      credential: { kind: "api-key", label: "API key", placeholder: "sk-or-v1-…" },
      canDisconnect: true,
    };
    const onCredentialChange = vi.fn();
    const entry = renderControls({
      presentation,
      actionLabel: "Replace API key",
      dialog: { kind: "credential", state: "entry", value: "" },
      onCredentialChange,
    });
    const input = visitElements(
      entry,
      (element) => element.props["aria-label"] === "OpenRouter API key",
    );
    (
      input?.props.onChange as ((event: { currentTarget: { value: string } }) => void) | undefined
    )?.({ currentTarget: { value: "sk-or-v1-secret" } });
    expect(onCredentialChange).toHaveBeenCalledWith("sk-or-v1-secret");

    const saving = renderControls({
      presentation,
      actionLabel: "Replace API key",
      dialog: { kind: "credential", state: "saving", value: "" },
      credentialSaving: true,
    });
    expect(JSON.stringify(saving)).not.toContain("sk-or-v1-secret");
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
      actionLabel: "Replace API key",
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
      presentation: { ...connectPresentation, account: "or-key-…cafe", plan: "Developer" },
      detail: "or-key-…cafe · Developer",
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
