import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { ProjectMemoryTool, ProjectMemoryToolkit } from "./tools.ts";

it("publishes one server-scoped project memory tool", () => {
  expect(Object.keys(ProjectMemoryToolkit.tools)).toEqual(["project_memory"]);
  const schema = Tool.getJsonSchema(ProjectMemoryTool);
  const serialized = JSON.stringify(schema);
  expect(schema).toHaveProperty("anyOf");
  expect(serialized).toContain("search");
  expect(serialized).toContain("remember");
  expect(serialized).toContain("forget");
  expect(serialized).not.toContain("projectId");
  expect(serialized).not.toContain("workspaceRoot");
  expect(serialized).not.toContain("filePath");
  expect(Context.get(ProjectMemoryTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(ProjectMemoryTool.annotations, Tool.Destructive)).toBe(true);
  expect(Context.get(ProjectMemoryTool.annotations, Tool.Idempotent)).toBe(true);
  expect(Context.get(ProjectMemoryTool.annotations, Tool.OpenWorld)).toBe(false);
});
