import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  modelSelectionPurposeViolation,
  modelSupportsSelectionPurpose,
} from "./ModelSelectionPurposePolicy.ts";

const instanceId = ProviderInstanceId.make("openrouter");

function model(input: {
  readonly slug: string;
  readonly isSelectable?: boolean;
  readonly selectionSupport?: NonNullable<ServerProviderModel["capabilities"]>["selectionSupport"];
}): ServerProviderModel {
  return {
    slug: input.slug,
    name: input.slug,
    isCustom: false,
    ...(input.isSelectable === undefined ? {} : { isSelectable: input.isSelectable }),
    capabilities: input.selectionSupport ? { selectionSupport: input.selectionSupport } : null,
  };
}

function provider(models: ReadonlyArray<ServerProviderModel>): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make("openrouter"),
    status: "ready",
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    checkedAt: "2026-09-28T00:00:00.000Z",
    version: "1.0.0",
    models: [...models],
    slashCommands: [],
    skills: [],
  };
}

describe("ModelSelectionPurposePolicy", () => {
  it("keeps selectable legacy models valid for every purpose", () => {
    const legacy = model({ slug: "legacy" });

    expect(modelSupportsSelectionPurpose(legacy, "agent")).toBe(true);
    expect(modelSupportsSelectionPurpose(legacy, "text-generation")).toBe(true);
    expect(modelSupportsSelectionPurpose(legacy, "decision")).toBe(true);
  });

  it("keeps non-selectable legacy models out of every purpose", () => {
    const unavailableLegacy = model({ slug: "legacy-unavailable", isSelectable: false });

    expect(modelSupportsSelectionPurpose(unavailableLegacy, "agent")).toBe(false);
    expect(modelSupportsSelectionPurpose(unavailableLegacy, "text-generation")).toBe(false);
    expect(modelSupportsSelectionPurpose(unavailableLegacy, "decision")).toBe(false);
  });

  it("allows native decision models only for decisions", () => {
    const nativeDecision = model({
      slug: "labs/system-one",
      isSelectable: false,
      selectionSupport: { agent: false, textGeneration: false, decision: "native" },
    });

    expect(modelSupportsSelectionPurpose(nativeDecision, "agent")).toBe(false);
    expect(modelSupportsSelectionPurpose(nativeDecision, "text-generation")).toBe(false);
    expect(modelSupportsSelectionPurpose(nativeDecision, "decision")).toBe(true);
  });

  it("allows explicitly advertised text-only models for generation and prompted decisions", () => {
    const textOnly = model({
      slug: "text-only",
      isSelectable: false,
      selectionSupport: { agent: false, textGeneration: true, decision: "prompted" },
    });

    expect(modelSupportsSelectionPurpose(textOnly, "agent")).toBe(false);
    expect(modelSupportsSelectionPurpose(textOnly, "text-generation")).toBe(true);
    expect(modelSupportsSelectionPurpose(textOnly, "decision")).toBe(true);
  });

  it("reports known incompatible models while preserving unknown-model compatibility", () => {
    const providers = [
      provider([
        model({
          slug: "labs/system-one",
          selectionSupport: { agent: false, textGeneration: false, decision: "native" },
        }),
      ]),
    ];

    expect(
      modelSelectionPurposeViolation({
        providers,
        selection: { instanceId, model: "labs/system-one" },
        purpose: "text-generation",
      }),
    ).toContain("does not support");
    expect(
      modelSelectionPurposeViolation({
        providers,
        selection: { instanceId, model: "unlisted-custom-model" },
        purpose: "agent",
      }),
    ).toBeUndefined();
  });
});
