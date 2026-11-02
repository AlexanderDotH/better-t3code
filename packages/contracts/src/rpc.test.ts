import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";
import {
  WsKnowledgeGraphCancelRpc,
  WsKnowledgeGraphClearRpc,
  WsKnowledgeGraphNodeContentRpc,
  WsKnowledgeGraphPauseRpc,
  WsKnowledgeGraphQueryRpc,
  WsKnowledgeGraphRebuildRpc,
  WsKnowledgeGraphSubscribeRpc,
  WsSubscribeServerConfigRpc,
} from "./rpc.ts";
const projectWriteRpc = WsRpcGroup.requests.get(WS_METHODS.projectsWriteFile);
if (projectWriteRpc === undefined) throw new Error("projects.writeFile is not registered");
const decodeProjectWriteError = Schema.decodeSync(projectWriteRpc.errorSchema);

const decodeKnowledgeGraphClear = Schema.decodeUnknownSync(WsKnowledgeGraphClearRpc.payloadSchema);
const decodeKnowledgeGraphPause = Schema.decodeUnknownSync(WsKnowledgeGraphPauseRpc.payloadSchema);
const decodeKnowledgeGraphCancel = Schema.decodeUnknownSync(
  WsKnowledgeGraphCancelRpc.payloadSchema,
);
const decodeKnowledgeGraphRebuild = Schema.decodeUnknownSync(
  WsKnowledgeGraphRebuildRpc.payloadSchema,
);
const decodeKnowledgeGraphNodeContent = Schema.decodeUnknownSync(
  WsKnowledgeGraphNodeContentRpc.payloadSchema,
);
const decodeKnowledgeGraphQuery = Schema.decodeUnknownSync(WsKnowledgeGraphQueryRpc.payloadSchema);
const decodeKnowledgeGraphSubscribe = Schema.decodeUnknownSync(
  WsKnowledgeGraphSubscribeRpc.payloadSchema,
);
const decodeSubscribeServerConfig = Schema.decodeUnknownSync(
  WsSubscribeServerConfigRpc.payloadSchema,
);

describe("WebSocket RPC contracts", () => {
  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decode({
          type: "prepared-run.reasoning.complete",
          commandId: "forged-reasoning",
          threadId: "thread-1",
          runId: "run-1",
          selection: { instanceId: "codex", model: "gpt-6-astra" },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("carries revision conflicts through the project write RPC", () => {
    const decoded = decodeProjectWriteError({
      _tag: "ProjectWriteConflictError",
      cwd: "/workspace",
      relativePath: "notes.txt",
      expectedRevision: "before",
      actualRevision: "after",
    });
    expect(decoded).toMatchObject({ _tag: "ProjectWriteConflictError", actualRevision: "after" });
  });

  it("lets the server pick a new worktree's folder", () => {
    const createWorktree = WsRpcGroup.requests.get(WS_METHODS.vcsCreateWorktree);
    if (createWorktree === undefined) throw new Error("vcs.createWorktree is not registered");
    const decode = Schema.decodeUnknownExit(createWorktree.payloadSchema);
    const request = { cwd: "/repo", refName: "main", newRefName: "feature/x" };

    expect(Exit.isSuccess(decode({ ...request, path: null }))).toBe(true);
    expect(Exit.isFailure(decode({ ...request, path: "/repo/.git/hooks" }))).toBe(true);
  });
});

describe("subscribeServerConfig payload compatibility", () => {
  it("is accepted by a server whose schema predates the field", () => {
    const oldServerPayload = Schema.Struct({});
    const decoded = Schema.decodeExit(oldServerPayload)({ environmentThemes: true });
    expect(Exit.isSuccess(decoded)).toBe(true);
  });

  it("is carried by a server that declares it", () => {
    const decoded = decodeSubscribeServerConfig({
      environmentThemes: true,
    });
    expect(decoded).toEqual({ environmentThemes: true });
  });

  it("stays optional, so a client that never sends it still subscribes", () => {
    const decoded = decodeSubscribeServerConfig({});
    expect(decoded).toEqual({});
  });
});

describe("Knowledge Graph RPC compatibility", () => {
  it("uses a version-gated method family without accepting client workspace roots", () => {
    expect(WS_METHODS.knowledgeGraphSubscribe).toBe("knowledgeGraph.subscribe");
    const decoded = decodeKnowledgeGraphSubscribe({
      scope: {
        projectId: "project-1",
        threadId: "thread-1",
        effectiveWorkspaceRoot: "/untrusted",
      },
      afterRevision: 4,
    });
    expect(decoded).toEqual({
      scope: { projectId: "project-1", threadId: "thread-1" },
      afterRevision: 4,
    });
  });

  it("bounds the shared query batch at the RPC boundary", () => {
    expect(() =>
      decodeKnowledgeGraphQuery({
        scope: { projectId: "project-1" },
        queries: Array.from({ length: 9 }, (_, index) => ({
          id: `query-${index}`,
          type: "overview",
        })),
      }),
    ).toThrow();
  });

  it("declares and validates the complete read and lifecycle method family", () => {
    expect(
      [
        WsKnowledgeGraphSubscribeRpc,
        WsKnowledgeGraphQueryRpc,
        WsKnowledgeGraphNodeContentRpc,
        WsKnowledgeGraphRebuildRpc,
        WsKnowledgeGraphCancelRpc,
        WsKnowledgeGraphPauseRpc,
        WsKnowledgeGraphClearRpc,
      ].map((rpc) => rpc._tag),
    ).toEqual([
      WS_METHODS.knowledgeGraphSubscribe,
      WS_METHODS.knowledgeGraphQuery,
      WS_METHODS.knowledgeGraphNodeContent,
      WS_METHODS.knowledgeGraphRebuild,
      WS_METHODS.knowledgeGraphCancel,
      WS_METHODS.knowledgeGraphPause,
      WS_METHODS.knowledgeGraphClear,
    ]);

    const untrustedScope = {
      projectId: "project-1",
      threadId: "thread-1",
      effectiveWorkspaceRoot: "/untrusted",
    };
    expect(decodeKnowledgeGraphNodeContent({ scope: untrustedScope, nodeId: "node-1" })).toEqual({
      scope: { projectId: "project-1", threadId: "thread-1" },
      nodeId: "node-1",
    });
    expect(decodeKnowledgeGraphRebuild({ scope: untrustedScope, mode: "full" })).toEqual({
      scope: { projectId: "project-1", threadId: "thread-1" },
      mode: "full",
    });
    expect(decodeKnowledgeGraphCancel({ scope: untrustedScope })).toEqual({
      scope: { projectId: "project-1", threadId: "thread-1" },
    });
    expect(decodeKnowledgeGraphPause({ scope: untrustedScope, paused: true })).toEqual({
      scope: { projectId: "project-1", threadId: "thread-1" },
      paused: true,
    });
    expect(decodeKnowledgeGraphClear({ target: "scope", scope: untrustedScope })).toEqual({
      target: "scope",
      scope: { projectId: "project-1", threadId: "thread-1" },
    });
    expect(decodeKnowledgeGraphClear({ target: "environment" })).toEqual({
      target: "environment",
    });
    expect(() => decodeKnowledgeGraphRebuild({ scope: untrustedScope, mode: "unsafe" })).toThrow();
    expect(() => decodeKnowledgeGraphClear({ target: "filesystem" })).toThrow();
  });
});
