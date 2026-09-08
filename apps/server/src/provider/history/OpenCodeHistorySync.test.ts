import type { Message, Part, Session, SessionStatus, Todo } from "@opencode-ai/sdk/v2";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { makeInstanceHistorySyncSource } from "../Services/ProviderHistorySync.ts";
import {
  makeOpenCodeHistorySyncAdapter,
  type OpenCodeHistoryGateway,
} from "./OpenCodeHistorySync.ts";

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: "session-root",
    slug: "root",
    projectID: "project-1",
    directory: "/workspace/project",
    title: "Fix the parser",
    version: "1",
    time: { created: 1_725_000_000_000, updated: 1_725_000_100_000 },
    ...overrides,
  }) as Session;

const source = makeInstanceHistorySyncSource({
  driverKind: ProviderDriverKind.make("opencode"),
  instanceId: ProviderInstanceId.make("opencode-default"),
  continuationKey: "opencode:default",
  displayName: "OpenCode",
  capabilities: { search: true, archived: true, resume: true, activity: true },
});

function makeGateway(input?: {
  readonly sessions?: ReadonlyArray<Session>;
  readonly statuses?: Readonly<Record<string, SessionStatus>>;
  readonly messages?: ReadonlyArray<{
    readonly info: Message;
    readonly parts: ReadonlyArray<Part>;
  }>;
  readonly todos?: ReadonlyArray<Todo>;
}): OpenCodeHistoryGateway {
  const sessions = input?.sessions ?? [session()];
  return {
    list: ({ start, limit }) =>
      Effect.succeed({
        sessions: sessions.slice(start, start + limit),
        statuses: input?.statuses ?? {},
      }),
    read: ({ sessionId }) =>
      Effect.succeed({
        session: sessions.find((candidate) => candidate.id === sessionId) ?? session(),
        messages: input?.messages ?? [],
        todos: input?.todos ?? [],
      }),
    status: ({ sessionId }) => Effect.succeed(input?.statuses?.[sessionId]),
  };
}

describe("OpenCode history listing", () => {
  effectIt.effect("lists only matching non-archived root sessions and maps native activity", () =>
    Effect.gen(function* () {
      const adapter = makeOpenCodeHistorySyncAdapter({
        source,
        gateway: makeGateway({
          sessions: [
            session(),
            session({
              id: "archived",
              title: "Archived parser",
              time: { created: 1, updated: 2, archived: 3 },
            }),
            session({ id: "child", title: "Parser subtask", parentID: "session-root" }),
            session({ id: "other", title: "Write documentation" }),
          ],
          statuses: { "session-root": { type: "busy" } },
        }),
      });

      const result = yield* adapter.list({ query: "parser", includeArchived: false, limit: 20 });

      expect(result.items).toEqual([
        {
          sessionId: "session-root",
          title: "Fix the parser",
          preview: null,
          cwd: "/workspace/project",
          model: null,
          createdAt: "2024-08-30T06:40:00.000Z",
          updatedAt: "2024-08-30T06:41:40.000Z",
          archived: false,
          isChild: false,
          activity: "active",
        },
      ]);
      expect(result.nextCursor).toBeUndefined();
      expect(result.latestUpdatedAt).toBe("2024-08-30T06:41:40.000Z");
    }),
  );

  effectIt.effect("uses an offset cursor without changing the selection universe", () =>
    Effect.gen(function* () {
      const adapter = makeOpenCodeHistorySyncAdapter({
        source,
        gateway: makeGateway({
          sessions: [session({ id: "one" }), session({ id: "two" }), session({ id: "three" })],
        }),
      });

      const first = yield* adapter.list({ includeArchived: true, limit: 2 });
      const second = yield* adapter.list({
        includeArchived: true,
        limit: 2,
        cursor: first.nextCursor,
      });

      expect(first.items.map((item) => item.sessionId)).toEqual(["one", "two"]);
      expect(second.items.map((item) => item.sessionId)).toEqual(["three"]);
    }),
  );
});

describe("OpenCode history transcript", () => {
  effectIt.effect("keeps visible messages, image/audio attachments, and the current plan", () =>
    Effect.gen(function* () {
      const root = session({
        model: { providerID: "openai", id: "gpt-5.4" },
        time: { created: 1_725_000_000_000, updated: 1_725_000_100_000 },
      });
      const adapter = makeOpenCodeHistorySyncAdapter({
        source,
        gateway: makeGateway({
          sessions: [root],
          messages: [
            {
              info: {
                id: "user-1",
                sessionID: root.id,
                role: "user",
                time: { created: 1_725_000_000_000 },
                agent: "build",
                model: { providerID: "openai", modelID: "gpt-5.4" },
              },
              parts: [
                {
                  id: "text-1",
                  sessionID: root.id,
                  messageID: "user-1",
                  type: "text",
                  text: "Please fix it.",
                },
                {
                  id: "image-1",
                  sessionID: root.id,
                  messageID: "user-1",
                  type: "file",
                  mime: "image/png",
                  filename: "bug.png",
                  url: "data:image/png;base64,AA==",
                },
                {
                  id: "ignored",
                  sessionID: root.id,
                  messageID: "user-1",
                  type: "reasoning",
                  text: "hidden",
                  time: { start: 1 },
                },
              ],
            },
            {
              info: {
                id: "assistant-1",
                sessionID: root.id,
                role: "assistant",
                time: { created: 1_725_000_050_000, completed: 1_725_000_060_000 },
                parentID: "user-1",
                modelID: "gpt-5.4",
                providerID: "openai",
                mode: "build",
                agent: "build",
                path: { cwd: root.directory, root: root.directory },
                cost: 0,
                tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
              },
              parts: [
                {
                  id: "text-2",
                  sessionID: root.id,
                  messageID: "assistant-1",
                  type: "text",
                  text: "Fixed.",
                },
                {
                  id: "audio-1",
                  sessionID: root.id,
                  messageID: "assistant-1",
                  type: "file",
                  mime: "audio/ogg",
                  filename: "answer.ogg",
                  url: "file:///tmp/answer.ogg",
                },
              ],
            },
          ],
          todos: [
            { content: "Reproduce the bug", status: "completed", priority: "high" },
            { content: "Add coverage", status: "in_progress", priority: "medium" },
          ],
        }),
      });

      const transcript = yield* adapter.read({ sessionId: root.id });

      expect(transcript.cwd).toBe(root.directory);
      expect(transcript.model).toBe("openai/gpt-5.4");
      expect(transcript.items).toMatchObject([
        {
          kind: "message",
          nativeMessageId: "user-1",
          role: "user",
          text: "Please fix it.",
          attachments: [{ type: "image", nativeAttachmentId: "image-1" }],
        },
        {
          kind: "message",
          nativeMessageId: "assistant-1",
          role: "assistant",
          text: "Fixed.",
          attachments: [
            {
              type: "audio",
              nativeAttachmentId: "audio-1",
              content: { type: "file", path: "/tmp/answer.ogg" },
            },
          ],
        },
        {
          kind: "plan",
          markdown: "- [x] Reproduce the bug\n- [ ] Add coverage _(in progress)_",
        },
      ]);
    }),
  );

  effectIt.effect("returns the original session id as resume binding", () =>
    Effect.gen(function* () {
      const adapter = makeOpenCodeHistorySyncAdapter({ source, gateway: makeGateway() });

      expect(yield* adapter.resumeCursor({ sessionId: "session-root" })).toEqual({
        resumeCursor: { sessionId: "session-root" },
      });
    }),
  );
});
