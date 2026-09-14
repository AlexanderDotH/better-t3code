import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { enableAutoReasoning } from "@t3tools/shared/model";
import { estimatePlanExecution } from "./planExecutionEstimate";

const model: ServerProviderModel = {
  slug: "test-model",
  name: "Test model",
  isCustom: false,
  capabilities: {
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
      {
        id: "serviceTier",
        label: "Speed",
        type: "select",
        options: [
          { id: "default", label: "Normal", isDefault: true },
          { id: "priority", label: "Fast" },
        ],
      },
    ],
  },
};
const input = {
  planMarkdown: "# Plan\n1. Implement\n2. Integrate\n3. Test\n4. Build",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: model.slug },
  models: [model],
  provider: ProviderDriverKind.make("codex"),
  ultrathink: false,
};

describe("plan execution estimate", () => {
  it("uses selected model defaults and responds to reasoning, speed and plan scope", () => {
    const baseline = estimatePlanExecution(input);
    expect(baseline).toMatchObject({
      model: "Test model",
      reasoning: "High",
      speed: "Normal",
      workUnits: 4,
    });
    const fast = estimatePlanExecution({
      ...input,
      modelSelection: {
        ...input.modelSelection,
        options: [
          { id: "reasoningEffort", value: "low" },
          { id: "serviceTier", value: "priority" },
        ],
      },
    });
    expect(fast).toMatchObject({ reasoning: "Low", speed: "Fast", fast: true });
    expect(fast.maxMinutes).toBeLessThan(baseline.maxMinutes);
    expect(
      estimatePlanExecution({ ...input, planMarkdown: "Implement the fix" }).maxMinutes,
    ).toBeLessThan(baseline.maxMinutes);
    const otherModel = { ...model, slug: "other-model", name: "Other model", capabilities: null };
    expect(
      estimatePlanExecution({
        ...input,
        models: [model, otherModel],
        modelSelection: { ...input.modelSelection, model: otherModel.slug },
      }),
    ).toMatchObject({ model: "Other model", reasoning: null, hasSpeedOption: false });
  });

  it("shows auto reasoning without claiming an unresolved effort", () => {
    const autoInput = { ...input, modelSelection: enableAutoReasoning(input.modelSelection) };
    expect(estimatePlanExecution(autoInput).reasoning).toBe("Auto");
    expect(estimatePlanExecution({ ...autoInput, autoReasoningEffort: "low" }).reasoning).toBe(
      "Auto · Low",
    );
  });

  it("keeps implicit fast mode off and handles missing model capabilities", () => {
    const fastModel: ServerProviderModel = {
      ...model,
      capabilities: {
        optionDescriptors: [{ id: "fastMode", label: "Fast", type: "boolean", currentValue: true }],
      },
    };
    expect(estimatePlanExecution({ ...input, models: [fastModel] }).fast).toBe(false);
    const unknown = estimatePlanExecution({ ...input, models: [], planMarkdown: "" });
    expect(unknown).toMatchObject({
      model: "test-model",
      reasoning: null,
      speed: null,
      hasSpeedOption: false,
    });
    expect(unknown.minMinutes).toBeGreaterThan(0);
    expect(unknown.maxMinutes).toBeGreaterThan(unknown.minMinutes);
  });
});
