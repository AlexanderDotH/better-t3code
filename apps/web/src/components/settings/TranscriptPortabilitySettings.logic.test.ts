import { EnvironmentId, ProviderInstanceId, ThreadId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildTranscriptPortabilityOptions,
  isTranscriptExportPending,
  type TranscriptPortabilityThread,
} from "./TranscriptPortabilitySettings.logic";

describe("buildTranscriptPortabilityOptions", () => {
  it("lists active threads from capable environments newest first without changing the input", () => {
    const capable = EnvironmentId.make("capable");
    const unsupported = EnvironmentId.make("unsupported");
    const threads = [
      {
        environmentId: capable,
        id: ThreadId.make("older"),
        title: "Older",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archivedAt: null,
        latestRun: null,
        runtime: null,
      },
      {
        environmentId: capable,
        id: ThreadId.make("newer"),
        title: "Newer",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archivedAt: null,
        latestRun: null,
        runtime: null,
      },
      {
        environmentId: unsupported,
        id: ThreadId.make("unsupported"),
        title: "Unsupported",
        updatedAt: "2026-08-03T00:00:00.000Z",
        archivedAt: null,
        latestRun: null,
        runtime: null,
      },
      {
        environmentId: capable,
        id: ThreadId.make("archived"),
        title: "Archived",
        updatedAt: "2026-08-04T00:00:00.000Z",
        archivedAt: "2026-08-05T00:00:00.000Z",
        latestRun: null,
        runtime: null,
      },
    ];

    const options = buildTranscriptPortabilityOptions(threads, new Set([capable]), null);

    expect(options.map(({ id }) => id)).toEqual(["newer", "older"]);
    expect(threads.map(({ id }) => id)).toEqual(["older", "newer", "unsupported", "archived"]);
  });

  it("respects the selected machine even when thread IDs are shared", () => {
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    const threads = [local, remote].map((environmentId) => ({
      environmentId,
      id: ThreadId.make("shared-thread-id"),
      title: "Thread",
      updatedAt: "2026-08-01T00:00:00.000Z",
      archivedAt: null,
      latestRun: null,
      runtime: null,
    }));
    const supported = new Set([local, remote]);

    expect(buildTranscriptPortabilityOptions(threads, supported, local)).toEqual([threads[0]]);
    expect(buildTranscriptPortabilityOptions(threads, supported, remote)).toEqual([threads[1]]);
    expect(buildTranscriptPortabilityOptions(threads, supported, null)).toEqual(threads);
    expect(buildTranscriptPortabilityOptions(threads, new Set([local]), remote)).toEqual([]);
  });
});

describe("isTranscriptExportPending", () => {
  const completedRun: NonNullable<TranscriptPortabilityThread["latestRun"]> = {
    runId: RunId.make("turn"),
    status: "completed",
    requestedAt: "2026-08-01T00:00:00.000Z",
    startedAt: "2026-08-01T00:00:01.000Z",
    completedAt: "2026-08-01T00:00:02.000Z",
    assistantMessageId: null,
  };
  const idleRuntime = {
    status: "idle",
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: "Codex",
    lastError: null,
    updatedAt: "2026-08-01T00:00:02.000Z",
  } as const;

  it("blocks queued and unsettled turns even when the runtime is ready", () => {
    expect(isTranscriptExportPending({ latestRun: null, runtime: idleRuntime })).toBe(true);
    expect(
      isTranscriptExportPending({
        latestRun: { ...completedRun, status: "queued", startedAt: null, completedAt: null },
        runtime: idleRuntime,
      }),
    ).toBe(true);
    expect(
      isTranscriptExportPending({
        latestRun: { ...completedRun, status: "running", completedAt: null },
        runtime: idleRuntime,
      }),
    ).toBe(true);
  });

  it("waits for starting or running runtimes even with a completed checkpoint", () => {
    for (const status of ["starting", "running"] as const) {
      expect(
        isTranscriptExportPending({
          latestRun: completedRun,
          runtime: { ...idleRuntime, status, activeRunId: completedRun.runId },
        }),
      ).toBe(true);
    }
  });

  it("allows export after the latest turn settles", () => {
    expect(isTranscriptExportPending({ latestRun: completedRun, runtime: idleRuntime })).toBe(
      false,
    );
    expect(isTranscriptExportPending({ latestRun: completedRun, runtime: null })).toBe(false);
  });
});
