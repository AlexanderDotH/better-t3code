import { assert, it } from "@effect/vitest";
import { Session } from "@opencode/client/effect";
import { SessionsCursor } from "@opencode/protocol/groups/session";
import type { ProviderHistorySyncSource } from "@t3tools/provider-core/server/ProviderHistorySync";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";

import * as OpenCode2Client from "./OpenCode2Client.ts";
import * as OpenCode2Server from "./OpenCode2Server.ts";
import { makeOpenCode2HistorySyncAdapter } from "./history.ts";

const source: ProviderHistorySyncSource = {
  sourceId: "opencode:history-2",
  continuationKey: "opencode:history-2",
  displayName: "OpenCode 2",
  capabilities: { search: true, archived: false, resume: true, activity: true },
};
const nativeSession = {
  id: "ses_history",
  projectID: "project-test",
  title: "Native history",
  location: { directory: "/project" },
  model: { providerID: "openai", id: "gpt-5" },
  cost: 0,
  tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1_000, updated: 4_000 },
};
const user = { id: "msg_user", type: "user", text: "Hello", time: { created: 1_100 } };

interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly authorization: string | undefined;
}

const makeHistory = Effect.fn("test.makeOpenCode2History")(function* (
  respond: (request: RecordedRequest) => unknown,
) {
  const requests: RecordedRequest[] = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const recorded = {
        method: request.method,
        path: new URL(request.url).pathname,
        query: new URLSearchParams(UrlParams.toString(request.urlParams)),
        authorization: request.headers.authorization,
      };
      requests.push(recorded);
      const response = respond(recorded);
      return HttpClientResponse.fromWeb(
        request,
        response instanceof Response ? response : Response.json(response),
      );
    }),
  );
  const client = yield* OpenCode2Client.make.pipe(
    Effect.provideService(HttpClient.HttpClient, http),
  );
  const api = yield* client.connect({ baseUrl: "http://opencode.invalid", password: "private" });
  const server = OpenCode2Server.OpenCode2Server.of({
    withConnection: (use) =>
      use({ ...api, url: "http://opencode.invalid", version: "2.0.28", external: true }),
  });
  return { adapter: makeOpenCode2HistorySyncAdapter({ source, server }), requests };
});

it.effect(
  "lists native OpenCode 2 roots with scoped search, opaque cursors and live activity",
  () =>
    Effect.gen(function* () {
      const cursor = SessionsCursor.make({
        anchor: { id: Session.ID.make("ses_history"), time: 4_000, direction: "next" },
        order: "desc",
        parentID: null,
      });
      const { adapter, requests } = yield* makeHistory(({ path, query }) => {
        if (path.endsWith("/active")) return { data: { ses_history: { type: "running" } } };
        assert.equal(query.get("search"), "native");
        assert.equal(query.get("directory"), "/project");
        assert.equal(query.get("parentID"), "null");
        return query.has("cursor")
          ? { data: [], cursor: {} }
          : {
              data: [
                nativeSession,
                { ...nativeSession, id: "ses_child", parentID: "ses_history" },
                {
                  ...nativeSession,
                  id: "ses_archive",
                  time: { ...nativeSession.time, archived: 5_000 },
                },
              ],
              cursor: { next: cursor },
            };
      });
      const page = yield* adapter.list({
        query: "native",
        cwd: "/project",
        includeArchived: false,
        limit: 3,
      });
      assert.deepEqual(page.items, [
        {
          sessionId: "ses_history",
          title: "Native history",
          preview: null,
          cwd: "/project",
          model: "openai/gpt-5",
          createdAt: "1970-01-01T00:00:01.000Z",
          updatedAt: "1970-01-01T00:00:04.000Z",
          archived: false,
          isChild: false,
          activity: "active",
        },
      ]);
      assert.equal(page.nextCursor, cursor);
      const next = yield* adapter.list({
        query: "native",
        cwd: "/project",
        includeArchived: false,
        limit: 3,
        cursor: page.nextCursor,
      });
      assert.deepEqual(next.items, []);
      assert.isUndefined(next.nextCursor);
      assert.equal(requests[2]?.query.get("cursor"), cursor);
      assert.isTrue(
        requests.every((request) => request.path.startsWith("/api/") && request.method === "GET"),
      );
      assert.isTrue(
        requests.every((request) => request.authorization === `Basic ${btoa("opencode:private")}`),
      );
    }),
);

it.effect(
  "reads paged visible messages, native timestamps and image/audio attachments without completing a stream",
  () =>
    Effect.gen(function* () {
      const { adapter, requests } = yield* makeHistory(({ path, query }) => {
        if (path === "/api/session/ses_history") return { data: nativeSession };
        assert.equal(path, "/api/session/ses_history/message");
        assert.equal(query.get("limit"), "100");
        assert.equal(query.get("order"), "asc");
        if (query.has("cursor"))
          return {
            data: [
              {
                id: "msg_done",
                type: "assistant",
                agent: "build",
                model: nativeSession.model,
                content: [
                  { type: "reasoning", text: "private" },
                  { type: "text", text: "Done" },
                  {
                    type: "tool",
                    id: "audio-call",
                    name: "audio",
                    time: { created: 2_100, completed: 2_400 },
                    state: {
                      status: "completed",
                      input: {},
                      content: [
                        { type: "text", text: "internal tool output" },
                        {
                          type: "file",
                          uri: "data:audio/wav;base64,b3V0cHV0",
                          mime: "audio/wav",
                          name: "output.wav",
                        },
                      ],
                    },
                  },
                ],
                finish: "stop",
                time: { created: 2_000, streamed: 2_500, completed: 3_000 },
              },
              {
                id: "msg_stream",
                type: "assistant",
                agent: "build",
                model: nativeSession.model,
                content: [{ type: "text", text: "Still working" }],
                time: { created: 3_500, streamed: 3_800 },
              },
            ],
            cursor: {},
          };
        return {
          data: [
            {
              ...user,
              files: [
                {
                  mime: "image/png",
                  data: "aW1hZ2U=",
                  source: { type: "inline" },
                  name: "image.png",
                },
                {
                  mime: "audio/wav",
                  data: "",
                  source: { type: "uri", uri: "file:///project/voice%20memo.wav" },
                  name: "voice.wav",
                },
                {
                  mime: "audio/mpeg",
                  data: "",
                  source: { type: "uri", uri: "https://media.invalid/voice.mp3" },
                },
                { mime: "text/plain", data: "text", source: { type: "inline" } },
              ],
            },
            { id: "msg_system", type: "system", text: "instructions", time: { created: 1_000 } },
            {
              id: "msg_synthetic",
              type: "synthetic",
              text: "hidden context",
              time: { created: 1_050 },
            },
          ],
          cursor: { next: "page-two" },
        };
      });
      const transcript = yield* adapter.read({ sessionId: "ses_history" });
      assert.equal(transcript.cwd, "/project");
      assert.equal(transcript.model, "openai/gpt-5");
      assert.equal(transcript.updatedAt, "1970-01-01T00:00:04.000Z");
      assert.deepEqual(
        transcript.items.map((item) =>
          item.kind === "message" ? [item.nativeMessageId, item.text, item.updatedAt] : item.kind,
        ),
        [
          ["msg_user", "Hello", undefined],
          ["msg_done", "Done", "1970-01-01T00:00:03.000Z"],
          ["msg_stream", "Still working", undefined],
        ],
      );
      const first = transcript.items[0];
      assert.equal(first?.kind, "message");
      if (first?.kind !== "message") return;
      assert.deepEqual(
        first.attachments.map((attachment) => [attachment.type, attachment.content]),
        [
          ["image", { type: "data-url", dataUrl: "data:image/png;base64,aW1hZ2U=" }],
          ["audio", { type: "file", path: "/project/voice memo.wav" }],
          ["audio", { type: "url", url: "https://media.invalid/voice.mp3" }],
        ],
      );
      assert.deepEqual(
        first.attachments.map((attachment) => attachment.nativeAttachmentId),
        ["msg_user:file:0", "msg_user:file:1", "msg_user:file:2"],
      );
      const assistant = transcript.items[1];
      assert.equal(assistant?.kind, "message");
      if (assistant?.kind !== "message") return;
      assert.deepEqual(assistant.attachments, [
        {
          type: "audio",
          nativeAttachmentId: "msg_done:tool:audio-call:file:1",
          name: "output.wav",
          mimeType: "audio/wav",
          content: { type: "data-url", dataUrl: "data:audio/wav;base64,b3V0cHV0" },
        },
      ]);
      assert.equal(requests.length, 3);
    }),
);

it.effect(
  "checks native running sessions and preserves resume identity without writing provider state",
  () =>
    Effect.gen(function* () {
      let running = true;
      const { adapter, requests } = yield* makeHistory(() => ({
        data: running ? { ses_history: { type: "running" } } : {},
      }));
      assert.equal(yield* adapter.checkActivity!({ sessionId: "ses_history" }), "active");
      running = false;
      assert.equal(yield* adapter.checkActivity!({ sessionId: "ses_history" }), "idle");
      assert.deepEqual(yield* adapter.resumeCursor({ sessionId: "ses_history" }), {
        resumeCursor: { sessionId: "ses_history" },
      });
      assert.deepEqual(
        requests.map((request) => request.path),
        ["/api/session/active", "/api/session/active"],
      );
    }),
);

it.effect("rejects repeated message cursors instead of importing a truncated transcript", () =>
  Effect.gen(function* () {
    const { adapter, requests } = yield* makeHistory(({ path }) =>
      path.endsWith("/message")
        ? { data: [user], cursor: { next: "repeated" } }
        : { data: nativeSession },
    );
    const error = yield* Effect.flip(adapter.read({ sessionId: "ses_history" }));
    assert.equal(error.operation, "read");
    assert.include(error.detail, "non-advancing");
    assert.equal(requests.length, 3);
  }),
);

it.effect("bounds native transcript requests and rejects oversized pages", () =>
  Effect.gen(function* () {
    let page = 0;
    const bounded = yield* makeHistory(({ path }) =>
      path.endsWith("/message")
        ? { data: [user], cursor: { next: `page-${++page}` } }
        : { data: nativeSession },
    );
    assert.include(
      (yield* Effect.flip(bounded.adapter.read({ sessionId: "ses_history" }))).detail,
      "bounded import size",
    );
    assert.equal(page, 100);
    const oversized = yield* makeHistory(({ path }) =>
      path.endsWith("/message")
        ? { data: Array.from({ length: 101 }, () => user), cursor: {} }
        : { data: nativeSession },
    );
    assert.include(
      (yield* Effect.flip(oversized.adapter.read({ sessionId: "ses_history" }))).detail,
      "page size",
    );
    assert.equal(oversized.requests.length, 2);
  }),
);

it.effect("keeps authentication and wrong-protocol failures explicit at the history boundary", () =>
  Effect.gen(function* () {
    for (const response of [
      Response.json(
        { _tag: "UnauthorizedError", message: "Authentication required" },
        { status: 401 },
      ),
      Response.json([nativeSession]),
    ]) {
      const { adapter, requests } = yield* makeHistory(() => response.clone());
      const error = yield* Effect.flip(adapter.list({ includeArchived: false, limit: 10 }));
      assert.equal(error.sourceId, source.sourceId);
      assert.equal(error.operation, "list");
      assert.isDefined(error.cause);
      assert.equal(requests.length, 1);
    }
  }),
);

it.effect("rejects a transcript returned for another session before fetching its messages", () =>
  Effect.gen(function* () {
    const { adapter, requests } = yield* makeHistory(() => ({
      data: { ...nativeSession, id: "ses_other" },
    }));
    const error = yield* Effect.flip(adapter.read({ sessionId: "ses_history" }));
    assert.include(error.detail, "different history session");
    assert.equal(requests.length, 1);
  }),
);
