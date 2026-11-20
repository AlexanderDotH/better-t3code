import { CommandId, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildDeepPlanStartCommand } from "./deepPlanningTurn.ts";

describe("Deep Plan start command", () => {
  const command = {
    commandId: CommandId.make("start"),
    threadId: ThreadId.make("owner"),
    createdAt: "2026-10-16T08:00:00.000Z",
  };
  const local = {
    environmentId: EnvironmentId.make("local"),
    projectId: ProjectId.make("project"),
    threadId: ThreadId.make("chat"),
  };
  const peer = { ...local, environmentId: EnvironmentId.make("peer") };

  it("starts without project chats or a client-assigned run ID", () => {
    expect(buildDeepPlanStartCommand(command)).toEqual({
      type: "thread.deep-plan.start",
      ...command,
      chats: [],
      includeProjectChats: false,
    });
  });

  it("keeps a peer chat distinct from a local chat and preserves project-chat opt-in", () => {
    expect(
      buildDeepPlanStartCommand({
        ...command,
        includeProjectChats: true,
        chats: [local, peer, local],
      }),
    ).toMatchObject({ includeProjectChats: true, chats: [local, peer] });
  });
});
