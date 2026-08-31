import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import type { OpenAiCatalogModel } from "./OpenAiModelCatalog.ts";
import {
  checkOpenAiProviderStatus,
  makePendingOpenAiProvider,
  OPENAI_RESPONSES_PRESENTATION,
  openAiModelsFromLiveCatalog,
} from "./OpenAiProvider.ts";

const MODEL: OpenAiCatalogModel = {
  id: "gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  contextWindowTokens: 1_050_000,
  maxOutputTokens: 128_000,
  inputModalities: ["text", "image"],
  outputModalities: ["text"],
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  defaultReasoningEffort: "medium",
  toolCapabilities: { tools: true, parallelToolCalls: true, toolChoice: true },
  isVerified: true,
};

describe("OpenAI provider snapshot", () => {
  it("maps tested model capabilities and a single live default", () => {
    expect(openAiModelsFromLiveCatalog([MODEL])).toEqual([
      expect.objectContaining({
        slug: MODEL.id,
        name: MODEL.name,
        isDefault: true,
        isCustom: false,
        isVerified: true,
        capabilities: expect.objectContaining({
          contextWindow: { defaultTokens: 1_050_000, maxTokens: 1_050_000 },
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          toolSupport: { tools: true, parallelToolCalls: true, toolChoice: true },
          optionDescriptors: [
            expect.objectContaining({
              id: "reasoningEffort",
              currentValue: "medium",
              options: expect.arrayContaining([
                { id: "medium", label: "Medium", isDefault: true },
                { id: "max", label: "Max" },
              ]),
            }),
          ],
        }),
      }),
    ]);
  });

  it.effect("keeps disabled instances inert and unauthenticated instances actionable", () =>
    Effect.gen(function* () {
      let credentialReads = 0;
      const disabled = yield* checkOpenAiProviderStatus(
        { enabled: false },
        {
          resolveCredential: Effect.sync(() => {
            credentialReads += 1;
            return Option.none();
          }),
          listModels: Effect.die("disabled provider must not list models"),
        },
      );
      expect(disabled.enabled).toBe(false);
      expect(disabled.models).toEqual([]);
      expect(credentialReads).toBe(0);

      const unauthenticated = yield* checkOpenAiProviderStatus(
        { enabled: true },
        {
          resolveCredential: Effect.succeed(Option.none()),
          listModels: Effect.die("missing credential must not list models"),
        },
      );
      expect(unauthenticated).toMatchObject({
        status: "warning",
        auth: { status: "unauthenticated", type: "api-key" },
      });
    }),
  );

  it.effect("advertises native workflows only after authenticated live discovery", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOpenAiProviderStatus(
        { enabled: true },
        {
          resolveCredential: Effect.succeed(
            Option.some({ apiKey: Redacted.make("sk-proj-1234567890"), source: "stored" }),
          ),
          listModels: Effect.succeed([MODEL]),
        },
      );

      expect(OPENAI_RESPONSES_PRESENTATION).toEqual({
        displayName: "OpenAI Responses",
        badgeLabel: "Early Access",
        showInteractionModeToggle: true,
        nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 40 },
        fetchWorkers: { maxRecommendedWorkers: 8, commandExecutionPolicy: "deny" },
      });
      expect(snapshot).toMatchObject({
        status: "ready",
        auth: {
          status: "authenticated",
          label: "sk-p…7890",
          capabilities: { canDisconnect: true },
        },
      });
      expect(snapshot.models).toHaveLength(1);
      expect(JSON.stringify(snapshot)).not.toContain("1234567890");
      expect(snapshot.nativeSubagents).toEqual(OPENAI_RESPONSES_PRESENTATION.nativeSubagents);
    }),
  );

  it.effect("blocks readiness when no tested model remains live", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOpenAiProviderStatus(
        { enabled: true },
        {
          resolveCredential: Effect.succeed(
            Option.some({ apiKey: Redacted.make("sk-proj-1234567890"), source: "environment" }),
          ),
          listModels: Effect.succeed([]),
        },
      );

      expect(snapshot).toMatchObject({ status: "error" });
      expect(snapshot.models).toEqual([]);
      expect(snapshot.message).toContain("no tested coding models");
    }),
  );

  it.effect("builds a pending snapshot without network state", () =>
    Effect.gen(function* () {
      const snapshot = yield* makePendingOpenAiProvider({ enabled: true });
      expect(snapshot).toMatchObject({
        status: "warning",
        auth: { status: "unknown", type: "api-key" },
      });
      expect(snapshot.message).toContain("Checking OpenAI API access");
    }),
  );
});
