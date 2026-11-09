import type { ComposerMode } from "@t3tools/contracts";
import { FETCH_MODE } from "@t3tools/shared/fetchMode";

export interface ComposerSendWorkflowInput {
  readonly prompt: string;
  readonly composerMode: ComposerMode;
  readonly supportsAgentWorkflow: boolean;
  readonly experimentalFetch: boolean;
  readonly improvePromptBeforeSend: boolean;
}

export interface ComposerSendWorkflow {
  readonly fetchMode?: typeof FETCH_MODE;
  readonly improvePromptBeforeSend?: true;
}

// Chat turns and slash commands (Codex feedback, /compact) bypass the agent workflow.
function usesAgentWorkflow(
  input: Pick<ComposerSendWorkflowInput, "prompt" | "composerMode" | "supportsAgentWorkflow">,
): boolean {
  return (
    input.supportsAgentWorkflow &&
    input.composerMode !== "chat" &&
    !input.prompt.trimStart().startsWith("/")
  );
}

export function composerFetchMode(
  input: Pick<
    ComposerSendWorkflowInput,
    "prompt" | "composerMode" | "supportsAgentWorkflow" | "experimentalFetch"
  >,
): typeof FETCH_MODE | undefined {
  return input.experimentalFetch && usesAgentWorkflow(input) ? FETCH_MODE : undefined;
}

function shouldImproveComposerPrompt(
  input: Pick<
    ComposerSendWorkflowInput,
    "prompt" | "composerMode" | "supportsAgentWorkflow" | "improvePromptBeforeSend"
  >,
): boolean {
  return (
    input.improvePromptBeforeSend && input.prompt.trim().length > 0 && usesAgentWorkflow(input)
  );
}

export function resolveComposerSendWorkflow(
  input: ComposerSendWorkflowInput,
): ComposerSendWorkflow {
  const fetchMode = composerFetchMode(input);
  return {
    ...(fetchMode === undefined ? {} : { fetchMode }),
    ...(shouldImproveComposerPrompt(input) ? { improvePromptBeforeSend: true } : {}),
  };
}
