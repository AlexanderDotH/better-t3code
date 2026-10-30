import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ExecutionEnvironmentCapabilities,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  getNextComposerMode,
  getProviderInteractionMode,
  resolveComposerMode,
  resolveDeepPlanningAvailability,
} from "./deepPlanning.ts";

const capabilities = {
  repositoryIdentity: false,
  midChatProviderSwitching: false,
  deepPlanning: { version: 1, sourceExport: true, sourceImport: true },
} satisfies ExecutionEnvironmentCapabilities;

const provider = {
  instanceId: ProviderInstanceId.make("acceptance-provider"),
  driver: ProviderDriverKind.make("custom-driver"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-16T08:00:00.000Z",
  deepPlanning: { version: 1, structuredPlans: true, durableExecution: true },
  models: [],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;

describe("Deep Planning client acceptance", () => {
  it("keeps Chat and Build available when planning is disabled", () => {
    expect(getNextComposerMode("default", { planningSupported: false })).toBe("chat");
    expect(getNextComposerMode("chat", { planningSupported: false })).toBe("default");
  });
  it("preserves the saved deep mode while the provider receives ordinary plan mode", () => {
    const selected = getNextComposerMode(getNextComposerMode("default"));
    expect(selected).toBe("deep-plan");

    const providerMode = getProviderInteractionMode(selected);
    expect(providerMode).toBe("plan");
    expect(resolveComposerMode(selected, providerMode)).toBe("deep-plan");
    expect(getNextComposerMode(selected)).toBe("chat");
    expect(getProviderInteractionMode("chat")).toBe("chat");
    expect(resolveComposerMode("chat", "chat")).toBe("chat");
    expect(getNextComposerMode("chat")).toBe("default");
  });

  it("keeps the saved deep mode through disconnection and capability recovery", () => {
    const savedMode = "deep-plan";
    expect(
      resolveDeepPlanningAvailability({ capabilities, provider, connected: false }).supported,
    ).toBe(false);
    expect(resolveComposerMode(savedMode, "plan")).toBe(savedMode);

    expect(resolveDeepPlanningAvailability({ capabilities, provider })).toEqual({
      supported: true,
      reason: null,
    });
    expect(resolveComposerMode(savedMode, "plan")).toBe(savedMode);
  });

  it("keeps Build, Plan and Chat available without Deep Planning support", () => {
    const planMode = getNextComposerMode("default", { deepPlanningSupported: false });
    expect(planMode).toBe("plan");
    expect(getProviderInteractionMode(planMode)).toBe("plan");
    expect(getNextComposerMode(planMode, { deepPlanningSupported: false })).toBe("chat");
    expect(resolveComposerMode(undefined, "plan")).toBe("plan");
    expect(resolveComposerMode(undefined, "default")).toBe("default");
    expect(resolveComposerMode(undefined)).toBe("default");
  });

  it.each([
    {
      name: "an older server",
      input: {
        capabilities: { repositoryIdentity: false, midChatProviderSwitching: false },
        provider,
      },
    },
    { name: "a missing server snapshot", input: { capabilities: null, provider } },
    {
      name: "a server without source import",
      input: {
        capabilities: {
          ...capabilities,
          deepPlanning: { ...capabilities.deepPlanning, sourceImport: false },
        },
        provider,
      },
    },
    {
      name: "a server without source export",
      input: {
        capabilities: {
          ...capabilities,
          deepPlanning: { ...capabilities.deepPlanning, sourceExport: false },
        },
        provider,
      },
    },
    { name: "a missing provider", input: { capabilities, provider: null } },
    {
      name: "a disabled provider",
      input: { capabilities, provider: { ...provider, enabled: false } },
    },
    {
      name: "an uninstalled provider",
      input: { capabilities, provider: { ...provider, installed: false } },
    },
    {
      name: "an unavailable provider",
      input: { capabilities, provider: { ...provider, availability: "unavailable" } },
    },
    {
      name: "a provider without structured plans",
      input: {
        capabilities,
        provider: {
          ...provider,
          deepPlanning: { ...provider.deepPlanning, structuredPlans: false },
        },
      },
    },
    {
      name: "a provider without durable execution",
      input: {
        capabilities,
        provider: {
          ...provider,
          deepPlanning: { ...provider.deepPlanning, durableExecution: false },
        },
      },
    },
  ] satisfies ReadonlyArray<{
    readonly name: string;
    readonly input: Parameters<typeof resolveDeepPlanningAvailability>[0];
  }>)("blocks new Deep Plans on $name with a reason", ({ input }) => {
    const availability = resolveDeepPlanningAvailability(input);
    expect(availability.supported).toBe(false);
    expect(availability.reason).toEqual(expect.any(String));
    expect(availability.reason?.trim().length).toBeGreaterThan(0);
  });

  it("requires advertised provider support even when the driver is known", () => {
    const { deepPlanning: _unsupported, ...legacyProvider } = provider;
    expect(
      resolveDeepPlanningAvailability({
        capabilities,
        provider: { ...legacyProvider, driver: ProviderDriverKind.make("codex") },
      }).supported,
    ).toBe(false);
    expect(resolveDeepPlanningAvailability({ capabilities, provider }).supported).toBe(true);
  });
});
