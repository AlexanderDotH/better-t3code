import * as NodeAssert from "node:assert/strict";
import { describe, it } from "vite-plus/test";

import { codexAppServerArgs, codexExecArgs, codexManagedFeatureArgs } from "./CodexProcessArgs.ts";

describe("CodexProcessArgs", () => {
  it("disables hosted image generation for managed Codex processes", () => {
    NodeAssert.deepStrictEqual(codexManagedFeatureArgs(), ["--disable", "image_generation"]);
  });

  it("adds managed feature disables after the app-server subcommand", () => {
    NodeAssert.deepStrictEqual(codexAppServerArgs(), [
      "app-server",
      "--disable",
      "image_generation",
    ]);
  });

  it("adds managed feature disables before exec-specific options", () => {
    NodeAssert.deepStrictEqual(codexExecArgs(["--ephemeral", "-"]), [
      "exec",
      "--disable",
      "image_generation",
      "--ephemeral",
      "-",
    ]);
  });
});
