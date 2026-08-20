import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";

import { buildProjectThreadStartTurnInput } from "./projectThreadStartTurn";

describe("buildProjectThreadStartTurnInput", () => {
  it("uses the durable selection for bootstrap and the transient selection for the first turn", () => {
    const durableModelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "max" }],
    } as const;
    const turnModelSelection = {
      ...durableModelSelection,
      options: [{ id: "reasoningEffort", value: "high" }],
    } as const;

    const input = buildProjectThreadStartTurnInput({
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      threadId: "thread-1",
      commandId: "command-1",
      messageId: "message-1",
      createdAt: "2026-07-31T12:00:00.000Z",
      text: "Explore the repo",
      attachments: [],
      durableModelSelection,
      turnModelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      workspaceMode: "local",
      branch: "main",
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "unused",
    });

    expect(input.modelSelection).toEqual(turnModelSelection);
    expect(input.bootstrap.createThread.modelSelection).toEqual(durableModelSelection);
  });

  it("forwards repository Fetch on the first turn without storing it in thread metadata", () => {
    const durableModelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    } as const;

    const input = buildProjectThreadStartTurnInput({
      projectId: ProjectId.make("project-1"),
      projectCwd: "/repo",
      threadId: "thread-1",
      commandId: "command-1",
      messageId: "message-1",
      createdAt: "2026-07-31T12:00:00.000Z",
      text: "Explore the repo",
      attachments: [],
      durableModelSelection,
      fetchMode: "repository-exploration",
      runtimeMode: "approval-required",
      interactionMode: "default",
      workspaceMode: "local",
      branch: "main",
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "unused",
    });

    expect(input.fetchMode).toBe("repository-exploration");
    expect(input.bootstrap.createThread).not.toHaveProperty("fetchMode");
  });
});
