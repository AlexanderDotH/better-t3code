export function shouldOfferProjectSpeechPreindex(input: {
  voiceInputConfigured: boolean;
  routeKind: "server" | "draft";
  hasProjectSpeechProfile: boolean;
  hasStartedThread: boolean;
  prompt: string;
}): boolean {
  return (
    input.voiceInputConfigured &&
    input.routeKind === "draft" &&
    !input.hasProjectSpeechProfile &&
    !input.hasStartedThread &&
    input.prompt.trim().length === 0
  );
}

export async function resolvePromptForSend(input: {
  prompt: string;
  improve?: (prompt: string) => Promise<string>;
}): Promise<string> {
  const trimmedPrompt = input.prompt.trim();
  if (!input.improve || trimmedPrompt.length === 0) {
    return input.prompt;
  }
  return await input.improve(trimmedPrompt);
}
