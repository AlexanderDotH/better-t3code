import type {
  GetSessionMessagesOptions,
  ListSessionsOptions,
  SDKSessionInfo,
  SessionMessage,
  SessionStore,
} from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeClaudeHistorySyncAdapter, makeClaudeHomeSessionStore } from "./ClaudeHistorySync.ts";

const unusedStore: SessionStore = {
  append: () => Promise.reject(new Error("read only")),
  load: () => Promise.resolve(null),
};

function makeSdk(input: {
  readonly sessions: ReadonlyArray<SDKSessionInfo>;
  readonly messages: ReadonlyArray<SessionMessage>;
}) {
  return {
    listSessions: (_options?: ListSessionsOptions) => Promise.resolve([...input.sessions]),
    getSessionMessages: (_sessionId: string, _options?: GetSessionMessagesOptions) =>
      Promise.resolve([...input.messages]),
  };
}

describe("ClaudeHistorySync", () => {
  it.effect(
    "filters and paginates main SDK sessions without claiming archive or activity data",
    () =>
      Effect.gen(function* () {
        const adapter = makeClaudeHistorySyncAdapter({
          sourceId: "claudeAgent:instance:work",
          sessionStore: unusedStore,
          sdk: makeSdk({
            sessions: [
              {
                sessionId: "session-1",
                summary: "Parser repair",
                firstPrompt: "Please repair the parser",
                cwd: "/workspace/parser",
                createdAt: 1_725_000_000_000,
                lastModified: 1_725_000_100_000,
              },
              {
                sessionId: "session-2",
                summary: "Unrelated task",
                cwd: "/workspace/other",
                lastModified: 1_725_000_050_000,
              },
            ],
            messages: [],
          }),
        });

        const result = yield* adapter.list({
          query: "parser",
          cwd: "/workspace/parser",
          includeArchived: true,
          limit: 1,
        });

        expect(result).toEqual({
          items: [
            {
              sessionId: "session-1",
              title: "Parser repair",
              preview: "Please repair the parser",
              cwd: "/workspace/parser",
              model: null,
              createdAt: "2024-08-30T06:40:00.000Z",
              updatedAt: "2024-08-30T06:41:40.000Z",
              archived: false,
              isChild: false,
              activity: "unknown",
            },
          ],
          nextCursor: undefined,
          totalMatching: 1,
          latestUpdatedAt: "2024-08-30T06:41:40.000Z",
        });
      }),
  );

  it.effect("maps visible SDK messages and resumes after the last assistant message", () =>
    Effect.gen(function* () {
      const sdk = makeSdk({
        sessions: [
          {
            sessionId: "session-1",
            summary: "Parser repair",
            cwd: "/workspace/parser",
            lastModified: 1_725_000_100_000,
          },
        ],
        messages: [
          {
            type: "user",
            uuid: "user-1",
            session_id: "session-1",
            parent_tool_use_id: null,
            message: {
              role: "user",
              content: [
                { type: "text", text: "Please inspect this." },
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/png", data: "AA==" },
                },
              ],
            },
          },
          {
            type: "assistant",
            uuid: "assistant-1",
            session_id: "session-1",
            parent_tool_use_id: null,
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "I inspected it." },
                {
                  type: "tool_use",
                  id: "tool-1",
                  name: "ExitPlanMode",
                  input: { plan: "# Plan\n\n- Repair" },
                },
              ],
            },
          },
          {
            type: "user",
            uuid: "tool-result-1",
            session_id: "session-1",
            parent_tool_use_id: "tool-1",
            message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
          },
        ],
      });
      const adapter = makeClaudeHistorySyncAdapter({
        sourceId: "claudeAgent:instance:work",
        sessionStore: unusedStore,
        sdk,
      });

      const transcript = yield* adapter.read({ sessionId: "session-1" });
      const binding = yield* adapter.resumeCursor({ sessionId: "session-1" });

      expect(transcript).toEqual({
        sessionId: "session-1",
        cwd: "/workspace/parser",
        updatedAt: "2024-08-30T06:41:40.000Z",
        items: [
          {
            kind: "message",
            nativeMessageId: "user-1",
            role: "user",
            text: "Please inspect this.",
            attachments: [
              {
                type: "image",
                nativeAttachmentId: "user-1:attachment:1",
                name: "image-2.png",
                mimeType: "image/png",
                content: { type: "data-url", dataUrl: "data:image/png;base64,AA==" },
              },
            ],
          },
          {
            kind: "message",
            nativeMessageId: "assistant-1",
            role: "assistant",
            text: "I inspected it.",
            attachments: [],
          },
          {
            kind: "plan",
            nativePlanId: "assistant-1:plan:1",
            markdown: "# Plan\n\n- Repair",
          },
        ],
      });
      expect(binding).toEqual({
        resumeCursor: {
          resume: "session-1",
          resumeSessionAt: "assistant-1",
          turnCount: 1,
        },
      });
    }),
  );

  it.effect("reads two configured Claude homes concurrently without mutating process.env", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-claude-history-",
      });
      const before = process.env.CLAUDE_CONFIG_DIR;
      const firstHome = path.join(root, "first");
      const secondHome = path.join(root, "second");
      yield* writeClaudeSession(firstHome, {
        sessionId: "11111111-1111-4111-8111-111111111111",
        cwd: "/workspace/first",
        prompt: "First home prompt",
      });
      yield* writeClaudeSession(secondHome, {
        sessionId: "22222222-2222-4222-8222-222222222222",
        cwd: "/workspace/second",
        prompt: "Second home prompt",
      });

      const firstStore = yield* makeClaudeHomeSessionStore(firstHome);
      const secondStore = yield* makeClaudeHomeSessionStore(secondHome);
      const first = makeClaudeHistorySyncAdapter({
        sourceId: "claude:first",
        sessionStore: firstStore,
      });
      const second = makeClaudeHistorySyncAdapter({
        sourceId: "claude:second",
        sessionStore: secondStore,
      });
      const [firstResult, secondResult] = yield* Effect.all(
        [
          first.list({ includeArchived: false, limit: 20 }),
          second.list({ includeArchived: false, limit: 20 }),
        ],
        { concurrency: "unbounded" },
      );

      expect(firstResult.items.map((item) => item.sessionId)).toEqual([
        "11111111-1111-4111-8111-111111111111",
      ]);
      expect(secondResult.items.map((item) => item.sessionId)).toEqual([
        "22222222-2222-4222-8222-222222222222",
      ]);
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(before);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

const writeClaudeSession = Effect.fn("ClaudeHistorySync.test.writeClaudeSession")(function* (
  configDir: string,
  input: { readonly sessionId: string; readonly cwd: string; readonly prompt: string },
): Effect.fn.Return<void, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectDir = path.join(configDir, "projects", input.cwd.replaceAll("/", "-"));
  const timestamp = "2024-08-30T06:40:00.000Z";
  const userId = `${input.sessionId}:user`;
  const entries = [
    {
      type: "user",
      uuid: userId,
      parentUuid: null,
      sessionId: input.sessionId,
      isSidechain: false,
      cwd: input.cwd,
      timestamp,
      message: { role: "user", content: input.prompt },
    },
    {
      type: "assistant",
      uuid: `${input.sessionId}:assistant`,
      parentUuid: userId,
      sessionId: input.sessionId,
      isSidechain: false,
      cwd: input.cwd,
      timestamp,
      message: {
        id: `${input.sessionId}:message`,
        type: "message",
        role: "assistant",
        model: "claude-sonnet",
        content: [{ type: "text", text: "Done" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
  ];
  yield* fileSystem.makeDirectory(projectDir, { recursive: true }).pipe(Effect.orDie);
  yield* fileSystem
    .writeFileString(
      path.join(projectDir, `${input.sessionId}.jsonl`),
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    )
    .pipe(Effect.orDie);
});
