import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import {
  WorkspaceContextTool,
  WorkspaceEditTool,
  WorkspaceEditToolkit,
  WorkspaceToolkit,
} from "./tools.ts";

it("publishes one bounded read-only workspace tool", () => {
  expect(Object.keys(WorkspaceToolkit.tools)).toEqual(["workspace_context"]);
  expect(WorkspaceContextTool.description).toContain(
    "Searches or reads spanning multiple regular UTF-8 files MUST use batched `workspace_context` calls, using the fewest calls its limits allow; do not use shell text readers/searchers.",
  );
  expect(Tool.getJsonSchema(WorkspaceContextTool)).toMatchObject({ type: "object" });
  expect(Context.get(WorkspaceContextTool.annotations, Tool.Readonly)).toBe(true);
  expect(Context.get(WorkspaceContextTool.annotations, Tool.Destructive)).toBe(false);
  expect(Context.get(WorkspaceContextTool.annotations, Tool.Idempotent)).toBe(true);
  expect(Context.get(WorkspaceContextTool.annotations, Tool.OpenWorld)).toBe(false);
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
