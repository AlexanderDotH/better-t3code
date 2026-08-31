import type { ReactElement } from "react";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const atoms = vi.hoisted(() => ({
  connect: Symbol("connect"),
  setCredential: Symbol("set-credential"),
  disconnect: Symbol("disconnect"),
  refresh: Symbol("refresh"),
  event: Symbol("event"),
  eventValue: null as unknown,
}));

const commands = vi.hoisted(() => ({
  connect: vi.fn(),
  setCredential: vi.fn(),
  disconnect: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { ...actual, useCallback: reactHookHarness.useCallback };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => atoms.eventValue,
}));

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    connectProviderAuth: atoms.connect,
    setProviderAuthCredential: atoms.setCredential,
    disconnectProviderAuth: atoms.disconnect,
    refreshProviders: atoms.refresh,
    providerAuthConnectEventAtom: () => atoms.event,
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) => {
    if (atom === atoms.connect) return commands.connect;
    if (atom === atoms.setCredential) return commands.setCredential;
    if (atom === atoms.disconnect) return commands.disconnect;
    return commands.refresh;
  },
}));

import { ProviderSubscriptionAuthBridge } from "./ProviderSubscriptionAuthBridge";

const environmentId = EnvironmentId.make("remote-device");
const instanceId = ProviderInstanceId.make("chatgpt_work");

function renderBridge(): ReactElement<Record<string, unknown>> {
  hooks.beginRender();
  return ProviderSubscriptionAuthBridge({
    environmentId,
    instanceId,
    flow: "device-code",
    readOnly: false,
    presentation: {
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
    },
  }) as ReactElement<Record<string, unknown>>;
}

describe("ProviderSubscriptionAuthBridge", () => {
  beforeEach(() => {
    hooks.reset();
    atoms.eventValue = null;
    commands.connect.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.setCredential.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.disconnect.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.refresh.mockReset().mockResolvedValue({ _tag: "Success" });
  });

  it("routes the device-code stream command to the selected environment and instance", async () => {
    const controls = renderBridge();
    await (controls.props.onConnect as (flow: "device-code") => Promise<void>)("device-code");
    expect(commands.connect).toHaveBeenCalledWith({
      environmentId,
      input: { instanceId, flow: "device-code" },
    });
  });

  it("disconnects only the selected instance and refreshes its environment", async () => {
    const controls = renderBridge();
    await (controls.props.onDisconnect as () => Promise<void>)();
    expect(commands.disconnect).toHaveBeenCalledWith({
      environmentId,
      input: { instanceId },
    });
    expect(commands.refresh).toHaveBeenCalledWith({ environmentId, input: {} });
  });

  it("sets a credential only on the selected environment and instance", async () => {
    const controls = renderBridge();
    await (controls.props.onSetCredential as (credential: string) => Promise<void>)(
      "sk-or-v1-secret",
    );
    expect(commands.setCredential).toHaveBeenCalledWith({
      environmentId,
      input: { instanceId, credential: "sk-or-v1-secret" },
    });
    expect(commands.refresh).toHaveBeenCalledWith({ environmentId, input: {} });
  });

  it("passes the latest typed stream event through to the dialog controls", () => {
    atoms.eventValue = {
      type: "failed",
      failure: { code: "broker-failed", reason: "Broker stopped.", retryable: true },
    };
    const controls = renderBridge();
    expect(controls.props.event).toEqual(atoms.eventValue);
  });
});
