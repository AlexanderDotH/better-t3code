import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  FETCH_MODE,
  isFetchCapableProvider,
  resolveFetchLunaFallback,
  resolveFetchMode,
  resolveFetchModelSelection,
} from "./fetchMode.ts";

const model = (
  slug: string,
  input: {
    readonly isCustom?: boolean;
    readonly isDefault?: boolean;
    readonly isSelectable?: boolean;
  } = {},
): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: input.isCustom ?? false,
  ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
  ...(input.isSelectable === undefined ? {} : { isSelectable: input.isSelectable }),
  capabilities: null,
});

function provider(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly enabled?: boolean;
  readonly installed?: boolean;
  readonly availability?: ServerProvider["availability"];
  readonly fetchCapable?: boolean;
  readonly commandExecutionPolicy?: NonNullable<
    ServerProvider["fetchWorkers"]
  >["commandExecutionPolicy"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...(input.availability ? { availability: input.availability } : {}),
    ...(input.fetchCapable === false
      ? {}
      : {
          fetchWorkers: {
            maxRecommendedWorkers: 8,
            commandExecutionPolicy: input.commandExecutionPolicy ?? "deny",
          },
        }),
    models: [...input.models],
    slashCommands: [],
    skills: [],
  };
}

const selection = (
  instanceId: string,
  selectedModel: string,
  options?: ModelSelection["options"],
): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model: selectedModel,
  ...(options ? { options } : {}),
});

describe("Fetch request mode", () => {
  it("arms Fetch from the device toggle independently of the main provider", () => {
    expect(resolveFetchMode({ featureEnabled: false })).toBeUndefined();
    expect(resolveFetchMode({ featureEnabled: true })).toBe(FETCH_MODE);
  });
});

describe("Fetch provider eligibility", () => {
  it("requires providers to deny command execution", () => {
    const input = {
      instanceId: "codex",
      driver: "codex",
      models: [model("gpt-5.6-luna")],
    } as const;

    expect(isFetchCapableProvider(provider(input))).toBe(true);
    expect(
      isFetchCapableProvider(provider({ ...input, commandExecutionPolicy: "read-only-sandbox" })),
    ).toBe(false);
  });
});

describe("Fetch model selection", () => {
  it("prefers a live non-custom Spark from the default Codex instance", () => {
    const result = resolveFetchModelSelection({
      providers: [
        provider({
          instanceId: "codex_secondary",
          driver: "codex",
          models: [model("gpt-5.3-codex-spark")],
        }),
        provider({
          instanceId: "codex",
          driver: "codex",
          models: [model("gpt-5.6-luna"), model("gpt-5.3-codex-spark")],
        }),
      ],
      fetchModelSelection: null,
      textGenerationModelSelection: selection("codex_secondary", "gpt-5.6-luna"),
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.source).toBe("auto-spark");
    expect(result.selection).toEqual(selection("codex", "gpt-5.3-codex-spark"));
  });

  it("does not treat a custom Spark slug as account eligibility", () => {
    const result = resolveFetchModelSelection({
      providers: [
        provider({
          instanceId: "codex",
          driver: "codex",
          models: [model("gpt-5.3-codex-spark", { isCustom: true }), model("gpt-5.6-luna")],
        }),
      ],
      fetchModelSelection: null,
      textGenerationModelSelection: selection("codex", "gpt-5.3-codex-spark"),
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.source).toBe("auto-luna");
    expect(result.selection).toEqual(
      selection("codex", "gpt-5.6-luna", [{ id: "reasoningEffort", value: "low" }]),
    );
  });

  it("selects Luna with low reasoning when Spark is missing", () => {
    const result = resolveFetchModelSelection({
      providers: [
        provider({ instanceId: "codex", driver: "codex", models: [model("gpt-5.6-luna")] }),
      ],
      fetchModelSelection: null,
      textGenerationModelSelection: selection("codex", "gpt-5.6-luna"),
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.selection).toEqual(
      selection("codex", "gpt-5.6-luna", [{ id: "reasoningEffort", value: "low" }]),
    );
  });

  it("falls back to the exact text-generation selection when Codex is missing", () => {
    const configured = selection("claude_work", "claude-opus", [
      { id: "reasoningEffort", value: "high" },
    ]);
    const result = resolveFetchModelSelection({
      providers: [
        provider({
          instanceId: "claude_work",
          driver: "claudeAgent",
          models: [model("claude-opus")],
        }),
      ],
      fetchModelSelection: null,
      textGenerationModelSelection: configured,
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.source).toBe("auto-text-generation");
    expect(result.selection).toEqual(configured);
  });

  it("uses the first Fetch-capable provider default deterministically", () => {
    const result = resolveFetchModelSelection({
      providers: [
        provider({
          instanceId: "cursor",
          driver: "cursor",
          models: [model("cursor-fast"), model("cursor-default", { isDefault: true })],
        }),
        provider({ instanceId: "grok", driver: "grok", models: [model("grok-default")] }),
      ],
      fetchModelSelection: null,
      textGenerationModelSelection: selection("missing", "missing-model"),
    });

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.source).toBe("auto-provider-default");
    expect(result.selection).toEqual(selection("cursor", "cursor-default"));
  });

  it.each([
    ["claude_work", "claudeAgent", "claude-opus"],
    ["cursor_secondary", "cursor", "cursor-fast"],
    ["grok_secondary", "grok", "grok-4"],
    ["opencode_secondary", "opencode", "open-model"],
  ])("retains exact explicit %s model traits", (instanceId, driver, selectedModel) => {
    const configured = selection(instanceId, selectedModel, [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ]);
    const selectedProvider = provider({
      instanceId,
      driver,
      models: [model(selectedModel)],
    });

    const result = resolveFetchModelSelection({
      providers: [selectedProvider],
      fetchModelSelection: configured,
      textGenerationModelSelection: selection(instanceId, selectedModel),
    });

    expect(result).toEqual({
      status: "resolved",
      source: "manual",
      selection: configured,
      provider: selectedProvider,
    });
  });

  it("reports an unavailable manual provider without substituting another model", () => {
    const requested = selection("claude_work", "claude-opus", [
      { id: "reasoningEffort", value: "high" },
    ]);
    const result = resolveFetchModelSelection({
      providers: [
        provider({
          instanceId: "claude_work",
          driver: "claudeAgent",
          models: [model("claude-opus")],
          enabled: false,
        }),
        provider({ instanceId: "codex", driver: "codex", models: [model("gpt-5.6-luna")] }),
      ],
      fetchModelSelection: requested,
      textGenerationModelSelection: selection("codex", "gpt-5.6-luna"),
    });

    expect(result).toEqual({
      status: "unavailable",
      source: "manual",
      requestedSelection: requested,
      reason: "provider-unavailable",
    });
  });

  it("reports a missing manual model without changing its traits", () => {
    const requested = selection("claude_work", "missing", [
      { id: "reasoningEffort", value: "high" },
    ]);
    const result = resolveFetchModelSelection({
      providers: [
        provider({
          instanceId: "claude_work",
          driver: "claudeAgent",
          models: [model("claude-opus")],
        }),
      ],
      fetchModelSelection: requested,
      textGenerationModelSelection: selection("claude_work", "claude-opus"),
    });

    expect(result).toEqual({
      status: "unavailable",
      source: "manual",
      requestedSelection: requested,
      reason: "model-unavailable",
    });
  });

  it("rejects a manual model that the provider marks non-selectable", () => {
    const requested = selection("openrouter", "openai/no-tools");
    const result = resolveFetchModelSelection({
      providers: [
        provider({
          instanceId: "openrouter",
          driver: "openrouter",
          models: [
            model("openai/no-tools", { isSelectable: false }),
            model("openai/gpt-agent", { isDefault: true }),
          ],
        }),
      ],
      fetchModelSelection: requested,
      textGenerationModelSelection: selection("openrouter", "openai/gpt-agent"),
    });

    expect(result).toEqual({
      status: "unavailable",
      source: "manual",
      requestedSelection: requested,
      reason: "model-unavailable",
    });
  });

  it("excludes providers that do not advertise Fetch workers", () => {
    expect(
      isFetchCapableProvider(
        provider({
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          models: [model("claude-opus")],
          fetchCapable: false,
        }),
      ),
    ).toBe(false);
  });

  it("resolves the one allowed post-entitlement fallback strictly to Luna-low", () => {
    const result = resolveFetchLunaFallback([
      provider({ instanceId: "cursor", driver: "cursor", models: [model("cursor-default")] }),
      provider({ instanceId: "codex", driver: "codex", models: [model("gpt-5.6-luna")] }),
    ]);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.source).toBe("auto-luna");
    expect(result.selection).toEqual(
      selection("codex", "gpt-5.6-luna", [{ id: "reasoningEffort", value: "low" }]),
    );
  });
});
