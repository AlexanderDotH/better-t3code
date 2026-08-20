import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelCapabilities,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { normalizeClientModelSelection, toStickyModelSelection } from "./modelOptions.ts";

const CODEX = ProviderDriverKind.make("codex");
const CURSOR = ProviderDriverKind.make("cursor");
const CODEX_INSTANCE = ProviderInstanceId.make("codex");
const CURSOR_INSTANCE = ProviderInstanceId.make("cursor");

const CODEX_FAST_CAPABILITIES: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      currentValue: "medium",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ],
      currentValue: "default",
    },
  ],
};

function codexSelection(options?: ModelSelection["options"]): ModelSelection {
  return {
    instanceId: CODEX_INSTANCE,
    model: "gpt-5.4",
    ...(options ? { options } : {}),
  };
}

describe("normalizeClientModelSelection", () => {
  it("stores Standard explicitly when a fast-capable Codex model has no saved tier", () => {
    expect(
      normalizeClientModelSelection({
        provider: CODEX,
        selection: codexSelection([{ id: "reasoningEffort", value: "high" }]),
        capabilities: CODEX_FAST_CAPABILITIES,
      }),
    ).toEqual(
      codexSelection([
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "default" },
      ]),
    );
  });

  it("upgrades legacy fastMode true to the catalog Fast tier", () => {
    expect(
      normalizeClientModelSelection({
        provider: CODEX,
        selection: codexSelection([
          { id: "reasoningEffort", value: "medium" },
          { id: "fastMode", value: true },
        ]),
        capabilities: CODEX_FAST_CAPABILITIES,
      }),
    ).toEqual(
      codexSelection([
        { id: "reasoningEffort", value: "medium" },
        { id: "serviceTier", value: "priority" },
      ]),
    );
  });

  it("upgrades the legacy fast service-tier alias to priority", () => {
    expect(
      normalizeClientModelSelection({
        provider: CODEX,
        selection: codexSelection([{ id: "serviceTier", value: "fast" }]),
        capabilities: CODEX_FAST_CAPABILITIES,
      }),
    ).toEqual(codexSelection([{ id: "serviceTier", value: "priority" }]));
  });

  it("falls back to Standard when the selected Codex model does not support Fast", () => {
    const standardOnlyCapabilities: ModelCapabilities = {
      optionDescriptors: [
        {
          id: "serviceTier",
          label: "Service Tier",
          type: "select",
          options: [{ id: "default", label: "Standard", isDefault: true }],
          currentValue: "default",
        },
      ],
    };

    expect(
      normalizeClientModelSelection({
        provider: CODEX,
        selection: codexSelection([{ id: "serviceTier", value: "priority" }]),
        capabilities: standardOnlyCapabilities,
      }),
    ).toEqual(codexSelection([{ id: "serviceTier", value: "default" }]));
  });

  it("drops saved speed options when the selected Codex model has no service-tier capability", () => {
    expect(
      normalizeClientModelSelection({
        provider: CODEX,
        selection: codexSelection([
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
          { id: "fastMode", value: true },
        ]),
        capabilities: { optionDescriptors: [] },
      }),
    ).toEqual(codexSelection([{ id: "reasoningEffort", value: "high" }]));
  });

  it("leaves non-Codex fastMode descriptors unchanged", () => {
    const selection: ModelSelection = {
      instanceId: CURSOR_INSTANCE,
      model: "cursor-model",
      options: [{ id: "fastMode", value: true }],
    };

    expect(
      normalizeClientModelSelection({
        provider: CURSOR,
        selection,
        capabilities: { optionDescriptors: [] },
      }),
    ).toEqual(selection);
  });
});

describe("toStickyModelSelection", () => {
  it("keeps reasoning sticky while speed and context remain scoped to the current Codex chat", () => {
    expect(
      toStickyModelSelection({
        provider: CODEX,
        selection: codexSelection([
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
          { id: "fastMode", value: true },
          { id: "contextWindow", value: "262144" },
        ]),
      }),
    ).toEqual(codexSelection([{ id: "reasoningEffort", value: "high" }]));
  });

  it("preserves fastMode for providers where it is a native provider trait", () => {
    const selection: ModelSelection = {
      instanceId: CURSOR_INSTANCE,
      model: "cursor-model",
      options: [{ id: "fastMode", value: true }],
    };

    expect(toStickyModelSelection({ provider: CURSOR, selection })).toEqual(selection);
  });
});
