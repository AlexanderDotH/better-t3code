import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

import {
  listGeneralSubagentModels,
  resolveGeneralSubagentSelection,
} from "./GeneralSubagentSelection.ts";

const now = "2026-08-22T12:00:00.000Z";

function model(input: {
  readonly slug: string;
  readonly name?: string;
  readonly isDefault?: boolean;
  readonly reasoningEfforts?: ReadonlyArray<string>;
  readonly isSelectable?: boolean;
}): ServerProviderModel {
  return {
    slug: input.slug,
    name: input.name ?? input.slug,
    isCustom: false,
    ...(input.isDefault ? { isDefault: true } : {}),
    ...(input.isSelectable === undefined ? {} : { isSelectable: input.isSelectable }),
    capabilities:
      input.reasoningEfforts === undefined
        ? null
        : {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning effort",
                type: "select",
                options: input.reasoningEfforts.map((effort) => ({
                  id: effort,
                  label: effort,
                  ...(effort === "medium" ? { isDefault: true } : {}),
                })),
                currentValue: "medium",
              },
            ],
          },
  };
}

function provider(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly status?: ServerProvider["status"];
  readonly enabled?: boolean;
  readonly installed?: boolean;
  readonly authStatus?: ServerProvider["auth"]["status"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    displayName: input.driver,
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: "1.0.0",
    status: input.status ?? "ready",
    auth: { status: input.authStatus ?? "authenticated" },
    checkedAt: now,
    models: [...input.models],
    slashCommands: [],
    skills: [],
  };
}

const codex = provider({
  instanceId: "codex-work",
  driver: "codex",
  models: [
    model({
      slug: "gpt-5.6-sol",
      isDefault: true,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    }),
    model({
      slug: "gpt-daybreak-blue-latest",
      name: "Daybreak Blue",
      reasoningEfforts: ["medium", "high", "xhigh", "max"],
    }),
  ],
});

const claude = provider({
  instanceId: "claude-review",
  driver: "claudeAgent",
  models: [model({ slug: "claude-opus-4-6", isDefault: true })],
});

describe("general subagent selection", () => {
  it("inherits the caller provider, exact model, and traits by default", () => {
    const resolution = resolveGeneralSubagentSelection({
      providers: [codex, claude],
      callerProviderInstanceId: codex.instanceId,
      parentModelSelection: {
        instanceId: codex.instanceId,
        model: "gpt-5.6-sol",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
        ],
      },
      request: {},
    });

    expect(resolution).toEqual({
      status: "resolved",
      provider: codex,
      selection: {
        instanceId: codex.instanceId,
        model: "gpt-5.6-sol",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
        ],
      },
    });
  });

  it("lets the caller select a task-specialized model and supported effort", () => {
    const resolution = resolveGeneralSubagentSelection({
      providers: [codex, claude],
      callerProviderInstanceId: codex.instanceId,
      parentModelSelection: {
        instanceId: codex.instanceId,
        model: "gpt-5.6-sol",
        options: [{ id: "reasoningEffort", value: "medium" }],
      },
      request: {
        model: "gpt-daybreak-blue-latest",
        reasoningEffort: "max",
      },
    });

    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.selection).toEqual({
      instanceId: codex.instanceId,
      model: "gpt-daybreak-blue-latest",
      options: [{ id: "reasoningEffort", value: "max" }],
    });
  });

  it("supports an explicit cross-provider selection without requiring native or Fetch workers", () => {
    const resolution = resolveGeneralSubagentSelection({
      providers: [codex, claude],
      callerProviderInstanceId: codex.instanceId,
      parentModelSelection: { instanceId: codex.instanceId, model: "gpt-5.6-sol" },
      request: {
        providerInstanceId: claude.instanceId,
        model: "claude-opus-4-6",
      },
    });

    expect(resolution).toEqual({
      status: "resolved",
      provider: claude,
      selection: {
        instanceId: claude.instanceId,
        model: "claude-opus-4-6",
      },
    });
  });

  it("rejects unavailable providers, unknown models, and unsupported efforts", () => {
    const unavailable = provider({
      instanceId: "cursor-disabled",
      driver: "cursor",
      models: [model({ slug: "cursor-default", isDefault: true })],
      enabled: false,
    });
    const base = {
      providers: [codex, claude, unavailable],
      callerProviderInstanceId: codex.instanceId,
      parentModelSelection: { instanceId: codex.instanceId, model: "gpt-5.6-sol" },
    } as const;

    expect(
      resolveGeneralSubagentSelection({
        ...base,
        request: { providerInstanceId: unavailable.instanceId },
      }),
    ).toMatchObject({ status: "unavailable", reason: "provider-unavailable" });
    expect(
      resolveGeneralSubagentSelection({ ...base, request: { model: "missing-model" } }),
    ).toMatchObject({ status: "unavailable", reason: "model-unavailable" });
    expect(
      resolveGeneralSubagentSelection({
        ...base,
        request: { model: "gpt-daybreak-blue-latest", reasoningEffort: "ultra" },
      }),
    ).toMatchObject({ status: "unavailable", reason: "reasoning-effort-unavailable" });
  });

  it("rejects and omits catalog models that the provider marks non-selectable", () => {
    const openRouter = provider({
      instanceId: "openrouter",
      driver: "openrouter",
      models: [
        model({ slug: "openai/gpt-agent", isDefault: true }),
        model({ slug: "openai/no-tools", isSelectable: false }),
      ],
    });
    const input = {
      providers: [openRouter],
      callerProviderInstanceId: openRouter.instanceId,
      parentModelSelection: {
        instanceId: openRouter.instanceId,
        model: "openai/gpt-agent",
      },
    } as const;

    expect(
      resolveGeneralSubagentSelection({
        ...input,
        request: { model: "openai/no-tools" },
      }),
    ).toMatchObject({ status: "unavailable", reason: "model-unavailable" });
    expect(listGeneralSubagentModels(input)[0]?.models.map((candidate) => candidate.slug)).toEqual([
      "openai/gpt-agent",
    ]);
  });

  it("blocks warning providers that do not expose a valid default model", () => {
    const missingDefault = provider({
      instanceId: "openrouter-missing-default",
      driver: "openrouter",
      status: "warning",
      models: [model({ slug: "openai/gpt-5.5" })],
    });

    expect(
      resolveGeneralSubagentSelection({
        providers: [missingDefault],
        callerProviderInstanceId: missingDefault.instanceId,
        parentModelSelection: {
          instanceId: missingDefault.instanceId,
          model: "openai/gpt-5.5",
        },
        request: {},
      }),
    ).toMatchObject({ status: "unavailable", reason: "provider-unavailable" });
  });

  it("lists only runnable providers and marks the inherited selection", () => {
    const unavailable = provider({
      instanceId: "opencode-missing",
      driver: "opencode",
      models: [model({ slug: "missing" })],
      installed: false,
    });

    expect(
      listGeneralSubagentModels({
        providers: [unavailable, claude, codex],
        callerProviderInstanceId: codex.instanceId,
        parentModelSelection: { instanceId: codex.instanceId, model: "gpt-5.6-sol" },
      }),
    ).toEqual([
      {
        instanceId: codex.instanceId,
        driver: codex.driver,
        displayName: "codex",
        current: true,
        models: [
          {
            slug: "gpt-5.6-sol",
            name: "gpt-5.6-sol",
            current: true,
            isDefault: true,
            reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
          },
          {
            slug: "gpt-daybreak-blue-latest",
            name: "Daybreak Blue",
            current: false,
            isDefault: false,
            reasoningEfforts: ["medium", "high", "xhigh", "max"],
          },
        ],
      },
      {
        instanceId: claude.instanceId,
        driver: claude.driver,
        displayName: "claudeAgent",
        current: false,
        models: [
          {
            slug: "claude-opus-4-6",
            name: "claude-opus-4-6",
            current: false,
            isDefault: true,
            reasoningEfforts: [],
          },
        ],
      },
    ]);
  });
});
