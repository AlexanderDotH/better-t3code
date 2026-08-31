import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import {
  GeneralSubagentCancelTool,
  GeneralSubagentFollowUpTool,
  GeneralSubagentInterruptTool,
  GeneralSubagentListTool,
  GeneralSubagentModelsTool,
  GeneralSubagentSendMessageTool,
  GeneralSubagentSpawnAgentTool,
  GeneralSubagentSpawnTool,
  GeneralSubagentToolkit,
  GeneralSubagentWaitAgentTool,
  GeneralSubagentWaitTool,
} from "./tools.ts";

it("publishes a general-purpose asynchronous delegation toolkit", () => {
  expect(Object.keys(GeneralSubagentToolkit.tools)).toEqual([
    "subagent_models",
    "subagent_spawn",
    "subagent_wait",
    "subagent_cancel",
    "list_agents",
    "spawn_agent",
    "send_message",
    "followup_task",
    "wait_agent",
    "interrupt_agent",
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
  const listResult = Tool.getJsonSchemaFromSchema(GeneralSubagentListTool.successSchema);
  const waitResult = Tool.getJsonSchemaFromSchema(GeneralSubagentWaitTool.successSchema);
  expect(Object.keys(listResult.properties.agents.items.properties).sort()).toEqual(
    [
      "agentId",
      "model",
      "providerDriver",
      "providerInstanceId",
      "reasoningEffort",
      "status",
    ].sort(),
  );
  expect(waitResult).toHaveProperty("properties.agents.items.properties.result");
  expect(Context.get(GeneralSubagentModelsTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(GeneralSubagentSpawnTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(GeneralSubagentSpawnTool.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(GeneralSubagentWaitTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(GeneralSubagentCancelTool.annotations, Tool.Destructive)).toBe(true);
  expect(Context.get(GeneralSubagentListTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(GeneralSubagentSpawnAgentTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(GeneralSubagentSendMessageTool.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(GeneralSubagentFollowUpTool.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(GeneralSubagentWaitAgentTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(GeneralSubagentInterruptTool.annotations, Tool.Destructive)).toBe(true);
});
