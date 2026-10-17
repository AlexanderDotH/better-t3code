// @effect-diagnostics nodeBuiltinImport:off - This client owns the native CPU worker.
// @effect-diagnostics globalTimers:off - The worker has a hard deadline and never owns a ref'ed idle timer.
import * as NodeBuffer from "node:buffer";
import * as NodeURL from "node:url";
import * as NodeWorkerThreads from "node:worker_threads";

import {
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphEvidenceV1,
  type KnowledgeGraphFileFingerprintV1,
  type KnowledgeGraphNodeV1,
} from "@t3tools/contracts";

import { runtimeModuleUrl } from "../../process/fileBackedModules.ts";
import { resolveFilesystemAsset } from "../../projectIndexing/extraction/assets.ts";
import { type KnowledgeGraphAnalysisCacheStats } from "./KnowledgeGraphAnalysisCache.ts";
import { type KnowledgeGraphDeterministicExtractionResult } from "./KnowledgeGraphDeterministicExtractor.ts";
import {
  isKnowledgeGraphInventoryError,
  KnowledgeGraphInventoryError,
  resolveKnowledgeGraphInventoryBounds,
  type ExtractKnowledgeGraphInventoryInput,
} from "./KnowledgeGraphInventoryTypes.ts";
import {
  decodeKnowledgeGraphWorkerChunk,
  decodeKnowledgeGraphWorkerRequest,
  decodeKnowledgeGraphWorkerResponse,
  KNOWLEDGE_GRAPH_WORKER_MAX_CHUNK_BYTES,
  KNOWLEDGE_GRAPH_WORKER_TIMEOUT_MS,
  type KnowledgeGraphWorkerChunk,
  type KnowledgeGraphWorkerInput,
  type KnowledgeGraphWorkerRequest,
} from "./KnowledgeGraphWorkerProtocol.ts";

export interface KnowledgeGraphWorkerHandle {
  on(event: "message" | "error" | "exit", listener: (value: unknown) => void): unknown;
  postMessage(message: KnowledgeGraphWorkerRequest): void;
  removeAllListeners(): unknown;
  ref(): unknown;
  unref(): unknown;
  terminate(): Promise<number>;
}

export type KnowledgeGraphWorkerEvent =
  | { readonly type: "started"; readonly jobId: number; readonly generation: number }
  | {
      readonly type: "chunk";
      readonly jobId: number;
      readonly generation: number;
      readonly sequence: number;
      readonly sizeBytes: number;
    }
  | {
      readonly type: "completed";
      readonly jobId: number;
      readonly generation: number;
      readonly cache: KnowledgeGraphAnalysisCacheStats;
    };

export interface KnowledgeGraphWorkerClientOptions {
  readonly moduleUrl?: string;
  readonly spawnWorker?: () => KnowledgeGraphWorkerHandle;
  readonly scheduleDeadline?: (expire: () => void) => () => void;
  readonly onEvent?: (event: KnowledgeGraphWorkerEvent) => void;
}

interface PendingJob {
  readonly jobId: number;
  readonly generation: number;
  readonly input: KnowledgeGraphWorkerInput;
  readonly nodes: KnowledgeGraphNodeV1[];
  readonly edges: KnowledgeGraphEdgeV1[];
  readonly evidence: KnowledgeGraphEvidenceV1[];
  readonly fileFingerprints: KnowledgeGraphFileFingerprintV1[];
  readonly fail: (cause: unknown) => void;
  readonly complete: (result: KnowledgeGraphDeterministicExtractionResult) => void;
  nextSequence: number;
  lastSection: number;
  readonly lastKeys: Map<string, string>;
}

function resolveKnowledgeGraphExtractionWorker(moduleUrl = import.meta.url) {
  const sourceMode = moduleUrl.endsWith(".ts");
  const relativeEntry = sourceMode
    ? "./KnowledgeGraphExtractionWorker.ts"
    : "./knowledge-graph-extraction-worker.mjs";
  const entry = NodeURL.pathToFileURL(
    resolveFilesystemAsset(
      NodeURL.fileURLToPath(new URL(relativeEntry, runtimeModuleUrl(moduleUrl))),
    ),
  );
  return { entry, sourceMode };
}

function scheduleDeadline(expire: () => void): () => void {
  const timer = setTimeout(expire, KNOWLEDGE_GRAPH_WORKER_TIMEOUT_MS);
  timer.unref();
  return () => clearTimeout(timer);
}

function errorFor(input: ExtractKnowledgeGraphInventoryInput, cause: unknown) {
  return isKnowledgeGraphInventoryError(cause)
    ? cause
    : new KnowledgeGraphInventoryError({
        operation: "worker",
        workspaceRoot: input.workspaceRoot,
        relativePath: "",
        cause,
      });
}

function appendChunk(job: PendingJob, chunk: KnowledgeGraphWorkerChunk): void {
  const section = ["nodes", "edges", "evidence", "fileFingerprints"].indexOf(chunk.section);
  if (section < job.lastSection) throw new Error("The worker result sections are out of order.");
  job.lastSection = section;
  const checkKey = (key: string) => {
    const previous = job.lastKeys.get(chunk.section);
    if (previous !== undefined && key <= previous) {
      throw new Error("The worker result is not sorted or contains duplicate records.");
    }
    job.lastKeys.set(chunk.section, key);
  };
  if (chunk.section === "fileFingerprints") {
    for (const item of chunk.items) {
      if (item.seenGeneration !== job.input.seenGeneration) {
        throw new Error("The worker fingerprint belongs to a different generation.");
      }
      checkKey(item.path);
      job.fileFingerprints.push(item);
    }
    if (job.fileFingerprints.length > job.input.maxEligibleFiles) {
      throw new Error("The worker exceeded the inventory file limit.");
    }
    return;
  }
  for (const item of chunk.items) {
    if (item.scopeId !== job.input.scope.scopeId) {
      throw new Error("The worker result belongs to a different scope.");
    }
  }
  if (chunk.section === "nodes") {
    for (const item of chunk.items) {
      checkKey(item.nodeId);
      job.nodes.push(item);
    }
    if (job.nodes.length > job.input.maxNodes) {
      throw new Error("The worker exceeded the graph node limit.");
    }
  } else if (chunk.section === "edges") {
    for (const item of chunk.items) {
      checkKey(item.edgeId);
      job.edges.push(item);
    }
  } else {
    for (const item of chunk.items) {
      checkKey(item.evidenceId);
      job.evidence.push(item);
    }
  }
}

export class KnowledgeGraphWorkerClient {
  readonly #options: KnowledgeGraphWorkerClientOptions;
  #worker: KnowledgeGraphWorkerHandle | undefined;
  #active: PendingJob | undefined;
  #nextJobId = 0;
  #closed = false;
  #stopping: Promise<void> | undefined;

  constructor(options: KnowledgeGraphWorkerClientOptions = {}) {
    this.#options = options;
  }

  #getWorker(): KnowledgeGraphWorkerHandle {
    if (this.#worker !== undefined) return this.#worker;
    const worker =
      this.#options.spawnWorker?.() ??
      (() => {
        const { entry, sourceMode } = resolveKnowledgeGraphExtractionWorker(
          this.#options.moduleUrl,
        );
        return new NodeWorkerThreads.Worker(entry, {
          execArgv: sourceMode ? ["--experimental-strip-types"] : [],
          resourceLimits: { maxOldGenerationSizeMb: 1_024 },
        });
      })();
    this.#worker = worker;
    worker.on("message", (value) => this.#receive(value));
    worker.on("error", (cause) => {
      this.#active?.fail(cause);
      if (this.#active === undefined) void this.#stopWorker();
    });
    worker.on("exit", (code) => {
      this.#active?.fail(
        new Error(`The Knowledge Graph worker exited without a result (${String(code)}).`),
      );
      if (this.#active === undefined) void this.#stopWorker();
    });
    worker.unref();
    return worker;
  }

  #stopWorker(): Promise<void> {
    if (this.#stopping !== undefined) return this.#stopping;
    const worker = this.#worker;
    this.#worker = undefined;
    if (worker === undefined) return Promise.resolve();
    worker.removeAllListeners();
    // A crash racing termination must not become an unhandled EventEmitter error.
    worker.on("error", () => {});
    const stopped = () => {
      worker.removeAllListeners();
      this.#stopping = undefined;
    };
    this.#stopping = worker.terminate().then(stopped, stopped);
    return this.#stopping;
  }

  #receive(value: unknown): void {
    const job = this.#active;
    if (job === undefined) return;
    try {
      const message = decodeKnowledgeGraphWorkerResponse(value);
      if (message.jobId !== job.jobId || message.generation !== job.generation) {
        throw new Error("The worker response belongs to a stale job or generation.");
      }
      if (message.type === "error") {
        job.fail(
          new KnowledgeGraphInventoryError({
            operation: message.operation,
            workspaceRoot: job.input.workspaceRoot,
            relativePath: "",
            cause: new Error(message.message),
          }),
        );
        return;
      }
      if (message.sequence !== job.nextSequence) {
        throw new Error("The worker chunk sequence is invalid.");
      }
      if (message.type === "chunk") {
        const chunk = decodeKnowledgeGraphWorkerChunk(
          new TextDecoder("utf-8", { fatal: true }).decode(message.payload),
        );
        appendChunk(job, chunk);
        job.nextSequence += 1;
        this.#options.onEvent?.({
          type: "chunk",
          jobId: job.jobId,
          generation: job.generation,
          sequence: message.sequence,
          sizeBytes: message.payload.byteLength,
        });
        this.#worker?.postMessage({
          type: "ack",
          jobId: job.jobId,
          generation: job.generation,
          sequence: message.sequence,
        });
        return;
      }
      if (
        message.counts.nodes !== job.nodes.length ||
        message.counts.edges !== job.edges.length ||
        message.counts.evidence !== job.evidence.length ||
        message.counts.fileFingerprints !== job.fileFingerprints.length
      ) {
        throw new Error("The worker result is incomplete.");
      }
      this.#options.onEvent?.({
        type: "completed",
        jobId: job.jobId,
        generation: job.generation,
        cache: message.cache,
      });
      job.complete({
        nodes: job.nodes,
        edges: job.edges,
        evidence: job.evidence,
        fileFingerprints: job.fileFingerprints,
        truncation: message.truncation,
      });
    } catch (cause) {
      job.fail(cause);
    }
  }

  extract(
    input: ExtractKnowledgeGraphInventoryInput,
    signal: AbortSignal,
  ): Promise<KnowledgeGraphDeterministicExtractionResult> {
    if (this.#closed)
      return Promise.reject(errorFor(input, new Error("The extraction client is closed.")));
    if (this.#active !== undefined || this.#stopping !== undefined) {
      return Promise.reject(
        errorFor(input, new Error("The extraction client already has an active job.")),
      );
    }
    let request: Extract<KnowledgeGraphWorkerRequest, { readonly type: "extract" }>;
    try {
      signal.throwIfAborted();
      const bounds = resolveKnowledgeGraphInventoryBounds(input);
      const seenGeneration = Math.max(0, Math.floor(input.seenGeneration ?? 0));
      const decoded = decodeKnowledgeGraphWorkerRequest({
        type: "extract",
        jobId: this.#nextJobId++,
        generation: input.generation ?? seenGeneration,
        input: {
          scope: input.scope,
          workspaceRoot: input.workspaceRoot,
          ...bounds,
          seenGeneration,
          ...(input.coChangeGroups === undefined ? {} : { coChangeGroups: input.coChangeGroups }),
        },
      });
      if (decoded.type !== "extract") throw new Error("An extraction request was expected.");
      if (
        NodeBuffer.Buffer.byteLength(JSON.stringify(decoded)) >
        KNOWLEDGE_GRAPH_WORKER_MAX_CHUNK_BYTES
      ) {
        throw new Error("The extraction request exceeds the IPC byte limit.");
      }
      request = decoded;
    } catch (cause) {
      return Promise.reject(errorFor(input, cause));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let cancelDeadline = () => {};
      const finish = (cause?: unknown, result?: KnowledgeGraphDeterministicExtractionResult) => {
        if (settled) return;
        settled = true;
        cancelDeadline();
        signal.removeEventListener("abort", abort);
        if (result !== undefined) {
          this.#active = undefined;
          this.#worker?.unref();
          resolve(result);
          return;
        }
        void this.#stopWorker().then(() => {
          this.#active = undefined;
          reject(errorFor(input, cause));
        });
      };
      const abort = () => finish(new Error("Knowledge Graph extraction was cancelled."));
      const job: PendingJob = {
        jobId: request.jobId,
        generation: request.generation,
        input: request.input,
        nodes: [],
        edges: [],
        evidence: [],
        fileFingerprints: [],
        nextSequence: 0,
        lastSection: 0,
        lastKeys: new Map(),
        fail: (cause) => finish(cause),
        complete: (result) => finish(undefined, result),
      };
      this.#active = job;
      signal.addEventListener("abort", abort, { once: true });
      try {
        cancelDeadline = (this.#options.scheduleDeadline ?? scheduleDeadline)(() =>
          finish(new Error("Knowledge Graph extraction exceeded its time budget.")),
        );
        if (settled) return;
        const worker = this.#getWorker();
        worker.ref();
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node worker IPC has no browser origin.
        worker.postMessage(request);
        this.#options.onEvent?.({
          type: "started",
          jobId: job.jobId,
          generation: job.generation,
        });
        if (signal.aborted) abort();
      } catch (cause) {
        finish(cause);
      }
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#active?.fail(new Error("The Knowledge Graph extraction scope was closed."));
    await this.#stopWorker();
  }
}
