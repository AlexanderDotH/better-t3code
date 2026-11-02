import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const setupFiles = ["../shared/src/testing/longTempDir.ts", "../shared/src/testing/providerEnv.ts"];
const rendererTests = [
  "src/visualizations/renderer/runtime.test.ts",
  "src/visualizations/visualization.acceptance.test.ts",
];
const assetTests = ["src/visualizations/visualization.assets.test.ts"];
// pnpm can resolve Effect's wrapper through another Vite+ peer instance.
// Evaluate it in each active runner so its suite context is initialized there.
const testServer = { deps: { inline: ["@effect/vitest"] } };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "client-runtime",
          server: testServer,
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...rendererTests, ...assetTests],
          setupFiles,
        },
      },
      {
        test: {
          name: "client-runtime-renderers",
          server: testServer,
          environment: "jsdom",
          include: rendererTests,
          setupFiles,
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: "client-runtime-assets",
          server: testServer,
          environment: "node",
          include: assetTests,
          setupFiles,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
