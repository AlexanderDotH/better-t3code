import type { ComposerMode, EnvironmentId, VoiceFileReference } from "@t3tools/contracts";
import type { StartThreadTurnInput } from "@t3tools/client-runtime/operations";
import { resolvePromptForSend } from "@t3tools/client-runtime/prompt-improvement";
import { resolveFetchMode } from "@t3tools/shared/fetchMode";
import { translateVoiceDictationResult } from "@t3tools/shared/voiceFileContext";

type ComposerSendPreferences = {
  readonly improvePromptBeforeSend: boolean;
  readonly experimentalFetch: boolean;
};

export interface PreparedComposerSend {
  readonly prompt: string;
  readonly text: string;
  readonly voiceFileReferences: ReadonlyArray<VoiceFileReference>;
  readonly fetchMode?: "repository-exploration";
}

export interface ComposerSendPreparationInput {
  readonly prompt: string;
  readonly composerMode: ComposerMode;
  readonly preferences: ComposerSendPreferences;
  readonly supportsAgentWorkflow: boolean;
  readonly voiceFileReferences: ReadonlyArray<VoiceFileReference>;
  readonly improve: (prompt: string) => Promise<string>;
  readonly format: (prompt: string, references: ReadonlyArray<VoiceFileReference>) => string;
  readonly isCurrent: () => boolean;
}

export function shouldImproveComposerPrompt(
  input: Pick<ComposerSendPreparationInput, "prompt" | "composerMode" | "preferences">,
): boolean {
  return (
    input.preferences.improvePromptBeforeSend &&
    input.composerMode !== "chat" &&
    input.prompt.trim().length > 0 &&
    !input.prompt.trimStart().startsWith("/")
  );
}

export function composerFetchMode(
  input: Pick<
    ComposerSendPreparationInput,
    "prompt" | "composerMode" | "preferences" | "supportsAgentWorkflow"
  >,
): "repository-exploration" | undefined {
  return resolveFetchMode({
    featureEnabled:
      input.preferences.experimentalFetch &&
      input.supportsAgentWorkflow &&
      input.composerMode !== "chat" &&
      !input.prompt.trimStart().startsWith("/"),
  });
}

export async function prepareComposerSend(
  input: ComposerSendPreparationInput,
): Promise<PreparedComposerSend | null> {
  if (!input.isCurrent()) return null;
  let prompt = input.prompt;
  let references = input.voiceFileReferences;
  if (shouldImproveComposerPrompt(input)) {
    const improved = await translateVoiceDictationResult(
      { text: prompt, references },
      async (text) => {
        const improvedPrompt = await resolvePromptForSend({ prompt: text, improve: input.improve });
        if (improvedPrompt.trim().length === 0)
          throw new Error("Prompt improvement returned empty text.");
        return improvedPrompt;
      },
    );
    if (!input.isCurrent()) return null;
    prompt = improved.text;
    references = improved.references;
  }
  if (!input.isCurrent()) return null;
  const fetchMode = composerFetchMode(input);
  return {
    prompt,
    text: input.format(prompt, references),
    voiceFileReferences: references,
    ...(fetchMode === undefined ? {} : { fetchMode }),
  };
}

export interface ComposerTurnRequest {
  readonly environmentId: EnvironmentId;
  readonly input: StartThreadTurnInput;
}

export function preparedComposerTurnRequest(
  request: ComposerTurnRequest,
  prepared: PreparedComposerSend,
): ComposerTurnRequest {
  return {
    ...request,
    input: {
      ...request.input,
      message: { ...request.input.message, text: prepared.text },
      ...(prepared.fetchMode === undefined ? {} : { fetchMode: prepared.fetchMode }),
    },
  };
}
