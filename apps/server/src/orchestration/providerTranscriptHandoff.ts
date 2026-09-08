import type {
  ChatAttachment,
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  ThreadForkHistory,
} from "@t3tools/contracts";

const HANDOFF_HEADER = [
  "<t3code_context_handoff>",
  "This is a compact, deterministic continuation handoff. Exact older canonical messages remain available through thread_context.",
].join("\n");
const HANDOFF_FOOTER = "</t3code_context_handoff>";
const MESSAGE_TEXT_MAX_CHARS = 6_000;

type HandoffCheckpoint = Pick<
  OrchestrationCheckpointSummary,
  "checkpointRef" | "checkpointTurnCount" | "completedAt" | "files" | "status"
>;

type CompactHandoffInput = {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly latestTurnState?: string | null;
  readonly checkpoints?: ReadonlyArray<HandoffCheckpoint>;
};

export type ProviderTranscriptHandoff = {
  readonly handoff: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
};

function boundedText(text: string): string {
  if (text.length <= MESSAGE_TEXT_MAX_CHARS) return text;
  const marker = "\n[truncated]\n";
  const retained = MESSAGE_TEXT_MAX_CHARS - marker.length;
  const head = Math.ceil(retained / 2);
  return `${text.slice(0, head)}${marker}${text.slice(-(retained - head))}`;
}

function renderAttachmentMetadata(message: OrchestrationMessage): ReadonlyArray<string> {
  if (!message.attachments?.length) return [];
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
    boundedText(message.text),
    ...renderAttachmentMetadata(message),
    `[/${message.role}]`,
  ].join("\n");
}

function latestCheckpoint(checkpoints: ReadonlyArray<HandoffCheckpoint>): HandoffCheckpoint | null {
  return (
    checkpoints
      .toSorted(
        (left, right) =>
          left.checkpointTurnCount - right.checkpointTurnCount ||
          left.completedAt.localeCompare(right.completedAt) ||
          String(left.checkpointRef).localeCompare(String(right.checkpointRef)),
      )
      .at(-1) ?? null
  );
}

function renderCheckpoint(checkpoints: ReadonlyArray<HandoffCheckpoint>): string {
  const checkpoint = latestCheckpoint(checkpoints);
  if (!checkpoint) return "[checkpoint]\nnone\n[/checkpoint]";
  const files = checkpoint.files.toSorted(
    (left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind),
  );
  return [
    "[checkpoint]",
    `status=${checkpoint.status}; turn=${checkpoint.checkpointTurnCount}; ref=${checkpoint.checkpointRef}`,
    "[changed-files]",
    ...(files.length === 0
      ? ["none"]
      : files.map((file) => `- ${file.kind} ${file.path} (+${file.additions}/-${file.deletions})`)),
    "[/changed-files]",
    "[/checkpoint]",
  ].join("\n");
}

function collectAttachments(
  messages: ReadonlyArray<OrchestrationMessage | undefined>,
): ReadonlyArray<ChatAttachment> {
  const attachments = new Map<string, ChatAttachment>();
  for (const message of messages) {
    for (const attachment of message?.attachments ?? []) {
      if (!attachments.has(attachment.id)) attachments.set(attachment.id, attachment);
    }
  }
  return Array.from(attachments.values());
}

function buildCompactHandoff(input: CompactHandoffInput): ProviderTranscriptHandoff {
  const messages = input.messages.filter((message) => !message.streaming);
  const originalGoal = messages.find((message) => message.role === "user");
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  const latestUser = latestUserIndex < 0 ? undefined : messages[latestUserIndex];
  const latestAssistant = messages.findLast((message) => message.role === "assistant");
  const latestTurnState =
    input.latestTurnState ??
    (latestUser === undefined
      ? "unknown"
      : latestAssistant === undefined
        ? "pending"
        : "completed");
  const open = ["pending", "running", "interrupted", "error"].includes(latestTurnState);
  const latestUserText =
    latestUser === undefined
      ? "none"
      : latestUser === originalGoal
        ? `same as original goal; messageId=${latestUser.id}`
        : renderMessage(latestUser);

  return {
    handoff: [
      HANDOFF_HEADER,
      [
        "[original-goal]",
        originalGoal ? renderMessage(originalGoal) : "none",
        "[/original-goal]",
      ].join("\n"),
      ["[current-state]", `latestTurn=${latestTurnState}; open=${open}`, "[/current-state]"].join(
        "\n",
      ),
      [
        "[latest-exchange]",
        latestUserText,
        latestAssistant ? renderMessage(latestAssistant) : "assistant=none",
        "[/latest-exchange]",
      ].join("\n"),
      renderCheckpoint(input.checkpoints ?? []),
      HANDOFF_FOOTER,
    ].join("\n\n"),
    attachments: collectAttachments([originalGoal, latestUser, latestAssistant]),
  };
}

export function buildProviderTranscriptHandoff(input: {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly boundaryMessageId: OrchestrationMessage["id"];
  readonly latestTurnState?: string | null;
  readonly checkpoints?: ReadonlyArray<HandoffCheckpoint>;
}): ProviderTranscriptHandoff {
  const boundaryIndex = input.messages.findIndex(
    (message) => message.id === input.boundaryMessageId,
  );
  return buildCompactHandoff({
    messages: boundaryIndex < 0 ? [] : input.messages.slice(0, boundaryIndex),
    ...(input.latestTurnState !== undefined ? { latestTurnState: input.latestTurnState } : {}),
    ...(input.checkpoints !== undefined ? { checkpoints: input.checkpoints } : {}),
  });
}

export function buildProviderForkTranscriptHandoff(
  history: ThreadForkHistory,
): ProviderTranscriptHandoff {
  const latestTurn = history.turns
    .toSorted((left, right) => left.historyOrigin.ordinal - right.historyOrigin.ordinal)
    .at(-1);
  return buildCompactHandoff({
    messages: history.messages.toSorted(
      (left, right) => left.historyOrigin.ordinal - right.historyOrigin.ordinal,
    ),
    ...(latestTurn?.state !== undefined ? { latestTurnState: latestTurn.state } : {}),
    checkpoints: history.checkpoints,
  });
}

export function measureProviderForkHandoff(history: ThreadForkHistory): {
  readonly historyInputChars: number;
  readonly historyAttachmentCount: number;
} {
  const built = buildProviderForkTranscriptHandoff(history);
  return {
    historyInputChars: built.handoff.length,
    historyAttachmentCount: built.attachments.length,
  };
}
