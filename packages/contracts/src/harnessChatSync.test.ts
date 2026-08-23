import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  HarnessChatLink,
  HarnessChatSelection,
  HarnessChatSyncListResult,
  HarnessChatSyncRunResult,
  HarnessChatSyncSourcesResult,
  HarnessChatSyncStatusInput,
  HarnessChatSyncStatusResult,
  HarnessChatTargetProject,
} from "./harnessChatSync.ts";

const decodeSourcesResult = Schema.decodeUnknownSync(HarnessChatSyncSourcesResult);
const decodeSelection = Schema.decodeUnknownSync(HarnessChatSelection);
const decodeTargetProject = Schema.decodeUnknownSync(HarnessChatTargetProject);
const decodeLink = Schema.decodeUnknownSync(HarnessChatLink);
const decodeListResult = Schema.decodeUnknownSync(HarnessChatSyncListResult);
const decodeRunResult = Schema.decodeUnknownSync(HarnessChatSyncRunResult);
const decodeStatusResult = Schema.decodeUnknownSync(HarnessChatSyncStatusResult);
const decodeStatusInput = Schema.decodeUnknownSync(HarnessChatSyncStatusInput);

describe("harness chat sync contracts", () => {
  it("decodes a supported provider source without naming a built-in driver", () => {
    const result = decodeSourcesResult({
      sources: [
        {
          id: "remote-codex-home",
          continuationKey: "codex:/srv/codex-home",
          label: "Work Codex",
          driver: "customHarness",
          instanceIds: ["custom_work"],
          preferredInstanceId: "custom_work",
          status: { kind: "supported", supportsActivityStatus: true },
          chatCount: 12,
          changedCount: 3,
          latestUpdatedAt: "2026-08-22T19:00:00.000Z",
        },
      ],
    });

    expect(result.sources[0]?.driver).toBe("customHarness");
    expect(result.sources[0]?.status).toEqual({
      kind: "supported",
      supportsActivityStatus: true,
    });
  });

  it("keeps all-matching exclusions distinct from an explicit-only selection", () => {
    expect(
      decodeSelection({
        mode: "allMatching",
        query: "release",
        includeArchived: false,
        excludedSessionIds: ["session-2"],
      }),
    ).toEqual({
      mode: "allMatching",
      query: "release",
      includeArchived: false,
      excludedSessionIds: ["session-2"],
    });
    expect(decodeSelection({ mode: "only", sessionIds: ["session-1"] })).toEqual({
      mode: "only",
      sessionIds: ["session-1"],
    });
  });

  it("allows a chat view to refresh activity by local thread id without exposing native ids", () => {
    expect(decodeStatusInput({ threadId: "thread-1" })).toEqual({ threadId: "thread-1" });
    expect(decodeStatusInput({ sourceId: "source-1", sessionIds: ["session-1"] })).toEqual({
      sourceId: "source-1",
      sessionIds: ["session-1"],
    });
  });

  it("decodes every project-resolution state used by the clients", () => {
    expect(decodeTargetProject({ kind: "existing", projectId: "project-1" }).kind).toBe("existing");
    expect(
      decodeTargetProject({
        kind: "create",
        rootPath: "/workspace/new-project",
        suggestedName: "new-project",
      }).kind,
    ).toBe("create");
    expect(
      decodeTargetProject({ kind: "unresolved", sourceCwd: "/workspace/missing-project" }).kind,
    ).toBe("unresolved");
  });

  it("decodes paginated summaries and compact linked-thread metadata", () => {
    const link = {
      sourceId: "remote-codex-home",
      nativeSessionId: "session-1",
      threadId: "thread-1",
      projectId: "project-1",
      providerInstanceId: "custom_work",
      providerLabel: "Work Codex",
      activity: "idle",
      sourceUpdatedAt: "2026-08-22T19:00:00.000Z",
      lastSyncedAt: "2026-08-22T19:01:00.000Z",
    };
    expect(decodeLink(link).threadId).toBe("thread-1");

    const result = decodeListResult({
      chats: [
        {
          sessionId: "session-1",
          title: "Ship release",
          preview: "Prepare the release notes",
          cwd: "/workspace/project",
          model: "gpt-5.6",
          updatedAt: "2026-08-22T19:00:00.000Z",
          archived: false,
          messageCount: 8,
          hasChanges: true,
          activity: "idle",
          targetProject: { kind: "existing", projectId: "project-1" },
          link,
        },
      ],
      nextCursor: "page-2",
      totalMatching: 12,
      changedMatching: 3,
    });

    expect(result.chats[0]?.link?.nativeSessionId).toBe("session-1");
    expect(result.nextCursor).toBe("page-2");
  });

  it("decodes partial run failures without discarding successful sessions", () => {
    const result = decodeRunResult({
      selectedCount: 2,
      syncedCount: 1,
      failedCount: 1,
      threadsCreated: 1,
      threadsUpdated: 0,
      messagesImported: 8,
      attachmentsImported: 1,
      attachmentsSkipped: 0,
      items: [
        {
          sessionId: "session-1",
          threadId: "thread-1",
          projectId: "project-1",
          created: true,
          messagesImported: 8,
          attachmentsImported: 1,
          attachmentsSkipped: 0,
          link: {
            sourceId: "remote-codex-home",
            nativeSessionId: "session-1",
            threadId: "thread-1",
            projectId: "project-1",
            providerInstanceId: "custom_work",
            providerLabel: "Work Codex",
            activity: "idle",
            sourceUpdatedAt: "2026-08-22T19:00:00.000Z",
            lastSyncedAt: "2026-08-22T19:01:00.000Z",
          },
        },
      ],
      failures: [
        {
          sessionId: "session-2",
          code: "target-unresolved",
          message: "Choose a project before syncing this chat.",
          retryable: true,
        },
      ],
    });

    expect(result.syncedCount).toBe(1);
    expect(result.failures[0]?.code).toBe("target-unresolved");
  });

  it("decodes refreshed activity without exposing native resume cursors", () => {
    const result = decodeStatusResult({
      statuses: [
        {
          sessionId: "session-1",
          activity: "active",
          sourceUpdatedAt: "2026-08-22T19:02:00.000Z",
          hasChanges: true,
          link: null,
        },
      ],
    });

    expect(result.statuses[0]?.activity).toBe("active");
    expect(result.statuses[0]).not.toHaveProperty("resumeCursor");
  });
});
