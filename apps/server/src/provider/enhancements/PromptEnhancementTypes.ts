export type ProviderEnhancementSurface =
  | "workflowPhase"
  | "freeChatTools"
  | "freeChatStream"
  | "preflightGuardrail";

export type ProviderPromptTarget = "system" | "user";

export interface ProviderPromptPayload {
  readonly system: string;
  readonly user: string;
}

export function appendPromptAppendix(
  payload: ProviderPromptPayload,
  appendix: string,
  target: ProviderPromptTarget = "system",
): ProviderPromptPayload {
  const trimmed = appendix.trim();
  if (!trimmed) return payload;

  const current = payload[target];
  const separator = current.trim().length > 0 ? "\n\n" : "";
  return {
    ...payload,
    [target]: `${current}${separator}${trimmed}`,
  };
}
