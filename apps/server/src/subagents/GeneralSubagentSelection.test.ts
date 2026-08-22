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
}): ServerProviderModel {
  return {
    slug: input.slug,
    name: input.name ?? input.slug,
    isCustom: false,
    ...(input.isDefault ? { isDefault: true } : {}),
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
