import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { WorkspaceContextTool, WorkspaceToolkit } from "./tools.ts";

it("publishes one bounded read-only workspace tool", () => {
  expect(Object.keys(WorkspaceToolkit.tools)).toEqual(["workspace_context"]);
  expect(WorkspaceContextTool.description?.toLowerCase()).toContain("batch");
  expect(Tool.getJsonSchema(WorkspaceContextTool)).toMatchObject({ type: "object" });
  expect(Context.get(WorkspaceContextTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(WorkspaceContextTool.annotations, Tool.Destructive)).toBe(false);
  expect(Context.get(WorkspaceContextTool.annotations, Tool.Idempotent)).toBe(true);
  expect(Context.get(WorkspaceContextTool.annotations, Tool.OpenWorld)).toBe(false);
});
