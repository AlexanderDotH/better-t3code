import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { makeProviderSettingsSchema } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveProviderSettingsFields,
  nextProviderConfigWithFieldValue,
  readProviderConfigBoolean,
  readProviderConfigNumber,
  readProviderConfigString,
  readProviderConfigStringArray,
} from "./providerSettingsForm.ts";

const Settings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    routingMode: Schema.Literals(["openrouter-default", "provider-order", "sort"]).pipe(
      Schema.withDecodingDefault(Effect.succeed("openrouter-default" as const)),
      Schema.annotateKey({
        title: "Routing mode",
        providerSettingsForm: {
          control: "select",
          options: [
            { value: "openrouter-default", label: "OpenRouter default" },
            { value: "provider-order", label: "Provider order" },
            { value: "sort", label: "Sort" },
          ],
        },
      }),
    ),
    defaultModel: Schema.String.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Default model",
        providerSettingsForm: {
          control: "select",
          options: { source: "models" },
          placeholder: "Select a model",
        },
      }),
    ),
    providerOrder: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({
        providerSettingsForm: {
          control: "ordered-string-list",
          visibleWhen: { field: "routingMode", equals: "provider-order" },
        },
      }),
    ),
    preferredMinThroughput: Schema.optional(Schema.Number).pipe(
      Schema.annotateKey({
        providerSettingsForm: {
          control: "number",
          min: 0,
          max: 10_000,
          step: 0.1,
          visibleWhen: { field: "routingMode", equals: "sort" },
        },
      }),
    ),
    contextCompression: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { control: "switch" } }),
    ),
  },
  {
    order: [
      "defaultModel",
      "routingMode",
      "providerOrder",
      "preferredMinThroughput",
      "contextCompression",
    ],
  },
);

const definition = { settingsSchema: Settings };

describe("provider settings form derivation", () => {
  it("orders visible fields and resolves visibility from schema defaults", () => {
    expect(deriveProviderSettingsFields(definition).map((field) => field.key)).toEqual([
      "defaultModel",
      "routingMode",
      "contextCompression",
    ]);

    expect(
      deriveProviderSettingsFields(definition, {
        value: { routingMode: "provider-order" },
      }).map((field) => field.key),
    ).toEqual(["defaultModel", "routingMode", "providerOrder", "contextCompression"]);
  });

  it("maps static options and numeric constraints without UI dependencies", () => {
    const fields = deriveProviderSettingsFields(definition, {
      value: { routingMode: "sort" },
    });

    expect(fields.find((field) => field.key === "routingMode")).toMatchObject({
      control: "select",
      options: [
        { value: "openrouter-default", label: "OpenRouter default" },
        { value: "provider-order", label: "Provider order" },
        { value: "sort", label: "Sort" },
      ],
      disabled: false,
    });
    expect(fields.find((field) => field.key === "preferredMinThroughput")).toMatchObject({
      control: "number",
      min: 0,
      max: 10_000,
      step: 0.1,
    });
  });

  it("keeps a model-backed select disabled until its catalog loads", () => {
    expect(
      deriveProviderSettingsFields(definition).find((field) => field.key === "defaultModel"),
    ).toMatchObject({ options: [], disabled: true });

    expect(
      deriveProviderSettingsFields(definition, {
        value: { defaultModel: "openai/gpt-custom" },
        models: [
          { slug: "anthropic/claude-sonnet", name: "Claude Sonnet" },
          { slug: "anthropic/claude-sonnet", name: "Duplicate" },
          { slug: "openai/no-tools", name: "No tools", isSelectable: false },
        ],
      }).find((field) => field.key === "defaultModel"),
    ).toMatchObject({
      disabled: false,
      options: [
        { value: "openai/gpt-custom", label: "openai/gpt-custom" },
        { value: "anthropic/claude-sonnet", label: "Claude Sonnet" },
      ],
    });
  });
});

describe("provider settings form values", () => {
  it("reads only values matching the requested control type", () => {
    const config = {
      text: "value",
      enabled: true,
      price: 1.25,
      providers: ["Anthropic", "Google"],
    };

    expect(readProviderConfigString(config, "text")).toBe("value");
    expect(readProviderConfigBoolean(config, "enabled")).toBe(true);
    expect(readProviderConfigNumber(config, "price")).toBe(1.25);
    expect(readProviderConfigStringArray(config, "providers")).toEqual(["Anthropic", "Google"]);
    expect(readProviderConfigNumber({ price: "1.25" }, "price")).toBeUndefined();
  });

  it("normalizes ordered lists and preserves unknown fork-owned keys", () => {
    const providerOrder = deriveProviderSettingsFields(definition, {
      value: { routingMode: "provider-order" },
    }).find((field) => field.key === "providerOrder");

    expect(
      nextProviderConfigWithFieldValue({ forkOwned: 1 }, providerOrder!, [
        " Anthropic ",
        "",
        "Google",
        "Anthropic",
      ]),
    ).toEqual({ forkOwned: 1, providerOrder: ["Anthropic", "Google"] });
  });

  it("omits empty values while retaining persisted booleans and finite numbers", () => {
    const fields = deriveProviderSettingsFields(definition, {
      value: { routingMode: "sort" },
    });
    const compression = fields.find((field) => field.key === "contextCompression")!;
    const throughput = fields.find((field) => field.key === "preferredMinThroughput")!;

    expect(nextProviderConfigWithFieldValue({ forkOwned: 1 }, compression, false)).toEqual({
      forkOwned: 1,
    });
    expect(nextProviderConfigWithFieldValue({ forkOwned: 1 }, throughput, 12.5)).toEqual({
      forkOwned: 1,
      preferredMinThroughput: 12.5,
    });
    expect(nextProviderConfigWithFieldValue({ forkOwned: 1 }, throughput, undefined)).toEqual({
      forkOwned: 1,
    });
  });
});
