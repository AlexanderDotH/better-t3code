import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { ThreadContextTool, ThreadContextToolkit } from "./tools.ts";

it("publishes one authenticated read-only thread context tool without caller scope fields", () => {
  expect(Object.keys(ThreadContextToolkit.tools)).toEqual(["thread_context"]);
  expect(ThreadContextTool.description).toContain("authenticated thread");
  expect(ThreadContextTool.description).toContain("exact");
  expect(ThreadContextTool.description).toContain("lexical");
  expect(Tool.getJsonSchema(ThreadContextTool)).toMatchObject({
    properties: {
      query: { type: "string" },
      ref: { type: "string" },
      cursor: { type: "string" },
    },
  });
  expect(Tool.getJsonSchema(ThreadContextTool)).not.toHaveProperty("properties.threadId");
  expect(Tool.getJsonSchema(ThreadContextTool)).not.toHaveProperty("properties.projectId");
  expect(Context.get(ThreadContextTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(ThreadContextTool.annotations, Tool.Destructive)).toBe(false);
  expect(Context.get(ThreadContextTool.annotations, Tool.Idempotent)).toBe(true);
  expect(Context.get(ThreadContextTool.annotations, Tool.OpenWorld)).toBe(false);
});
