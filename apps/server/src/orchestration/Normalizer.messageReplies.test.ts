import {
  ApprovalRequestId,
  CommandId,
  MessageId,
  SubagentId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { normalizeDispatchCommand } from "./Normalizer.ts";

const testLayer = Layer.mergeAll(
  WorkspacePaths.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-reply-normalizer-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

const base = {
  commandId: CommandId.make("reply-command"),
  threadId: ThreadId.make("reply-parent"),
  replyTopicId: SubagentId.make("reply-topic"),
  createdAt: "2026-10-13T10:00:00.000Z",
};
const image = {
  type: "image" as const,
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 6,
  dataUrl: "data:image/png;base64,cGl4ZWxz",
};

describe("reply attachment normalization", () => {
  it.effect("claims reply images in the parent environment and preserves the complete quote", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const replyTo = {
        messageId: MessageId.make("source"),
        role: "assistant" as const,
        text: "Original source with **formatting** and complete context.",
      };
      const command: ClientOrchestrationCommand = {
        ...base,
        type: "thread.reply.start",
        message: {
          messageId: MessageId.make("reply-user"),
          role: "user",
          text: "Please inspect this image.",
          attachments: [image],
        },
        replyTo,
      };
      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.reply.start") throw new Error("Expected reply start");
      expect(normalized.replyTo).toEqual(replyTo);
      expect(normalized.replyTopicId).toBe(base.replyTopicId);
      expect(normalized.message.attachments).toHaveLength(1);
      expect(normalized.message.attachments[0]).not.toHaveProperty("dataUrl");
      expect(normalized.message.attachments[0]?.id).toContain(base.threadId);
      expect(yield* fs.readDirectory(config.attachmentsDir)).toHaveLength(1);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("normalizes attachments for the exact topic's question response", () =>
    Effect.gen(function* () {
      const command: ClientOrchestrationCommand = {
        ...base,
        type: "thread.reply.user-input.respond",
        requestId: ApprovalRequestId.make("request-1"),
        answers: { question: "Use this screenshot" },
        attachmentsByQuestionId: { question: [image] },
      };
      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.reply.user-input.respond")
        throw new Error("Expected reply response");
      expect(normalized.replyTopicId).toBe(base.replyTopicId);
      expect(normalized.answers).toEqual(command.answers);
      expect(normalized.attachmentsByQuestionId?.question).toHaveLength(1);
      expect(normalized.attachmentsByQuestionId?.question?.[0]).not.toHaveProperty("dataUrl");
    }).pipe(Effect.provide(testLayer)),
  );
});
