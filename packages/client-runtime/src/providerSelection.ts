import type { ModelSelection, ServerProvider } from "@t3tools/contracts";

export function isStartedThreadModelChangeAllowed(input: {
  readonly hasStarted: boolean;
  readonly allowMidChatProviderSwitching: boolean;
  readonly currentSelection: ModelSelection;
  readonly nextSelection: ModelSelection;
  readonly currentProviderInstanceId?: ModelSelection["instanceId"] | null | undefined;
  readonly currentRequiresNewThread: boolean;
  readonly nextRequiresNewThread: boolean;
}): boolean {
  if (!input.hasStarted || input.allowMidChatProviderSwitching) return true;
  const currentInstanceId = input.currentProviderInstanceId ?? input.currentSelection.instanceId;
  if (
    currentInstanceId === input.nextSelection.instanceId &&
    input.currentSelection.model === input.nextSelection.model
  )
    return true;
  return !input.currentRequiresNewThread && !input.nextRequiresNewThread;
}

const AUTO_REASONING_EVALUATION_DRIVER_KINDS: ReadonlySet<string> = new Set([
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "gemini",
  "chatgpt",
  "openrouter",
  "openai",
]);

export function supportsAutoReasoningEvaluationProvider(
  provider: Pick<ServerProvider, "driver">,
): boolean {
  return AUTO_REASONING_EVALUATION_DRIVER_KINDS.has(provider.driver);
}
