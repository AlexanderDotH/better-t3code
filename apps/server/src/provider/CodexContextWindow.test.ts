import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  codexModelContextWindows,
  enrichCodexModelsWithContextWindow,
} from "./CodexContextWindow.ts";

const catalog = JSON.stringify({
  models: [
    {
      slug: "gpt-test",
      context_window: 272_000,
      max_context_window: 872_000,
      effective_context_window_percent: 95,
    },
    { slug: "invalid", context_window: 272_000, max_context_window: 16_384 },
    { slug: "incomplete", context_window: 272_000 },
  ],
});

it("ignores malformed native context metadata without discarding valid models", () => {
  assert.deepEqual(
    [...codexModelContextWindows(catalog)],
    [["gpt-test", { defaultTokens: 272_000, maxTokens: 872_000, effectivePercent: 95 }]],
  );
  assert.equal(codexModelContextWindows("invalid JSON").size, 0);
});

it.effect(
  "enriches discovered Codex models from the refreshed native catalog without losing their options",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const codexHome = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codex-context-" });
      const models = [
        {
          slug: "gpt-test",
          name: "GPT Test",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                type: "select" as const,
                label: "Reasoning",
                options: [{ id: "high", label: "High" }],
              },
            ],
          },
        },
      ];
      assert.deepEqual(yield* enrichCodexModelsWithContextWindow(models, codexHome), models);
      yield* fileSystem.writeFileString(path.join(codexHome, "models_cache.json"), catalog);
      const enriched = yield* enrichCodexModelsWithContextWindow(models, codexHome);
      assert.deepEqual(enriched[0]?.capabilities?.contextWindow, {
        defaultTokens: 272_000,
        maxTokens: 872_000,
        effectivePercent: 95,
      });
      const options = enriched[0]?.capabilities?.optionDescriptors;
      assert.deepEqual(options?.[0], models[0]?.capabilities.optionDescriptors[0]);
      const context = options?.find((option) => option.id === "contextWindow");
      assert.equal(context?.type, "select");
      if (context?.type === "select") {
        assert.equal(context.currentValue, "default");
        assert.isTrue(context.options.some((option) => option.id === "872000"));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
);
