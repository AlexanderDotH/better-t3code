import { describe, expect, it } from "vite-plus/test";

import { resolveComposerSendWorkflow } from "./composerSendWorkflow.ts";

const enabled = {
  prompt: "Find the flaky test",
  composerMode: "default",
  supportsAgentWorkflow: true,
  experimentalFetch: true,
  improvePromptBeforeSend: true,
} as const;

describe("resolveComposerSendWorkflow", () => {
  it("applies Fetch and prompt improvement to agent turns the device opted into", () => {
    expect(resolveComposerSendWorkflow(enabled)).toEqual({
      fetchMode: "repository-exploration",
      improvePromptBeforeSend: true,
    });
    expect(resolveComposerSendWorkflow({ ...enabled, composerMode: "deep-plan" })).toEqual({
      fetchMode: "repository-exploration",
      improvePromptBeforeSend: true,
    });
  });

  it.each([
    ["Chat mode", { composerMode: "chat" }],
    ["a server without the agent workflow", { supportsAgentWorkflow: false }],
    ["a Codex feedback command", { prompt: "/feedback bug The diff is empty" }],
    ["a slash command", { prompt: "  /compact" }],
  ] as const)("skips both for %s", (_label, override) => {
    expect(resolveComposerSendWorkflow({ ...enabled, ...override })).toEqual({});
  });

  it("keeps each device setting independent and never improves an empty prompt", () => {
    expect(resolveComposerSendWorkflow({ ...enabled, experimentalFetch: false })).toEqual({
      improvePromptBeforeSend: true,
    });
    expect(resolveComposerSendWorkflow({ ...enabled, improvePromptBeforeSend: false })).toEqual({
      fetchMode: "repository-exploration",
    });
    expect(resolveComposerSendWorkflow({ ...enabled, prompt: "   " })).toEqual({
      fetchMode: "repository-exploration",
    });
  });
});
