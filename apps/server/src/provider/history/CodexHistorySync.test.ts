import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { makeCodexHistorySyncAdapter } from "./CodexHistorySync.ts";

function makeListedThread(
  overrides: Partial<CodexSchema.V2ThreadListResponse__Thread> = {},
): CodexSchema.V2ThreadListResponse__Thread {
  return {
    cliVersion: "1.0.0",
    createdAt: 1_725_000_000,
    cwd: "/workspace/project",
    ephemeral: false,
    id: "thread-1",
    modelProvider: "openai",
    name: "Fix the parser",
    preview: "Please fix the parser",
    sessionId: "session-tree-1",
    source: "cli",
    status: { type: "idle" },
    turns: [],
    updatedAt: 1_725_000_100,
    ...overrides,
  };
}

function makeReadThread(
  overrides: Partial<CodexSchema.V2ThreadReadResponse__Thread> = {},
): CodexSchema.V2ThreadReadResponse__Thread {
  return {
    cliVersion: "1.0.0",
    createdAt: 1_725_000_000,
    cwd: "/workspace/project",
    ephemeral: false,
    id: "thread-1",
    modelProvider: "openai",
    name: "Fix the parser",
    preview: "Please fix the parser",
    sessionId: "session-tree-1",
    source: "cli",
    status: { type: "idle" },
    turns: [],
    updatedAt: 1_725_000_100,
    ...overrides,
  };
}

describe("CodexHistorySync", () => {
  it.effect("lists only top-level durable threads and preserves native paging filters", () =>
    Effect.gen(function* () {
      const requests: CodexSchema.V2ThreadListParams[] = [];
      const adapter = makeCodexHistorySyncAdapter({
        sourceId: "codex:instance:work",
        listThreads: (input) => {
          requests.push(input);
          return Effect.succeed({
            data: [
              makeListedThread(),
              makeListedThread({ id: "ephemeral", ephemeral: true }),
              makeListedThread({ id: "child", parentThreadId: "thread-1" }),
            ],
            nextCursor: null,
          });
        },
        readThread: ({ threadId }) => Effect.succeed({ thread: makeReadThread({ id: threadId }) }),
      });

      const result = yield* adapter.list({
        query: "parser",
        cwd: "/workspace/project",
        includeArchived: false,
        limit: 20,
      });

      expect(requests).toEqual([
        {
          archived: false,
          cwd: "/workspace/project",
          limit: 20,
          searchTerm: "parser",
          sortDirection: "desc",
          sortKey: "updated_at",
        },
      ]);
      expect(result.items).toEqual([
        {
          sessionId: "thread-1",
          title: "Fix the parser",
          preview: "Please fix the parser",
          cwd: "/workspace/project",
          model: null,
          createdAt: "2024-08-30T06:40:00.000Z",
          updatedAt: "2024-08-30T06:41:40.000Z",
          archived: false,
          isChild: false,
          activity: "idle",
        },
      ]);
      expect(result.nextCursor).toBeUndefined();
    }),
  );

  it.effect("continues into the archived native source when archives are included", () =>
    Effect.gen(function* () {
      const archivedRequests: boolean[] = [];
      const adapter = makeCodexHistorySyncAdapter({
        sourceId: "codex:instance:work",
        listThreads: (input) => {
          archivedRequests.push(input.archived === true);
          return Effect.succeed({
            data: [
              makeListedThread({
                id: input.archived === true ? "archived-1" : "current-1",
                name: input.archived === true ? "Archived" : "Current",
              }),
            ],
            nextCursor: null,
          });
        },
        readThread: ({ threadId }) => Effect.succeed({ thread: makeReadThread({ id: threadId }) }),
      });

      const first = yield* adapter.list({ includeArchived: true, limit: 1 });
      const second = yield* adapter.list({
        includeArchived: true,
        cursor: first.nextCursor,
        limit: 1,
      });

      expect(first.items.map((item) => item.sessionId)).toEqual(["current-1"]);
      expect(second.items.map((item) => item.sessionId)).toEqual(["archived-1"]);
      expect(second.items[0]?.archived).toBe(true);
      expect(archivedRequests).toEqual([false, true]);
    }),
  );

  it.effect("reads only visible messages, attachments, and completed plan content", () =>
    Effect.gen(function* () {
      const adapter = makeCodexHistorySyncAdapter({
        sourceId: "codex:instance:work",
        listThreads: () => Effect.succeed({ data: [], nextCursor: null }),
        readThread: ({ threadId, includeTurns }) =>
          Effect.succeed({
            thread: makeReadThread({
              id: threadId,
              status: { type: "active", activeFlags: ["waitingOnUserInput"] },
              turns: includeTurns
                ? [
                    {
                      id: "turn-1",
                      status: "completed",
                      startedAt: 1_725_000_010,
                      completedAt: 1_725_000_020,
                      items: [
                        {
                          id: "user-1",
                          type: "userMessage",
                          content: [
                            { type: "text", text: "Please inspect this." },
                            { type: "localImage", path: "/tmp/input.png" },
                            { type: "audio", url: "https://example.test/input.ogg" },
                          ],
                        },
                        { id: "reasoning-1", type: "reasoning", summary: ["hidden"] },
                        {
                          id: "assistant-1",
                          type: "agentMessage",
                          phase: "final_answer",
                          text: "Done.",
                        },
                        { id: "plan-1", type: "plan", text: "# Plan\n\n- Inspect" },
                        {
                          id: "command-1",
                          type: "commandExecution",
                          command: "pwd",
                          commandActions: [],
                          cwd: "/workspace/project",
                          status: "completed",
                        },
                      ],
                    },
                  ]
                : [],
            }),
          }),
      });

      const transcript = yield* adapter.read({ sessionId: "thread-1" });
      const activity = yield* adapter.checkActivity!({ sessionId: "thread-1" });
      const binding = yield* adapter.resumeCursor({ sessionId: "thread-1" });

      expect(transcript).toEqual({
        sessionId: "thread-1",
        cwd: "/workspace/project",
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
                name: "input.png",
                mimeType: "image/png",
                content: { type: "file", path: "/tmp/input.png" },
              },
              {
                type: "audio",
                nativeAttachmentId: "user-1:attachment:2",
                name: "input.ogg",
                mimeType: "audio/ogg",
                content: { type: "url", url: "https://example.test/input.ogg" },
              },
            ],
            createdAt: "2024-08-30T06:40:10.000Z",
            updatedAt: "2024-08-30T06:40:20.000Z",
          },
          {
            kind: "message",
            nativeMessageId: "assistant-1",
            role: "assistant",
            text: "Done.",
            attachments: [],
            createdAt: "2024-08-30T06:40:10.000Z",
            updatedAt: "2024-08-30T06:40:20.000Z",
          },
          {
            kind: "plan",
            nativePlanId: "plan-1",
            markdown: "# Plan\n\n- Inspect",
            createdAt: "2024-08-30T06:40:10.000Z",
            updatedAt: "2024-08-30T06:40:20.000Z",
          },
        ],
      });
      expect(activity).toBe("active");
      expect(binding).toEqual({ resumeCursor: { threadId: "thread-1" } });
    }),
  );
});
