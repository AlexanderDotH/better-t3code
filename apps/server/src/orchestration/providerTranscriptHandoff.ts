import {
  isProviderSendTurnSupportedImageMimeType,
  type ChatAttachment,
  type OrchestrationMessage,
  type ThreadForkHistory,
} from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { projectActivityPayload } from "./ActivityPayloadProjection.ts";

const HANDOFF_HEADER = [
  "<t3code_full_transcript_handoff>",
  "The following completed canonical messages occurred before the current user message.",
].join("\n");
const HANDOFF_FOOTER = "</t3code_full_transcript_handoff>";
const FORK_HANDOFF_HEADER = [
  "<t3code_fork_history_handoff>",
  "The following immutable client-visible history was copied from the source chat before the current user message.",
].join("\n");
const FORK_HANDOFF_FOOTER = "</t3code_fork_history_handoff>";
const FORK_HANDOFF_OMISSION_NOTICE =
  "[Earlier fork history was omitted to fit the provider input limit. The complete history remains visible in T3 Code.]";
const HANDOFF_ENTRY_SEPARATOR = "\n\n";

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

type ForkHandoffEntry = {
  readonly ordinal: number;
  readonly rendered: string;
};

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const RUNTIME_ONLY_PAYLOAD_KEYS = new Set([
  "canonicalPayload",
  "providerDriver",
  "providerInstanceId",
  "providerThreadId",
  "resumeCursor",
  "runtimeSessionId",
]);

function sanitizeVisiblePayload(value: unknown, depth = 0): unknown {
  if (depth >= 8) {
    return "[Nested payload omitted]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeVisiblePayload(entry, depth + 1));
  }
  if (!Predicate.isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !RUNTIME_ONLY_PAYLOAD_KEYS.has(key))
      .map(([key, nested]) => [key, sanitizeVisiblePayload(nested, depth + 1)]),
  );
}

function renderForkActivity(activity: ThreadForkHistory["activities"][number]): string {
  const projected = projectActivityPayload(activity);
  const visiblePayload = sanitizeVisiblePayload(projected.payload);
  const payloadJson = visiblePayload === undefined ? undefined : encodeUnknownJson(visiblePayload);
  return [
    "[activity]",
    `kind=${JSON.stringify(activity.kind)}; tone=${activity.tone}`,
    activity.summary,
    ...(payloadJson === undefined ? [] : [`payload=${payloadJson}`]),
    "[/activity]",
  ].join("\n");
}

function renderForkPlan(plan: ThreadForkHistory["proposedPlans"][number]): string {
  return ["[proposed-plan]", plan.planMarkdown, "[/proposed-plan]"].join("\n");
}

function renderForkSubagent(subagent: ThreadForkHistory["subagents"][number]): string {
  const details = [
    `name=${JSON.stringify(subagent.name)}; status=${subagent.status}`,
    ...(subagent.role ? [`role=${JSON.stringify(subagent.role)}`] : []),
    ...(subagent.task ? [`task=${JSON.stringify(subagent.task)}`] : []),
    ...(subagent.statusMessage ? [`status=${JSON.stringify(subagent.statusMessage)}`] : []),
    ...(subagent.latestProgress
      ? [
          `progress=${JSON.stringify(subagent.latestProgress.summary)}`,
          ...(subagent.latestProgress.detail
            ? [`progressDetail=${JSON.stringify(subagent.latestProgress.detail)}`]
            : []),
        ]
      : []),
  ];
  return ["[subagent]", ...details, "[/subagent]"].join("\n");
}

function renderForkCheckpoint(checkpoint: ThreadForkHistory["checkpoints"][number]): string {
  const files = checkpoint.files.map(
    (file) => `- ${file.kind} ${file.path} (+${file.additions}/-${file.deletions})`,
  );
  return [
    "[checkpoint]",
    `status=${checkpoint.status}; turn=${checkpoint.checkpointTurnCount}`,
    ...files,
    "[/checkpoint]",
  ].join("\n");
}

function collectForkHandoffEntries(history: ThreadForkHistory): ReadonlyArray<ForkHandoffEntry> {
  return [
    ...history.messages
      .filter((message) => !message.streaming)
      .map((message) => ({
        ordinal: message.historyOrigin.ordinal,
        rendered: renderMessage(message),
      })),
    ...history.activities.map((activity) => ({
      ordinal: activity.historyOrigin.ordinal,
      rendered: renderForkActivity(activity),
    })),
    ...history.proposedPlans.map((plan) => ({
      ordinal: plan.historyOrigin.ordinal,
      rendered: renderForkPlan(plan),
    })),
    ...history.subagents.map((subagent) => ({
      ordinal: subagent.historyOrigin.ordinal,
      rendered: renderForkSubagent(subagent),
    })),
    ...history.checkpoints.map((checkpoint) => ({
      ordinal: checkpoint.historyOrigin.ordinal,
      rendered: renderForkCheckpoint(checkpoint),
    })),
  ].sort((left, right) => left.ordinal - right.ordinal);
}

function renderForkHandoff(
  entries: ReadonlyArray<ForkHandoffEntry>,
  earlierHistoryOmitted: boolean,
): string {
  return [
    FORK_HANDOFF_HEADER,
    ...(earlierHistoryOmitted ? [FORK_HANDOFF_OMISSION_NOTICE] : []),
    ...entries.map((entry) => entry.rendered),
    FORK_HANDOFF_FOOTER,
  ].join(HANDOFF_ENTRY_SEPARATOR);
}

function measureForkHandoff(
  entries: ReadonlyArray<ForkHandoffEntry>,
  earlierHistoryOmitted: boolean,
): number {
  const fixedParts = earlierHistoryOmitted ? 3 : 2;
  const fixedLength =
    FORK_HANDOFF_HEADER.length +
    FORK_HANDOFF_FOOTER.length +
    (earlierHistoryOmitted ? FORK_HANDOFF_OMISSION_NOTICE.length : 0);
  const entryLength = entries.reduce((length, entry) => length + entry.rendered.length, 0);
  return (
    fixedLength + entryLength + (fixedParts + entries.length - 1) * HANDOFF_ENTRY_SEPARATOR.length
  );
}

function collectSupportedForkAttachments(
  history: ThreadForkHistory,
): ReadonlyArray<ChatAttachment> {
  const attachmentsById = new Map<string, ChatAttachment>();
  for (const message of history.messages.toSorted(
    (left, right) => left.historyOrigin.ordinal - right.historyOrigin.ordinal,
  )) {
    for (const attachment of message.attachments ?? []) {
      if (
        attachment.type !== "image" ||
        !isProviderSendTurnSupportedImageMimeType(attachment.mimeType)
      ) {
        continue;
      }
      if (!attachmentsById.has(attachment.id)) {
        attachmentsById.set(attachment.id, attachment);
      }
    }
  }
  return Array.from(attachmentsById.values());
}

function collectRecentSupportedForkAttachments(
  history: ThreadForkHistory,
  maxAttachments: number,
): ReadonlyArray<ChatAttachment> {
  if (maxAttachments <= 0) return [];
  const allAttachments = collectSupportedForkAttachments(history);
  if (allAttachments.length <= maxAttachments) return allAttachments;
  return allAttachments.slice(-maxAttachments);
}

export function buildProviderForkTranscriptHandoff(history: ThreadForkHistory): {
  readonly handoff: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
} {
  const entries = collectForkHandoffEntries(history);
  return {
    handoff: renderForkHandoff(entries, false),
    attachments: collectSupportedForkAttachments(history),
  };
}

export function buildBoundedProviderForkTranscriptHandoff(
  history: ThreadForkHistory,
  limits: {
    readonly maxInputChars: number;
    readonly maxAttachments: number;
  },
): {
  readonly handoff: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
} {
  const maxInputChars = Math.max(0, Math.floor(limits.maxInputChars));
  const maxAttachments = Math.max(0, Math.floor(limits.maxAttachments));
  const entries = collectForkHandoffEntries(history);
  const attachments = collectRecentSupportedForkAttachments(history, maxAttachments);
  if (measureForkHandoff(entries, false) <= maxInputChars) {
    return { handoff: renderForkHandoff(entries, false), attachments };
  }

  const omittedHandoffLength = measureForkHandoff([], true);
  if (omittedHandoffLength > maxInputChars) {
    return { handoff: "", attachments };
  }

  const selectedInReverse: ForkHandoffEntry[] = [];
  let renderedLength = omittedHandoffLength;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const addedLength = entry.rendered.length + HANDOFF_ENTRY_SEPARATOR.length;
    if (renderedLength + addedLength > maxInputChars) continue;
    selectedInReverse.push(entry);
    renderedLength += addedLength;
  }
  return {
    handoff: renderForkHandoff(selectedInReverse.toReversed(), true),
    attachments,
  };
}

export function measureProviderForkHandoff(history: ThreadForkHistory): {
  readonly historyInputChars: number;
  readonly historyAttachmentCount: number;
} {
  const entries = collectForkHandoffEntries(history);
  const attachments = collectSupportedForkAttachments(history);
  const historyInputChars = measureForkHandoff(entries, false);
  return {
    historyInputChars,
    historyAttachmentCount: attachments.length,
  };
}
