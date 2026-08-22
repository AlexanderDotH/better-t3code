import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import {
  GeneralSubagentCancelTool,
  GeneralSubagentModelsTool,
  GeneralSubagentSpawnTool,
  GeneralSubagentToolkit,
  GeneralSubagentWaitTool,
} from "./tools.ts";

it("publishes a general-purpose asynchronous delegation toolkit", () => {
  expect(Object.keys(GeneralSubagentToolkit.tools)).toEqual([
    "subagent_models",
    "subagent_spawn",
    "subagent_wait",
    "subagent_cancel",
  ]);
  expect(GeneralSubagentSpawnTool.description).toContain("general-purpose");
  expect(GeneralSubagentSpawnTool.description).toContain("same provider and model");
  expect(GeneralSubagentSpawnTool.description).toContain("task-appropriate");
  expect(GeneralSubagentModelsTool.description).toContain("reasoning");
  expect(Tool.getJsonSchema(GeneralSubagentSpawnTool)).toMatchObject({
    type: "object",
    properties: {
      task: { type: "string" },
      providerInstanceId: { type: "string" },
      model: { type: "string" },
      reasoningEffort: { type: "string" },
    },
    required: ["task"],
  });
  expect(Context.get(GeneralSubagentModelsTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(GeneralSubagentSpawnTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(GeneralSubagentSpawnTool.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(GeneralSubagentWaitTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(GeneralSubagentCancelTool.annotations, Tool.Destructive)).toBe(true);
});
