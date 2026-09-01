import {
  HarnessChatContinuationKey,
  HarnessChatSessionId,
  HarnessChatSyncSourceId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionHarnessChatSyncRepositoryLive } from "./ProjectionHarnessChatSync.ts";
import { ProjectionHarnessChatSyncRepository } from "../Services/ProjectionHarnessChatSync.ts";

it.effect("finds a harness history link by thread, source, and continuation identity", () =>
  Effect.gen(function* () {
    const repository = yield* ProjectionHarnessChatSyncRepository;
    const threadId = ThreadId.make("thread-1");
    const sourceId = HarnessChatSyncSourceId.make("codex-home");
    const continuationKey = HarnessChatContinuationKey.make("codex:/tmp/home");
    const nativeSessionId = HarnessChatSessionId.make("native-session-1");

    yield* repository.upsertLink({
      threadId,
      projectId: ProjectId.make("project-1"),
      sourceId,
      continuationKey,
      nativeSessionId,
      providerInstanceId: ProviderInstanceId.make("codex-work"),
      providerLabel: "Codex Work",
      activity: "idle",
      sourceUpdatedAt: "2026-08-23T10:00:00.000Z",
      lastSyncedAt: "2026-08-23T10:01:00.000Z",
    });

    const [byThread, bySource, byContinuation, byContinuationList, bySourceList] =
      yield* Effect.all([
        repository.getLinkByThreadId({ threadId }),
        repository.getLinkBySourceSession({ sourceId, nativeSessionId }),
        repository.getLinkByContinuationSession({ continuationKey, nativeSessionId }),
        repository.listLinksByContinuationKey({ continuationKey }),
        repository.listLinksBySourceId({ sourceId }),
      ]);

    assert.strictEqual(Option.getOrThrow(byThread).providerLabel, "Codex Work");
    assert.strictEqual(Option.getOrThrow(bySource).threadId, threadId);
    assert.strictEqual(Option.getOrThrow(byContinuation).threadId, threadId);
    assert.strictEqual(byContinuationList[0]?.projectId, "project-1");
    assert.strictEqual(bySourceList[0]?.projectId, "project-1");
  }).pipe(
    Effect.provide(ProjectionHarnessChatSyncRepositoryLive),
    Effect.provide(SqlitePersistenceMemory),
  ),
);

it.effect("keeps the first local mapping when the same native message is replayed", () =>
  Effect.gen(function* () {
    const repository = yield* ProjectionHarnessChatSyncRepository;
    const threadId = ThreadId.make("thread-1");

    yield* repository.upsertMessageLink({
      threadId,
      nativeMessageId: "native-message-1",
      messageId: MessageId.make("message-original"),
      linkedAt: "2026-08-23T10:01:00.000Z",
    });
    yield* repository.upsertMessageLink({
      threadId,
      nativeMessageId: "native-message-1",
      messageId: MessageId.make("message-replayed"),
      linkedAt: "2026-08-23T10:02:00.000Z",
    });

    const mapping = yield* repository.getMessageLink({
      threadId,
      nativeMessageId: "native-message-1",
    });
    const mappings = yield* repository.listMessageLinksByThreadId({ threadId });

    assert.strictEqual(Option.getOrThrow(mapping).messageId, "message-original");
    assert.deepStrictEqual(
      mappings.map((entry) => entry.nativeMessageId),
      ["native-message-1"],
    );
  }).pipe(
    Effect.provide(ProjectionHarnessChatSyncRepositoryLive),
    Effect.provide(SqlitePersistenceMemory),
  ),
);

it.effect("does not let an older status refresh replace a newer link", () =>
  Effect.gen(function* () {
    const repository = yield* ProjectionHarnessChatSyncRepository;
    const base = {
      threadId: ThreadId.make("thread-status"),
      projectId: ProjectId.make("project-1"),
      sourceId: HarnessChatSyncSourceId.make("codex-home"),
      continuationKey: HarnessChatContinuationKey.make("codex:/tmp/home"),
      nativeSessionId: HarnessChatSessionId.make("native-session-status"),
      providerInstanceId: ProviderInstanceId.make("codex-work"),
      providerLabel: "Codex Work",
      sourceUpdatedAt: "2026-08-23T10:02:00.000Z",
    } as const;

    yield* repository.upsertLink({
      ...base,
      activity: "idle",
      lastSyncedAt: "2026-08-23T10:02:00.000Z",
    });
    yield* repository.upsertLink({
      ...base,
      activity: "active",
      lastSyncedAt: "2026-08-23T10:01:00.000Z",
    });

    const link = yield* repository.getLinkByThreadId({ threadId: base.threadId });
    assert.strictEqual(Option.getOrThrow(link).activity, "idle");
    assert.strictEqual(Option.getOrThrow(link).lastSyncedAt, "2026-08-23T10:02:00.000Z");

    yield* repository.upsertLink({
      ...base,
      activity: "active",
      lastSyncedAt: "2026-08-23T10:02:00.000Z",
    });
    const refreshedStatus = yield* repository.getLinkByThreadId({ threadId: base.threadId });
    assert.strictEqual(Option.getOrThrow(refreshedStatus).activity, "active");
  }).pipe(
    Effect.provide(ProjectionHarnessChatSyncRepositoryLive),
    Effect.provide(SqlitePersistenceMemory),
  ),
);
