import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const setupFiles = ["../shared/src/testing/longTempDir.ts", "../shared/src/testing/providerEnv.ts"];
const rendererTests = [
  "src/visualizations/renderer/runtime.test.ts",
  "src/visualizations/visualization.acceptance.test.ts",
];
const assetTests = ["src/visualizations/visualization.assets.test.ts"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "client-runtime",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...rendererTests, ...assetTests],
          setupFiles,
        },
      },
      {
        test: {
          name: "client-runtime-renderers",
          environment: "jsdom",
          include: rendererTests,
          setupFiles,
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: "client-runtime-assets",
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
