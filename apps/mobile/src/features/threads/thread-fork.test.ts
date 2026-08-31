import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import {
  buildMobileThreadForkCommand,
  findForkDividerEntryId,
  forkBoundaryKey,
  MOBILE_THREAD_FORK_MESSAGE_KEYS,
  mobileForkedThreadRoute,
  mobileThreadForkingSupported,
  resolveForkActionPresentation,
  resolveForkBoundary,
  resolveForkComposerBudget,
  resolveForkWorkspace,
  threadFeedEntryIsInherited,
} from "./thread-fork";

describe("mobile thread fork presentation", () => {
  it("requires the explicit capability and exposes typed accessible copy", () => {
    expect(mobileThreadForkingSupported({})).toBe(false);
    expect(mobileThreadForkingSupported({ threadForking: false })).toBe(false);
    expect(mobileThreadForkingSupported({ threadForking: true })).toBe(true);
    expect(MOBILE_THREAD_FORK_MESSAGE_KEYS).toEqual({
      forkHere: "mobile.thread.forkHere",
      forkedFrom: "mobile.thread.forkedFrom",
      forkStarts: "mobile.thread.forkStarts",
    });
  });

  it("offers exact boundaries for committed user, completed assistant, and plan entries", () => {
    expect(
      resolveForkBoundary({
        type: "message",
        message: { id: "user-1", role: "user", streaming: false },
      }),
    ).toEqual({ kind: "message", messageId: "user-1" });
    expect(
      resolveForkBoundary({
        type: "message",
        message: { id: "assistant-1", role: "assistant", streaming: false },
      }),
    ).toEqual({ kind: "message", messageId: "assistant-1" });
    expect(resolveForkBoundary({ type: "proposed-plan", proposedPlan: { id: "plan-1" } })).toEqual({
      kind: "proposed-plan",
      planId: "plan-1",
    });
    expect(
      resolveForkBoundary({
        type: "message",
        message: {
          id: "nested-history",
          role: "assistant",
          streaming: false,
          historyOrigin: { sourceThreadId: "older", sourceId: "original", ordinal: 4 },
        },
      }),
    ).toEqual({ kind: "message", messageId: "nested-history" });
  });

  it("hides boundaries for streaming or non-conversation messages", () => {
    expect(
      resolveForkBoundary({
        type: "message",
        message: { id: "assistant-stream", role: "assistant", streaming: true },
      }),
    ).toBeNull();
    expect(
      resolveForkBoundary({
        type: "message",
        message: { id: "system-1", role: "system", streaming: false },
      }),
    ).toBeNull();
    expect(resolveForkBoundary({ type: "working" })).toBeNull();
  });

  it("hides unsupported actions and disables live or duplicate dispatch failures", () => {
    const boundary = { kind: "message", messageId: MessageId.make("message-1") } as const;

    expect(
      resolveForkActionPresentation({
        boundary,
        supported: false,
        connected: true,
        pendingBoundaryKey: null,
      }),
    ).toEqual({ visible: false, disabled: true, busy: false });
    expect(
      resolveForkActionPresentation({
        boundary,
        supported: true,
        connected: false,
        pendingBoundaryKey: null,
      }),
    ).toEqual({ visible: true, disabled: true, busy: false });
    expect(
      resolveForkActionPresentation({
        boundary,
        supported: true,
        connected: true,
        pendingBoundaryKey: forkBoundaryKey(boundary),
      }),
    ).toEqual({ visible: true, disabled: true, busy: true });
  });

  it("resolves ordinary new-thread workspace defaults and a stable base", () => {
    expect(
      resolveForkWorkspace({
        projectSetting: "worktree",
        projectFile: "local",
        globalDefault: "local",
        startFromOrigin: true,
        refs: [
          {
            name: "feature/current",
            current: true,
            isDefault: false,
            worktreePath: "/repo",
          },
          {
            name: "main",
            current: false,
            isDefault: true,
            worktreePath: null,
          },
        ],
      }),
    ).toEqual({
      mode: "worktree",
      baseBranch: "main",
      startFromOrigin: true,
      runSetupScript: true,
    });

    expect(
      resolveForkWorkspace({
        projectSetting: null,
        projectFile: "local",
        globalDefault: "worktree",
        startFromOrigin: false,
        refs: [],
      }),
    ).toEqual({
      mode: "local",
      baseBranch: null,
      startFromOrigin: false,
      runSetupScript: false,
    });
  });

  it("marks inherited rows immutable and places the divider after the greatest ordinal", () => {
    const inherited = {
      type: "message",
      id: "history-message",
      message: {
        historyOrigin: { sourceThreadId: "source", sourceId: "old-message", ordinal: 4 },
      },
    };
    const inheritedWork = {
      type: "activity-group",
      id: "history-work",
      activities: [
        {
          historyOrigin: { sourceThreadId: "source", sourceId: "old-work", ordinal: 7 },
        },
      ],
    };
    const current = { type: "message", id: "current-message", message: {} };

    expect(threadFeedEntryIsInherited(inherited)).toBe(true);
    expect(threadFeedEntryIsInherited(current)).toBe(false);
    expect(findForkDividerEntryId([inherited, inheritedWork, current])).toBe("history-work");
  });

  it("uses ordinary first-turn limits while inherited context stays separate", () => {
    expect(
      resolveForkComposerBudget({
        handoff: {
          status: "pending",
          remainingInputChars: 10,
          remainingAttachmentCount: 1,
        },
        draftMessage: "x".repeat(120_001),
        draftAttachmentCount: 9,
      }),
    ).toEqual({
      active: true,
      promptRemaining: -1,
      attachmentRemaining: -1,
      promptExceededBy: 1,
      attachmentsExceededBy: 1,
      canSend: false,
      canAddAttachment: false,
    });

    expect(
      resolveForkComposerBudget({
        handoff: {
          status: "completed",
          remainingInputChars: 0,
          remainingAttachmentCount: 0,
        },
        draftMessage: "later turn",
        draftAttachmentCount: 3,
      }),
    ).toBeNull();
  });

  it("builds one exact fork command and a composer-focused destination route", () => {
    const destinationThreadId = ThreadId.make("forked-thread");
    const environmentId = EnvironmentId.make("environment-a");
    expect(
      buildMobileThreadForkCommand({
        thread: {
          environmentId,
          id: ThreadId.make("source-thread"),
          projectId: ProjectId.make("project-a"),
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
        },
        destinationThreadId,
        boundary: { kind: "message", messageId: MessageId.make("message-a") },
        workspace: {
          mode: "worktree",
          baseBranch: "main",
          startFromOrigin: true,
          runSetupScript: true,
        },
      }),
    ).toEqual({
      environmentId: "environment-a",
      input: {
        threadId: "forked-thread",
        sourceThreadId: "source-thread",
        boundary: { kind: "message", messageId: "message-a" },
        modelSelection: { instanceId: "codex", model: "gpt-5.6" },
        runtimeMode: "full-access",
        interactionMode: "default",
        workspace: {
          mode: "worktree",
          baseBranch: "main",
          startFromOrigin: true,
          runSetupScript: true,
        },
      },
    });
    expect(mobileForkedThreadRoute({ environmentId, destinationThreadId })).toEqual({
      screen: "Thread",
      params: {
        environmentId: "environment-a",
        threadId: "forked-thread",
        focusComposer: true,
      },
    });
  });
});
