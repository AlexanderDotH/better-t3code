import { expect, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import { projectIndexWorkerSelection, resolveProjectIndexModel } from "./ProjectIndexModel.ts";
import { selectProjectIndexContextBudget } from "../semantic/ProjectIndexContextBudget.ts";

const selection = { instanceId: ProviderInstanceId.make("fixture"), model: "fixture-model" };
const provider: ServerProvider = {
  instanceId: selection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-20T12:00:00.000Z",
  fetchWorkers: { maxRecommendedWorkers: 1, commandExecutionPolicy: "deny" },
  models: [
    {
      slug: selection.model,
      name: "Fixture model",
      isCustom: true,
      capabilities: {
        contextWindow: { defaultTokens: 272_000, maxTokens: 1_050_000, effectivePercent: 95 },
      },
    },
  ],
  slashCommands: [],
  skills: [],
};

it("uses only supported windows and translates effective capacity to the exact runtime setting", () => {
  const resolved = resolveProjectIndexModel([provider], selection);
  expect(resolved.contextWindowTokens).toBe(950_000);
  expect(resolved.supportedContextWindows[0]).toBe(Math.floor(16_384 * 0.95));
  expect(projectIndexWorkerSelection(provider, selection, Math.floor(32_768 * 0.95))).toEqual({
    ...selection,
    options: [{ id: "contextWindow", value: "32768" }],
  });
  expect(projectIndexWorkerSelection(provider, selection, 272_000 * 0.95)).toEqual({
    ...selection,
    options: [{ id: "contextWindow", value: "default" }],
  });
  expect(() => projectIndexWorkerSelection(provider, selection, 1_000_000)).toThrow("capacity");
});

it("honors the selected context ceiling without changing provider or other model options", () => {
  const explicit = {
    ...selection,
    options: [
      { id: "contextWindow", value: "131072" },
      { id: "reasoningEffort", value: "high" },
    ],
  };
  const resolved = resolveProjectIndexModel([provider], explicit);
  expect(resolved.contextWindowTokens).toBe(Math.floor(131_072 * 0.95));
  expect(projectIndexWorkerSelection(provider, explicit, Math.floor(49_152 * 0.95))).toEqual({
    ...selection,
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "contextWindow", value: "49152" },
    ],
  });
  expect(
    resolveProjectIndexModel([provider], {
      ...selection,
      options: [{ id: "contextWindow", value: "default" }],
    }).contextWindowTokens,
  ).toBe(272_000 * 0.95);
});

it("rejects ignored or malformed context overrides instead of silently using the default", () => {
  for (const value of ["invalid", "-100", "1000", "1024000", "2000000"]) {
    expect(() =>
      resolveProjectIndexModel([provider], {
        ...selection,
        options: [{ id: "contextWindow", value }],
      }),
    ).toThrow();
  }
});

it("does not invent context controls for other provider adapters", () => {
  const other = { ...provider, driver: ProviderDriverKind.make("claudeAgent") };
  const resolved = resolveProjectIndexModel([other], selection);
  expect(resolved.supportedContextWindows).toEqual([272_000 * 0.95]);
  expect(projectIndexWorkerSelection(other, selection, 32_768)).toBe(selection);
  expect(() => projectIndexWorkerSelection(other, selection, 500_000)).toThrow("capacity");
});

it("keeps native instructions and output capacity outside the source budget", () => {
  const capabilities = resolveProjectIndexModel([provider], selection);
  const smallRequest = "x".repeat(8_508);
  const budget = selectProjectIndexContextBudget(smallRequest, capabilities);
  expect(budget.maximumPromptTokens).toBeGreaterThanOrEqual(smallRequest.length);
  expect(budget.contextWindowTokens).toBeGreaterThan(16_384);
  expect(
    budget.maximumPromptTokens + budget.maxOutputTokens + capabilities.promptOverheadTokens,
  ).toBeLessThan(budget.contextWindowTokens);
  expect(
    projectIndexWorkerSelection(provider, selection, budget.contextWindowTokens).instanceId,
  ).toBe(selection.instanceId);
});
