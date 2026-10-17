// @effect-diagnostics nodeBuiltinImport:off - These fixtures exercise the worker's real-filesystem boundary.
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  KnowledgeGraphEvidenceId,
  KnowledgeGraphScopeId,
  ProjectId,
} from "@t3tools/contracts";

import { type KnowledgeGraphDeterministicExtractionResult } from "./KnowledgeGraphDeterministicExtractor.ts";
import {
  encodeKnowledgeGraphWorkerChunks,
  runKnowledgeGraphExtractionWorker,
} from "./KnowledgeGraphExtractionWorker.ts";
import {
  decodeKnowledgeGraphWorkerChunk,
  decodeKnowledgeGraphWorkerResponse,
  KNOWLEDGE_GRAPH_WORKER_MAX_PAYLOAD_BYTES,
  type KnowledgeGraphWorkerResponse,
} from "./KnowledgeGraphWorkerProtocol.ts";

const truncation = {
  eligibleFiles: false,
  nodes: false,
  visibleNodes: false,
  omittedFileCount: 0,
  omittedNodeCount: 0,
};

it("bounds UTF-8 IPC payloads while retaining every record", () => {
  const result = {
    nodes: [],
    edges: [],
    fileFingerprints: [],
    evidence: Array.from({ length: 100 }, (_, index) => ({
      version: 1,
      evidenceId: KnowledgeGraphEvidenceId.make(`kg:evidence:${index}`),
      scopeId: KnowledgeGraphScopeId.make("kg:worker"),
      kind: "source",
      excerpt: "😀".repeat(3_000),
      fingerprint: "fingerprint",
      confidence: 1,
      evidenceRevision: 0,
    })),
    truncation,
  } satisfies KnowledgeGraphDeterministicExtractionResult;
  const chunks = [...encodeKnowledgeGraphWorkerChunks(result)];
  expect(chunks.length).toBeGreaterThan(1);
  const evidence = [];
  for (const payload of chunks) {
    expect(payload.byteLength).toBeLessThanOrEqual(KNOWLEDGE_GRAPH_WORKER_MAX_PAYLOAD_BYTES);
    const decoded = decodeKnowledgeGraphWorkerChunk(new TextDecoder().decode(payload));
    expect(decoded.section).toBe("evidence");
    evidence.push(...decoded.items);
  }
  expect(evidence).toEqual(result.evidence);
});

class RecordingPort extends NodeEvents.EventEmitter {
  readonly responses: KnowledgeGraphWorkerResponse[] = [];
  readonly first = Promise.withResolvers<KnowledgeGraphWorkerResponse>();
  readonly second = Promise.withResolvers<KnowledgeGraphWorkerResponse>();
  readonly completed = Promise.withResolvers<KnowledgeGraphWorkerResponse>();
  autoAcknowledge = false;

  postMessage(value: unknown): void {
    const response = decodeKnowledgeGraphWorkerResponse(value);
    this.responses.push(response);
    if (this.responses.length === 1) this.first.resolve(response);
    if (this.responses.length === 2) this.second.resolve(response);
    if (response.type === "done" || response.type === "error") this.completed.resolve(response);
    if (response.type === "chunk" && this.autoAcknowledge) {
      queueMicrotask(() => this.acknowledge(response));
    }
  }

  acknowledge(response: Extract<KnowledgeGraphWorkerResponse, { readonly type: "chunk" }>): void {
    this.emit("message", {
      type: "ack",
      jobId: response.jobId,
      generation: response.generation,
      sequence: response.sequence,
    });
  }
}

it("sends one chunk at a time and requires the current generation's acknowledgement", async () => {
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-kg-worker-ipc-"));
  const workspaceRoot = await NodeFSP.realpath(temporary);
  const port = new RecordingPort();
  try {
    await NodeFSP.writeFile(
      NodePath.join(workspaceRoot, "index.ts"),
      'import React from "react";\nexport const application = React;\n',
    );
    runKnowledgeGraphExtractionWorker(port);
    port.emit("message", {
      type: "extract",
      jobId: 4,
      generation: 8,
      input: {
        scope: {
          version: 1,
          scopeId: KnowledgeGraphScopeId.make("kg:backpressure"),
          environmentId: EnvironmentId.make("environment-test"),
          projectId: ProjectId.make("project-test"),
          effectiveWorkspaceRoot: workspaceRoot,
          isWorktree: false,
        },
        workspaceRoot,
        coChangeGroups: [],
        maxNodes: 100,
        maxEligibleFiles: 100,
        seenGeneration: 3,
      },
    });
    const first = await port.first.promise;
    expect(first.type).toBe("chunk");
    expect(port.responses).toHaveLength(1);
    if (first.type !== "chunk") throw new Error("The worker did not produce its first chunk.");
    expect(() =>
      port.emit("message", {
        type: "ack",
        jobId: first.jobId,
        generation: first.generation - 1,
        sequence: first.sequence,
      }),
    ).toThrow("does not match the active job");
    port.acknowledge(first);
    const second = await port.second.promise;
    expect(second.type).toBe("chunk");
    expect(port.responses).toHaveLength(2);
    if (second.type !== "chunk") throw new Error("The worker did not produce its second chunk.");
    expect(second.sequence).toBe(1);
    port.autoAcknowledge = true;
    port.acknowledge(second);

    const completed = await port.completed.promise;
    expect(completed).toMatchObject({
      type: "done",
      jobId: 4,
      generation: 8,
      counts: { fileFingerprints: 1 },
    });
  } finally {
    port.removeAllListeners();
    await NodeFSP.rm(workspaceRoot, { recursive: true, force: true });
  }
});
