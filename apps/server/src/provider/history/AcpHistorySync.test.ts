import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";
import { describe, expect, it } from "vite-plus/test";

import { makeInstanceHistorySyncSource } from "../Services/ProviderHistorySync.ts";
import {
  acpHistoryCapabilityIssue,
  collectAcpHistoryTranscriptItems,
  makeAcpHistorySyncAdapter,
  type AcpHistoryGateway,
} from "./AcpHistorySync.ts";

const source = makeInstanceHistorySyncSource({
  driverKind: ProviderDriverKind.make("cursor"),
  instanceId: ProviderInstanceId.make("cursor-default"),
  continuationKey: "cursor:default",
  displayName: "Cursor",
  capabilities: { search: true, archived: false, resume: true, activity: false },
});

const capabilities = (input: {
  readonly list: boolean;
  readonly load: boolean;
}): EffectAcpSchema.InitializeResponse => ({
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: input.load,
    sessionCapabilities: input.list ? { list: {} } : {},
  },
});

describe("ACP history capabilities", () => {
  it("reports the exact missing session/list capability", () => {
    expect(acpHistoryCapabilityIssue(capabilities({ list: false, load: true }))).toBe(
      "ACP agent does not advertise session/list capability.",
    );
  });

  it("reports the exact missing session/load capability", () => {
    expect(acpHistoryCapabilityIssue(capabilities({ list: true, load: false }))).toBe(
      "ACP agent does not advertise session/load capability.",
    );
  });

  it("accepts an agent that can list and load sessions", () => {
    expect(acpHistoryCapabilityIssue(capabilities({ list: true, load: true }))).toBeUndefined();
  });
});

describe("ACP history listing", () => {
  effectIt.effect("preserves the native cursor while applying client-side search", () =>
    Effect.gen(function* () {
      const gateway: AcpHistoryGateway = {
        list: () =>
          Effect.succeed({
            initializeResult: capabilities({ list: true, load: true }),
            response: {
              sessions: [
                {
                  sessionId: "parser",
                  cwd: "/workspace/parser",
                  title: "Fix parser",
                  updatedAt: "2026-08-23T10:00:00.000Z",
                },
                {
                  sessionId: "docs",
                  cwd: "/workspace/docs",
                  title: "Write docs",
                  updatedAt: "2026-08-23T09:00:00.000Z",
                },
                {
                  sessionId: "parser-child",
                  cwd: "/workspace/parser",
                  title: "Parser child task",
                  updatedAt: "2026-08-23T10:01:00.000Z",
                  _meta: { parentSessionId: "parser" },
                },
              ],
              nextCursor: "native-page-2",
            },
          }),
        read: () =>
          Effect.succeed({
            initializeResult: capabilities({ list: true, load: true }),
            notifications: [],
          }),
      };
      const adapter = makeAcpHistorySyncAdapter({ source, gateway, defaultCwd: "/workspace" });

      const result = yield* adapter.list({ query: "parser", includeArchived: false, limit: 10 });

      expect(result.items).toEqual([
        {
          sessionId: "parser",
          title: "Fix parser",
          preview: null,
          cwd: "/workspace/parser",
          model: null,
          updatedAt: "2026-08-23T10:00:00.000Z",
          archived: false,
          isChild: false,
          activity: "unknown",
        },
      ]);
      expect(result.nextCursor).toBeDefined();
    }),
  );
});

describe("ACP replay mapping", () => {
  it("collects visible user/assistant chunks, media, and the last plan", () => {
    const notification = (
      update: EffectAcpSchema.SessionUpdate,
    ): EffectAcpSchema.SessionNotification => ({ sessionId: "session-1", update });
    const notifications: ReadonlyArray<EffectAcpSchema.SessionNotification> = [
      notification({
        sessionUpdate: "user_message_chunk",
        messageId: "user-1",
        content: { type: "text", text: "Please " },
      }),
      notification({
        sessionUpdate: "user_message_chunk",
        messageId: "user-1",
        content: { type: "text", text: "fix it." },
      }),
      notification({
        sessionUpdate: "user_message_chunk",
        messageId: "user-1",
        content: { type: "image", mimeType: "image/png", data: "AA==" },
      }),
      notification({
        sessionUpdate: "agent_message_chunk",
        messageId: "assistant-1",
        content: { type: "text", text: "Done." },
      }),
      notification({
        sessionUpdate: "plan",
        entries: [{ content: "Add regression test", priority: "high", status: "in_progress" }],
      }),
      notification({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        title: "Hidden tool output",
      }),
    ];

    expect(collectAcpHistoryTranscriptItems("session-1", notifications)).toMatchObject([
      {
        kind: "message",
        nativeMessageId: "user-1",
        role: "user",
        text: "Please fix it.",
        attachments: [
          {
            type: "image",
            nativeAttachmentId: "user-1:attachment:0",
            mimeType: "image/png",
            content: { type: "data-url", dataUrl: "data:image/png;base64,AA==" },
          },
        ],
      },
      {
        kind: "message",
        nativeMessageId: "assistant-1",
        role: "assistant",
        text: "Done.",
      },
      {
        kind: "plan",
        markdown: "- [ ] Add regression test _(in progress)_",
      },
    ]);
  });

  it("uses stable fallback ids for chunks without native message ids", () => {
    const items = collectAcpHistoryTranscriptItems("session-1", [
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "First response" },
        },
      },
      {
        sessionId: "session-1",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "Follow-up" },
        },
      },
    ]);

    expect(items.map((item) => (item.kind === "message" ? item.nativeMessageId : "plan"))).toEqual([
      "session-1:message:0",
      "session-1:message:1",
    ]);
  });

  effectIt.effect("surfaces a missing session/list capability without calling it supported", () =>
    Effect.gen(function* () {
      const gateway: AcpHistoryGateway = {
        list: () =>
          Effect.succeed({
            initializeResult: capabilities({ list: false, load: true }),
            response: { sessions: [] },
          }),
        read: () =>
          Effect.succeed({
            initializeResult: capabilities({ list: false, load: true }),
            notifications: [],
          }),
      };
      const adapter = makeAcpHistorySyncAdapter({ source, gateway, defaultCwd: "/workspace" });

      const error = yield* adapter.list({ includeArchived: false, limit: 10 }).pipe(Effect.flip);

      expect(error.detail).toBe("ACP agent does not advertise session/list capability.");
    }),
  );
});

describe("ACP resume binding", () => {
  effectIt.effect("returns the original provider session id", () =>
    Effect.gen(function* () {
      const gateway: AcpHistoryGateway = {
        list: () =>
          Effect.succeed({
            initializeResult: capabilities({ list: true, load: true }),
            response: { sessions: [] },
          }),
        read: () =>
          Effect.succeed({
            initializeResult: capabilities({ list: true, load: true }),
            notifications: [],
          }),
      };
      const adapter = makeAcpHistorySyncAdapter({ source, gateway, defaultCwd: "/workspace" });

      expect(yield* adapter.resumeCursor({ sessionId: "native-session" })).toEqual({
        resumeCursor: { sessionId: "native-session" },
      });
    }),
  );
});
