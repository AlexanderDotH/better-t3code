import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "@t3tools/contracts";

type ComposerSubmitEvent = { preventDefault: () => void };

type ComposerSubmissionInput = {
  prompt: string;
  providerInput?: string;
  maxInputChars?: number;
  submissionTarget: "provider-turn" | "pending-user-input";
};

export function getComposerPromptLengthValidationMessage(
  prompt: string,
  maxInputChars = PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
): string | null {
  const effectiveLimit = Math.max(0, Math.min(PROVIDER_SEND_TURN_MAX_INPUT_CHARS, maxInputChars));
  const excessCharacters = prompt.trim().length - effectiveLimit;
  if (excessCharacters <= 0) return null;

  const characterLabel = excessCharacters === 1 ? "character" : "characters";
  return `Prompt is ${excessCharacters.toLocaleString("en-US")} ${characterLabel} over the ${effectiveLimit.toLocaleString("en-US")}-character limit. Shorten or split it before sending.`;
}

export function getComposerSubmissionValidationMessage(
  options: ComposerSubmissionInput,
): string | null {
  return options.submissionTarget === "provider-turn"
    ? getComposerPromptLengthValidationMessage(
        options.providerInput ?? options.prompt,
        options.maxInputChars,
      )
    : null;
}

export function submitComposerDraft(
  options: ComposerSubmissionInput & {
    event: ComposerSubmitEvent | undefined;
    onSend: (event?: ComposerSubmitEvent) => boolean | void;
  },
): { validationMessage: string | null; didDispatch: boolean } {
  const validationMessage = getComposerSubmissionValidationMessage(options);
  if (validationMessage) {
    options.event?.preventDefault();
    return { validationMessage, didDispatch: false };
  }

  if (options.onSend(options.event) === false) {
    options.event?.preventDefault();
    return { validationMessage: null, didDispatch: false };
  }
  return { validationMessage: null, didDispatch: true };
}
