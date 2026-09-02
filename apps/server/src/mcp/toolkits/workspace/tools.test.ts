import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import {
  WorkspaceContextTool,
  WorkspaceEditTool,
  WorkspaceEditToolkit,
  WorkspaceFindTool,
  WorkspaceReadTool,
  WorkspaceToolkit,
} from "./tools.ts";

it("publishes focused and mixed bounded read-only workspace tools", () => {
  expect(Object.keys(WorkspaceToolkit.tools)).toEqual([
    "workspace_find",
    "workspace_read",
    "workspace_context",
  ]);
  expect(WorkspaceFindTool.description).toContain("Prefer this over shell find, rg, or grep");
  expect(WorkspaceReadTool.description).toContain("Prefer this over shell cat or sed");
  expect(WorkspaceContextTool.description).toContain("mixed workspace searches");

  for (const tool of [WorkspaceFindTool, WorkspaceReadTool, WorkspaceContextTool]) {
    expect(Tool.getJsonSchema(tool)).toMatchObject({ type: "object" });
    expect(Context.get(tool.annotations, Tool.Readonly)).toBe(true);
    expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false);
    expect(Context.get(tool.annotations, Tool.Idempotent)).toBe(true);
    expect(Context.get(tool.annotations, Tool.OpenWorld)).toBe(false);
  }
});

it("publishes workspace editing as one destructive closed-world batch tool", () => {
  expect(Object.keys(WorkspaceEditToolkit.tools)).toEqual(["workspace_edit"]);
  expect(WorkspaceEditTool.description?.toLowerCase()).toContain("batch");
  expect(Tool.getJsonSchema(WorkspaceEditTool)).toMatchObject({ type: "object" });
  expect(Context.get(WorkspaceEditTool.annotations, Tool.Readonly)).toBe(false);
  expect(Context.get(WorkspaceEditTool.annotations, Tool.Destructive)).toBe(true);
  expect(Context.get(WorkspaceEditTool.annotations, Tool.Idempotent)).toBe(false);
  expect(Context.get(WorkspaceEditTool.annotations, Tool.OpenWorld)).toBe(false);
});
