import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ComposerMode,
  type VoiceFileReference,
} from "@t3tools/contracts";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { appendVoiceFileContext, extractVoiceFileContext } from "@t3tools/shared/voiceFileContext";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  prepareComposerSend,
  preparedComposerTurnRequest,
  type ComposerSendPreparationInput,
} from "./composerSendPreparation";

const environmentId = EnvironmentId.make("remote");
const threadId = ThreadId.make("thread");
const projectId = ProjectId.make("project");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "model" };

function setup(overrides: Partial<ComposerSendPreparationInput> = {}) {
  const improve = vi.fn(async (text: string) => `Improved: ${text}`);
  const input: ComposerSendPreparationInput = {
    prompt: "fix the bug",
    composerMode: "default",
    preferences: { improvePromptBeforeSend: true, experimentalFetch: true },
    supportsAgentWorkflow: true,
    voiceFileReferences: [],
    improve,
    format: appendVoiceFileContext,
    isCurrent: () => true,
    ...overrides,
  };
  const request = {
    environmentId,
    input: {
      threadId,
      message: {
        messageId: MessageId.make("message"),
        role: "user" as const,
        text: input.prompt,
        attachments: [],
      },
      modelSelection,
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      dispatchMode: "queue" as const,
      bootstrap: {
        createThread: {
          projectId,
          title: "Title",
          modelSelection,
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          branch: "main",
          worktreePath: null,
          createdAt: "2026-11-02T12:00:00.000Z",
        },
      },
    },
  };
  const commands: Array<ReturnType<typeof preparedComposerTurnRequest>> = [];
  const send = async () => {
    const prepared = await prepareComposerSend(input);
    if (prepared !== null) commands.push(preparedComposerTurnRequest(request, prepared));
  };
  return { commands, improve, input, request, send };
}

describe("prepared composer provider commands", () => {
  it.each(["default", "plan", "deep-plan"] as const)(
    "improves %s prompts and captures Fetch on the original queued destination",
    async (composerMode) => {
      const { commands, improve, request, send } = setup({ composerMode });
      await send();
      expect(improve).toHaveBeenCalledExactlyOnceWith("fix the bug");
      expect(commands).toEqual([
        {
          ...request,
          input: {
            ...request.input,
            message: { ...request.input.message, text: "Improved: fix the bug" },
            fetchMode: "repository-exploration",
          },
        },
      ]);
    },
  );

  it.each([
    { composerMode: "chat" as ComposerMode, prompt: "talk through the design" },
    { composerMode: "default" as ComposerMode, prompt: "/compact" },
  ])(
    "keeps $composerMode input $prompt literal without workflow preprocessing",
    async (selection) => {
      const { commands, improve, request, send } = setup(selection);
      await send();
      expect(improve).not.toHaveBeenCalled();
      expect(commands).toEqual([request]);
    },
  );

  it("honors disabled flags and an environment without Fetch support", async () => {
    const disabled = setup({
      preferences: { improvePromptBeforeSend: false, experimentalFetch: false },
    });
    await disabled.send();
    expect(disabled.improve).not.toHaveBeenCalled();
    expect(disabled.commands).toEqual([disabled.request]);
    const unsupported = setup({ supportsAgentWorkflow: false });
    await unsupported.send();
    expect(unsupported.commands[0]?.input.message.text).toBe("Improved: fix the bug");
    expect(unsupported.commands[0]?.input).not.toHaveProperty("fetchMode");
  });

  it("does not emit a command after the draft or destination changes while improvement is pending", async () => {
    let finishImprovement!: (text: string) => void;
    const completion = new Promise<string>((resolve) => {
      finishImprovement = resolve;
    });
    let current = true;
    const { commands, send } = setup({
      improve: () => completion,
      isCurrent: () => current,
    });
    const pending = send();
    current = false;
    finishImprovement("obsolete improved prompt");
    await pending;
    expect(commands).toEqual([]);
  });

  it("keeps failed improvement from sending the original draft by accident", async () => {
    const { commands, send } = setup({
      improve: async () => {
        throw new Error("improvement failed");
      },
    });
    await expect(send()).rejects.toThrow("improvement failed");
    expect(commands).toEqual([]);
  });

  it("rejects an empty improvement without emitting a provider command", async () => {
    const { commands, send } = setup({ improve: async () => "  " });
    await expect(send()).rejects.toThrow("Prompt improvement returned empty text.");
    expect(commands).toEqual([]);
  });

  it("preserves dictated file candidates through improvement and into the provider message", async () => {
    const reference: VoiceFileReference = {
      label: "index.ts",
      previewPath: "apps/server/index.ts",
      candidates: [
        { path: "apps/server/index.ts", symbols: [] },
        { path: "apps/web/index.ts", symbols: [] },
      ],
      truncated: false,
    };
    const prompt = `Fix ${serializeComposerFileLink(reference.previewPath)}`;
    const { commands, improve, send } = setup({ prompt, voiceFileReferences: [reference] });
    await send();
    expect(improve).toHaveBeenCalledExactlyOnceWith("Fix T3VOICEFILE0TOKEN");
    expect(extractVoiceFileContext(commands[0]!.input.message.text)).toEqual({
      text: `Improved: ${prompt}`,
      references: [reference],
    });
    expect(commands[0]?.input.fetchMode).toBe("repository-exploration");
  });
});
