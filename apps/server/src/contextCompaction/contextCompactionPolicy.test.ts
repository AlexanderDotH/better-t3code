import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { resolveContextCompactionModel } from "./contextCompactionPolicy.ts";

const instanceId = ProviderInstanceId.make("codex");
const fallbackSelection = { instanceId, model: "test-sol" };
const model = (slug: string): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: null,
});
const provider = (models: ReadonlyArray<ServerProviderModel>): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  models,
  status: "ready",
  enabled: true,
  installed: true,
  auth: { status: "authenticated" },
  version: "test",
  checkedAt: "2026-10-17T00:00:00.000Z",
  skills: [],
  slashCommands: [],
});

describe("context compaction model selection", () => {
  it("prefers an available Luna model automatically and otherwise uses the configured text model", () => {
    const input = {
      selection: null,
      fallbackSelection,
      providers: [provider([model("test-sol"), model("test-luna")])],
    };
    expect(resolveContextCompactionModel(input)).toEqual({
      selection: { instanceId, model: "test-luna" },
      mode: "summary",
    });
    expect(
      resolveContextCompactionModel({ ...input, providers: [provider([model("test-sol")])] }),
    ).toEqual({ selection: fallbackSelection, mode: "summary" });
  });

  it("uses the exact explicit selection, removes Auto Reasoning, and never substitutes an unavailable model", () => {
    const selection = {
      instanceId,
      model: "test-sol",
      options: [
        { id: "t3AutoReasoning", value: true },
        { id: "reasoningEffort", value: "high" },
      ],
    };
    expect(
      resolveContextCompactionModel({
        selection,
        fallbackSelection,
        providers: [provider([model("test-sol"), model("test-luna")])],
      })?.selection,
    ).toEqual({
      ...selection,
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    expect(
      resolveContextCompactionModel({
        selection: { instanceId, model: "missing" },
        fallbackSelection,
        providers: [provider([model("test-luna")])],
      }),
    ).toBeUndefined();
  });

  it("pairs an optional native Decision Model with an automatic regular summarizer", () => {
    const decision: ServerProviderModel = {
      ...model("labs/system-one"),
      capabilities: {
        optionDescriptors: [],
        selectionSupport: { agent: false, textGeneration: false, decision: "native" },
      },
    };
    expect(
      resolveContextCompactionModel({
        selection: { instanceId, model: decision.slug },
        fallbackSelection,
        providers: [provider([decision, model("test-luna"), model("test-sol")])],
      }),
    ).toEqual({
      selection: { instanceId, model: decision.slug },
      mode: "selection",
      summarySelection: { instanceId, model: "test-luna" },
    });
    expect(
      resolveContextCompactionModel({
        selection: { instanceId, model: decision.slug },
        fallbackSelection,
        providers: [provider([decision, model("test-sol")])],
      }),
    ).toEqual({
      selection: { instanceId, model: decision.slug },
      mode: "selection",
      summarySelection: fallbackSelection,
    });
    expect(
      resolveContextCompactionModel({
        selection: { instanceId, model: decision.slug },
        fallbackSelection,
        providers: [provider([decision])],
      }),
    ).toBeUndefined();
  });

  it("skips disabled providers and hidden models", () => {
    expect(
      resolveContextCompactionModel({
        selection: null,
        fallbackSelection,
        providers: [{ ...provider([model("test-luna")]), enabled: false }],
      }),
    ).toBeUndefined();
    expect(
      resolveContextCompactionModel({
        selection: null,
        fallbackSelection,
        providers: [provider([{ ...model("test-luna"), isSelectable: false }])],
      }),
    ).toBeUndefined();
  });
});
