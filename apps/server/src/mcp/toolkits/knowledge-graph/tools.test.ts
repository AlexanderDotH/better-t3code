import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";

import { KnowledgeGraphQueryTool, KnowledgeGraphToolkit } from "./tools.ts";

const decodeQueryParameters = Schema.decodeUnknownSync(KnowledgeGraphQueryTool.parametersSchema);

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

it("advertises closed query operations and accepts the complete valid query batch", () => {
  const jsonSchema = Tool.getJsonSchema(KnowledgeGraphQueryTool);
  expect(jsonSchema).toMatchObject({
    properties: {
      queries: {
        maxItems: 8,
        items: {
          anyOf: expect.arrayContaining([expect.objectContaining({ additionalProperties: false })]),
        },
      },
    },
  });
  const input = {
    queries: [
      { id: "overview", type: "overview" },
      { id: "search", type: "search", text: "symbol", kinds: ["file"], limit: 5 },
      { id: "node", type: "node", nodeId: "node-1" },
      {
        id: "neighbors",
        type: "neighbors",
        nodeId: "node-1",
        direction: "both",
        depth: 2,
        limit: 5,
      },
      { id: "path", type: "path", sourceNodeId: "node-1", targetNodeId: "node-2", maxDepth: 8 },
    ],
  };
  expect(decodeQueryParameters(input)).toEqual(input);
});
