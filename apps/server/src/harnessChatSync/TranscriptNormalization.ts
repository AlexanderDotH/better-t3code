import {
  CHAT_ATTACHMENT_MAX_AUDIO_BYTES,
  HarnessChatSessionId,
  IsoDateTime,
  MessageId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ChatAttachment,
  type HarnessChatActivity,
  type HarnessChatLink,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import type { ProjectionHarnessChatSyncLink } from "../persistence/Services/ProjectionHarnessChatSync.ts";
import type {
  ProviderHistoryAttachment,
  ProviderHistoryThreadSummary,
} from "../provider/Services/ProviderHistorySync.ts";
import { makeHarnessChatSyncAttachmentId } from "./Identifiers.ts";

const isIsoDateTime = Schema.is(IsoDateTime);

export interface NormalizedHistorySummary {
  readonly sessionId: HarnessChatSessionId;
  readonly title: string;
  readonly preview: string | null;
  readonly cwd: string | null;
  readonly model: string | null;
  readonly createdAt: IsoDateTime | null;
  readonly updatedAt: IsoDateTime;
  readonly archived: boolean;
  readonly messageCount: number;
  readonly activity: HarnessChatActivity;
}

/**
 * Reuses a message already projected from a live provider turn before creating
 * a second local message during a later history refresh.
 */
export function findExistingHarnessMessageMatch(input: {
  readonly nativeMessageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly linkedMessageIds: ReadonlySet<MessageId>;
  readonly claimedMessageIds: ReadonlySet<MessageId>;
}): OrchestrationMessage | undefined {
  const available = (message: OrchestrationMessage) =>
    !input.linkedMessageIds.has(message.id) && !input.claimedMessageIds.has(message.id);
  if (input.role === "assistant") {
    const nativeAssistantId = MessageId.make(`assistant:${input.nativeMessageId}`);
    const exact = input.messages.find(
      (message) => message.id === nativeAssistantId && available(message),
    );
    if (exact) return exact;
  }
  const normalizedText = input.text.trim();
  return input.messages.find(
    (message) =>
      message.role === input.role && message.text.trim() === normalizedText && available(message),
  );
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizeIsoDateTime(
  value: string | undefined,
  fallback: IsoDateTime,
): IsoDateTime {
  return value !== undefined && isIsoDateTime(value) ? value : fallback;
}

export function normalizeHistorySummary(
  summary: ProviderHistoryThreadSummary,
  fallbackTimestamp: IsoDateTime,
): NormalizedHistorySummary {
  const title = normalizeOptionalText(summary.title) ?? "Imported chat";
  return {
    sessionId: HarnessChatSessionId.make(summary.sessionId.trim()),
    title,
    preview: summary.preview,
    cwd: normalizeOptionalText(summary.cwd),
    model: normalizeOptionalText(summary.model),
    createdAt:
      summary.createdAt !== undefined && isIsoDateTime(summary.createdAt)
        ? summary.createdAt
        : null,
    updatedAt: normalizeIsoDateTime(summary.updatedAt, fallbackTimestamp),
    archived: summary.archived,
    messageCount:
      summary.messageCount === undefined ? 0 : Math.max(0, Math.floor(summary.messageCount)),
    activity: summary.activity,
  };
}

export function isHarnessChatChanged(
  sourceUpdatedAt: IsoDateTime | null,
  link: ProjectionHarnessChatSyncLink | undefined,
): boolean {
  if (!link) return true;
  if (sourceUpdatedAt === null) return false;
  if (link.sourceUpdatedAt === null) return true;
  return sourceUpdatedAt > link.sourceUpdatedAt;
}

export function toPublicHarnessChatLink(link: ProjectionHarnessChatSyncLink): HarnessChatLink {
  return {
    sourceId: link.sourceId,
    nativeSessionId: link.nativeSessionId,
    threadId: link.threadId,
    projectId: link.projectId,
    providerInstanceId: link.providerInstanceId,
    providerLabel: link.providerLabel,
    activity: link.activity,
    sourceUpdatedAt: link.sourceUpdatedAt,
    lastSyncedAt: link.lastSyncedAt,
  };
}

export const makeHarnessAttachmentPersistence = Effect.fn("makeHarnessAttachmentPersistence")(
  function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig;

    return Effect.fn("HarnessChatSync.persistAttachment")(function* (input: {
      readonly threadId: string;
      readonly sourceId: string;
      readonly nativeMessageId: string;
      readonly attachment: ProviderHistoryAttachment;
    }): Effect.fn.Return<ChatAttachment | null, never> {
      let mimeType = input.attachment.mimeType.trim().toLowerCase();
      let bytes: Uint8Array;
      switch (input.attachment.content.type) {
        case "data-url": {
          const parsed = parseBase64DataUrl(input.attachment.content.dataUrl);
          if (!parsed) return null;
          mimeType = parsed.mimeType.toLowerCase();
          bytes = new Uint8Array(Buffer.from(parsed.base64, "base64"));
          break;
        }
        case "file": {
          const read = yield* Effect.result(fileSystem.readFile(input.attachment.content.path));
          if (Result.isFailure(read)) return null;
          bytes = read.success;
          break;
        }
        case "url":
          return null;
      }
      if (!mimeType.startsWith(`${input.attachment.type}/`)) return null;
      const maxBytes =
        input.attachment.type === "image"
          ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
          : CHAT_ATTACHMENT_MAX_AUDIO_BYTES;
      if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;

      const attachment: ChatAttachment = {
        type: input.attachment.type,
        id: makeHarnessChatSyncAttachmentId({
          threadId: input.threadId,
          sourceId: input.sourceId,
          nativeMessageId: input.nativeMessageId,
          nativeAttachmentId: input.attachment.nativeAttachmentId,
        }),
        name: input.attachment.name.trim().slice(0, 255) || "imported-image",
        mimeType: mimeType.slice(0, 100),
        sizeBytes: bytes.byteLength,
      };
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) return null;

      const exists = yield* fileSystem
        .exists(attachmentPath)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) return attachment;
      const persisted = yield* Effect.result(
        fileSystem
          .makeDirectory(path.dirname(attachmentPath), { recursive: true })
          .pipe(Effect.andThen(fileSystem.writeFile(attachmentPath, bytes))),
      );
      return Result.isSuccess(persisted) ? attachment : null;
    });
  },
);
