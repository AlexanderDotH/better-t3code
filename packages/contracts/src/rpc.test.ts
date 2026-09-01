import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  WS_METHODS,
  WsKnowledgeGraphCancelRpc,
  WsKnowledgeGraphClearRpc,
  WsKnowledgeGraphNodeContentRpc,
  WsKnowledgeGraphPauseRpc,
  WsKnowledgeGraphQueryRpc,
  WsKnowledgeGraphRebuildRpc,
  WsKnowledgeGraphSubscribeRpc,
  WsSubscribeServerConfigRpc,
} from "./rpc.ts";

const decodeSubscribeServerConfig = Schema.decodeUnknownSync(
  WsSubscribeServerConfigRpc.payloadSchema,
);
const decodeKnowledgeGraphSubscribe = Schema.decodeUnknownSync(
  WsKnowledgeGraphSubscribeRpc.payloadSchema,
);
const decodeKnowledgeGraphQuery = Schema.decodeUnknownSync(WsKnowledgeGraphQueryRpc.payloadSchema);
const decodeKnowledgeGraphNodeContent = Schema.decodeUnknownSync(
  WsKnowledgeGraphNodeContentRpc.payloadSchema,
);
const decodeKnowledgeGraphRebuild = Schema.decodeUnknownSync(
  WsKnowledgeGraphRebuildRpc.payloadSchema,
);
const decodeKnowledgeGraphCancel = Schema.decodeUnknownSync(
  WsKnowledgeGraphCancelRpc.payloadSchema,
);
const decodeKnowledgeGraphPause = Schema.decodeUnknownSync(WsKnowledgeGraphPauseRpc.payloadSchema);
const decodeKnowledgeGraphClear = Schema.decodeUnknownSync(WsKnowledgeGraphClearRpc.payloadSchema);

/**
 * The client always sends `environmentThemes`, including to servers built
 * before the field existed, whose payload schema was an empty struct. What
 * makes that safe is that such a schema accepts the request rather than
 * rejecting it -- an error here would take down the config subscription.
 */
describe("subscribeServerConfig payload compatibility", () => {
  it("is accepted by a server whose schema predates the field", () => {
    const oldServerPayload = Schema.Struct({});
    const decoded = Schema.decodeUnknownExit(oldServerPayload)({ environmentThemes: true });
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
