import type { OrchestrationMessage } from "@t3tools/contracts";

const HANDOFF_HEADER = [
  "<t3code_full_transcript_handoff>",
  "The following completed canonical messages occurred before the current user message.",
].join("\n");
const HANDOFF_FOOTER = "</t3code_full_transcript_handoff>";

function renderAttachmentMetadata(message: OrchestrationMessage): string[] {
  if (message.attachments === undefined || message.attachments.length === 0) {
    return [];
  }

  return [
    "[attachments]",
    ...message.attachments.map(
      (attachment) =>
        `- type=${attachment.type}; id=${attachment.id}; name=${JSON.stringify(attachment.name)}; mimeType=${attachment.mimeType}; sizeBytes=${attachment.sizeBytes}`,
    ),
    "[/attachments]",
  ];
}

function renderMessage(message: OrchestrationMessage): string {
  return [
    `[${message.role}]`,
    message.text,
    ...renderAttachmentMetadata(message),
    `[/${message.role}]`,
  ].join("\n");
}

export function buildProviderTranscriptHandoff(input: {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly boundaryMessageId: OrchestrationMessage["id"];
}): string {
  const boundaryIndex = input.messages.findIndex(
    (message) => message.id === input.boundaryMessageId,
  );
  const priorMessages = (boundaryIndex < 0 ? [] : input.messages.slice(0, boundaryIndex)).filter(
    (message) => !message.streaming,
  );

  return [HANDOFF_HEADER, ...priorMessages.map(renderMessage), HANDOFF_FOOTER].join("\n\n");
}

export function prependProviderTranscriptHandoff(input: {
  readonly handoff: string;
  readonly providerInput: string;
}): string {
  return `${input.handoff}\n\n${input.providerInput}`;
}
