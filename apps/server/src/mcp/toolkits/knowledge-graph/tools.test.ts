import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { KnowledgeGraphQueryTool, KnowledgeGraphToolkit } from "./tools.ts";

it("exposes one bounded read-only Knowledge Graph query tool", () => {
  expect(Object.keys(KnowledgeGraphToolkit.tools)).toEqual(["knowledge_graph_query"]);
  const jsonSchema = Tool.getJsonSchema(KnowledgeGraphQueryTool);
  expect(jsonSchema).toMatchObject({
    type: "object",
    required: ["queries"],
    additionalProperties: false,
  });
  expect(Object.keys(jsonSchema.properties ?? {})).toEqual(["queries"]);
  expect(jsonSchema.properties).not.toHaveProperty("scope");
  expect(jsonSchema.properties).not.toHaveProperty("workspaceRoot");
  expect(jsonSchema.properties).not.toHaveProperty("target");
  expect(Context.get(KnowledgeGraphQueryTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(KnowledgeGraphQueryTool.annotations, Tool.Destructive)).toBe(false);
  expect(Context.get(KnowledgeGraphQueryTool.annotations, Tool.Idempotent)).toBe(true);
  expect(Context.get(KnowledgeGraphQueryTool.annotations, Tool.OpenWorld)).toBe(false);
});
