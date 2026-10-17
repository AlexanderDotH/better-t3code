// @effect-diagnostics nodeBuiltinImport:off - Filesystem inventory and CPU analysis run in this owned worker.
import * as NodeBuffer from "node:buffer";
import * as NodeWorkerThreads from "node:worker_threads";

import * as Effect from "effect/Effect";

import { KnowledgeGraphAnalysisCache } from "./KnowledgeGraphAnalysisCache.ts";
import { type KnowledgeGraphDeterministicExtractionResult } from "./KnowledgeGraphDeterministicExtractor.ts";
import { extractKnowledgeGraphInventoryInProcess } from "./KnowledgeGraphInventoryScan.ts";
import {
  decodeKnowledgeGraphWorkerRequest,
  KNOWLEDGE_GRAPH_WORKER_MAX_PAYLOAD_BYTES,
  type KnowledgeGraphWorkerRequest,
  type KnowledgeGraphWorkerResponse,
} from "./KnowledgeGraphWorkerProtocol.ts";

const SECTIONS = ["nodes", "edges", "evidence", "fileFingerprints"] as const;

interface WorkerPort {
  on(event: "message", listener: (value: unknown) => void): unknown;
  postMessage(message: KnowledgeGraphWorkerResponse, transfer: ArrayBuffer[]): void;
}

interface WorkerJob {
  readonly jobId: number;
  readonly generation: number;
  sequence: number;
  acknowledge: (() => void) | undefined;
}

export function* encodeKnowledgeGraphWorkerChunks(
  result: KnowledgeGraphDeterministicExtractionResult,
): Generator<Uint8Array<ArrayBuffer>> {
  for (const section of SECTIONS) {
    const prefix = `{"section":"${section}","items":[`;
    const suffix = "]}";
    const emptyBytes = NodeBuffer.Buffer.byteLength(prefix + suffix);
    let parts: string[] = [];
    let sizeBytes = emptyBytes;
    for (const item of result[section]) {
      const serialized = JSON.stringify(item);
      const itemBytes = NodeBuffer.Buffer.byteLength(serialized);
      if (emptyBytes + itemBytes > KNOWLEDGE_GRAPH_WORKER_MAX_PAYLOAD_BYTES) {
        throw new Error("A Knowledge Graph record exceeds the worker IPC byte limit.");
      }
      if (
        sizeBytes + itemBytes + (parts.length === 0 ? 0 : 1) >
        KNOWLEDGE_GRAPH_WORKER_MAX_PAYLOAD_BYTES
      ) {
        yield Uint8Array.from(NodeBuffer.Buffer.from(prefix + parts.join(",") + suffix));
        parts = [];
        sizeBytes = emptyBytes;
      }
      sizeBytes += itemBytes + (parts.length === 0 ? 0 : 1);
      parts.push(serialized);
    }
    if (parts.length > 0) {
      yield Uint8Array.from(NodeBuffer.Buffer.from(prefix + parts.join(",") + suffix));
    }
  }
}

export function runKnowledgeGraphExtractionWorker(
  port: WorkerPort | null = NodeWorkerThreads.parentPort,
): void {
  if (port === null) throw new Error("Knowledge Graph extraction requires an owned worker port.");
  const cache = new KnowledgeGraphAnalysisCache();
  let active: WorkerJob | undefined;

  const post = (message: KnowledgeGraphWorkerResponse, transfer: ArrayBuffer[] = []) => {
    port.postMessage(message, transfer);
  };

  const extract = async (
    request: Extract<KnowledgeGraphWorkerRequest, { readonly type: "extract" }>,
  ) => {
    if (active !== undefined) {
      throw new Error("The extraction worker already has an active job.");
    }
    const job: WorkerJob = {
      jobId: request.jobId,
      generation: request.generation,
      sequence: 0,
      acknowledge: undefined,
    };
    active = job;
    try {
      const outcome = await Effect.runPromise(
        extractKnowledgeGraphInventoryInProcess(request.input, cache).pipe(
          Effect.match({
            onFailure: (error) => ({ error }),
            onSuccess: (result) => ({ result }),
          }),
        ),
      );
      if ("error" in outcome) {
        post({
          type: "error",
          jobId: job.jobId,
          generation: job.generation,
          operation: outcome.error.operation,
          message: outcome.error.message.slice(0, 2_048),
        });
        return;
      }
      for (const payload of encodeKnowledgeGraphWorkerChunks(outcome.result)) {
        const acknowledged = new Promise<void>((resolve) => {
          job.acknowledge = resolve;
        });
        post(
          {
            type: "chunk",
            jobId: job.jobId,
            generation: job.generation,
            sequence: job.sequence,
            payload,
          },
          [payload.buffer],
        );
        await acknowledged;
        job.sequence += 1;
      }
      post({
        type: "done",
        jobId: job.jobId,
        generation: job.generation,
        sequence: job.sequence,
        counts: {
          nodes: outcome.result.nodes.length,
          edges: outcome.result.edges.length,
          evidence: outcome.result.evidence.length,
          fileFingerprints: outcome.result.fileFingerprints.length,
        },
        truncation: outcome.result.truncation,
        cache: cache.stats,
      });
    } catch (cause) {
      post({
        type: "error",
        jobId: job.jobId,
        generation: job.generation,
        operation: "worker",
        message: String(cause).slice(0, 2_048),
      });
    } finally {
      active = undefined;
    }
  };

  port.on("message", (value: unknown) => {
    const request = decodeKnowledgeGraphWorkerRequest(value);
    if (request.type === "extract") {
      void extract(request).catch((cause: unknown) => {
        throw cause;
      });
      return;
    }
    if (
      active === undefined ||
      request.jobId !== active.jobId ||
      request.generation !== active.generation ||
      request.sequence !== active.sequence
    ) {
      throw new Error("The extraction acknowledgement does not match the active job.");
    }
    const acknowledge = active.acknowledge;
    if (acknowledge === undefined) {
      throw new Error("The extraction chunk was already acknowledged.");
    }
    active.acknowledge = undefined;
    acknowledge();
  });
}

if (!NodeWorkerThreads.isMainThread) runKnowledgeGraphExtractionWorker();
