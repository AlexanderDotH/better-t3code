import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PROJECT_MEMORY_CONTEXT_WINDOW_TOKENS,
  ProjectMemoryDeleteRequest,
  ProjectMemoryDocumentClearRequest,
  ProjectMemoryDocumentMutationResponse,
  ProjectMemoryDocumentReplaceRequest,
  ProjectMemoryDocumentViewResponse,
  ProjectMemoryImportRequest,
  ProjectMemoryReadRequest,
  ProjectMemorySaveRequest,
  ProjectMemorySettings,
  ProjectMemorySettingsReadRequest,
  ProjectMemorySettingsUpdateRequest,
  ProjectMemoryToolInput,
} from "./projectMemory.ts";

const decodeSettings = Schema.decodeUnknownSync(ProjectMemorySettings);
const decodeSettingsRead = Schema.decodeUnknownSync(ProjectMemorySettingsReadRequest);
const decodeSettingsUpdate = Schema.decodeUnknownSync(ProjectMemorySettingsUpdateRequest);
const decodeDocumentView = Schema.decodeUnknownSync(ProjectMemoryDocumentViewResponse);
const decodeDocumentReplace = Schema.decodeUnknownSync(ProjectMemoryDocumentReplaceRequest);
const decodeDocumentClear = Schema.decodeUnknownSync(ProjectMemoryDocumentClearRequest);
const decodeDocumentMutation = Schema.decodeUnknownSync(ProjectMemoryDocumentMutationResponse);
const decodeRead = Schema.decodeUnknownSync(ProjectMemoryReadRequest);
const decodeSave = Schema.decodeUnknownSync(ProjectMemorySaveRequest);
const decodeImport = Schema.decodeUnknownSync(ProjectMemoryImportRequest);
const decodeDelete = Schema.decodeUnknownSync(ProjectMemoryDeleteRequest);
const decodeToolInput = Schema.decodeUnknownSync(ProjectMemoryToolInput);

describe("project memory settings", () => {
  it("defaults to project-owned memory with agent writes enabled", () => {
    expect(decodeSettings({})).toEqual({
      memoryMode: "project",
      allowAgentWrites: true,
    });
  });

  it("accepts provider-owned and disabled memory modes", () => {
    expect(decodeSettings({ memoryMode: "provider", allowAgentWrites: false })).toEqual({
      memoryMode: "provider",
      allowAgentWrites: false,
    });
    expect(decodeSettings({ memoryMode: "off" }).memoryMode).toBe("off");
  });

  it("decodes durable per-project settings reads and full updates", () => {
    expect(decodeSettingsRead({ projectId: " project-a " })).toEqual({ projectId: "project-a" });
    expect(
      decodeSettingsUpdate({
        projectId: "project-a",
        memoryMode: "off",
        allowAgentWrites: false,
      }),
    ).toEqual({ projectId: "project-a", memoryMode: "off", allowAgentWrites: false });
  });

  it("defines server-bound document view and mutation contracts", () => {
    const view = {
      projectId: "project-a",
      settings: { memoryMode: "project", allowAgentWrites: false },
      status: "active",
      storage: "workspace",
      effectivePath: "/workspace/.t3/MEMORY.md",
      rawMarkdown: "# Project memory\n",
    };

    expect(decodeDocumentView(view)).toEqual(view);
    expect(
      decodeDocumentReplace({
        projectId: "project-a",
        markdown: "# Project memory\n",
      }),
    ).toEqual({ projectId: "project-a", markdown: "# Project memory\n" });
    expect(decodeDocumentClear({ projectId: "project-a" })).toEqual({ projectId: "project-a" });
    expect(decodeDocumentMutation({ applied: true, view })).toEqual({ applied: true, view });
  });
});

describe("project memory requests", () => {
  it("decodes read, save, import, and delete requests with stable metadata", () => {
    const read = decodeRead({
      projectId: " project-a ",
      query: "  src/ProjectMemoryStore rememberSymbol  ",
    });
    const save = decodeSave({
      projectId: "project-a",
      section: "verified-workflows",
      key: "build.node-24",
      content: "  Run the focused Node 24 build.  ",
      verified: true,
      sourceThreadId: "thread-a",
      checkpointRef: "refs/checkpoints/a",
    });
    const imported = decodeImport({
      projectId: "project-a",
    });
    const deleted = decodeDelete({
      projectId: "project-a",
      key: "build.node-24",
    });

    expect(read).toEqual({
      projectId: "project-a",
      query: "src/ProjectMemoryStore rememberSymbol",
      contextWindowTokens: DEFAULT_PROJECT_MEMORY_CONTEXT_WINDOW_TOKENS,
    });
    expect(save).toMatchObject({
      key: "build.node-24",
      content: "Run the focused Node 24 build.",
      verified: true,
      sourceThreadId: "thread-a",
      checkpointRef: "refs/checkpoints/a",
    });
    expect(imported).toEqual({ projectId: "project-a" });
    expect(deleted).toEqual({ projectId: "project-a", key: "build.node-24" });
  });

  it("rejects unstable keys and non-positive context windows", () => {
    const base = {
      projectId: "project-a",
      section: "active-decisions",
      content: "Keep the backend deterministic.",
      verified: true,
      sourceThreadId: "thread-a",
    };

    expect(() => decodeSave({ ...base, key: "contains spaces" })).toThrow();
    expect(() => decodeSave({ ...base, key: "../escape" })).toThrow();
    expect(() => decodeRead({ projectId: "project-a", contextWindowTokens: 0 })).toThrow();
  });
});

describe("project memory MCP input", () => {
  it("exposes one search/remember/forget action union without project paths", () => {
    const search = decodeToolInput({ action: "search", query: " ProjectMemoryStore " });
    const remember = decodeToolInput({
      action: "remember",
      section: "known-pitfalls",
      key: "git.shared-dirty-tree",
      content: "Preserve unrelated changes.",
      verified: true,
    });
    const forget = decodeToolInput({ action: "forget", key: "git.shared-dirty-tree" });

    expect(search).toMatchObject({ action: "search", query: "ProjectMemoryStore" });
    expect(remember).not.toHaveProperty("projectId");
    expect(remember).not.toHaveProperty("workspaceRoot");
    expect(forget).toEqual({ action: "forget", key: "git.shared-dirty-tree" });
  });
});
