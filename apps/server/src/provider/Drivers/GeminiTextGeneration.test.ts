import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";

import * as ServerConfig from "../../config.ts";
import { decodeGeminiSettings } from "./GeminiConfig.ts";
import { makeGeminiTextGeneration } from "./GeminiTextGeneration.ts";

const testLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-gemini-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("GeminiTextGeneration", (it) => {
  it.effect("rejects plan parallelism review as unsupported", () =>
    Effect.gen(function* () {
      const textGeneration = yield* makeGeminiTextGeneration(
        decodeGeminiSettings({ apiKey: "unused" }),
      );
      const error = yield* Effect.flip(
        textGeneration.reviewPlanParallelism({
          cwd: process.cwd(),
          planMarkdown: "## Plan",
          maxSubagents: 8,
          modelSelection: {
            instanceId: ProviderInstanceId.make("gemini"),
            model: "gemini-2.5-flash",
          },
        }),
      );

      expect(error.operation).toBe("reviewPlanParallelism");
      expect(error.detail).toContain("does not support plan parallelism review");
    }),
  );
});
