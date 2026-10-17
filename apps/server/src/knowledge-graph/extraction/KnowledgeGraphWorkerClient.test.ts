// @effect-diagnostics nodeBuiltinImport:off - These fixtures exercise the worker's real-filesystem boundary.
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  KnowledgeGraphNodeId,
  KnowledgeGraphScopeId,
  ProjectId,
  type KnowledgeGraphScopeV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { extractKnowledgeGraphInventoryInProcess } from "./KnowledgeGraphInventoryScan.ts";
import { type ExtractKnowledgeGraphInventoryInput } from "./KnowledgeGraphInventoryTypes.ts";
import {
  KnowledgeGraphWorkerClient,
  type KnowledgeGraphWorkerEvent,
} from "./KnowledgeGraphWorkerClient.ts";
import {
  KNOWLEDGE_GRAPH_WORKER_MAX_CHUNK_BYTES,
  type KnowledgeGraphWorkerRequest,
} from "./KnowledgeGraphWorkerProtocol.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

function scope(workspaceRoot: string): KnowledgeGraphScopeV1 {
  return {
    version: 1,
    scopeId: KnowledgeGraphScopeId.make("kg:worker-test"),
    environmentId: EnvironmentId.make("environment-test"),
    projectId: ProjectId.make("project-test"),
    effectiveWorkspaceRoot: workspaceRoot,
    isWorktree: false,
  };
}

const fixture = [
  ["src/index.ts", 'import { Service } from "./service";\nexport function start() {}\n'],
  ["src/service.ts", "export class Service {}\n"],
  ["package.json", '{"name":"worker-fixture","dependencies":{"react":"19"}}'],
  ["docs/architecture.md", "# Architecture\nA worker extracts the graph.\n"],
  ["config/app.json", '{"apiKey":"must-not-leak-worker"}'],
  [".env", "OPENAI_API_KEY=must-not-leak-worker"],
] as const;

function withWorkspace<A, E>(
  run: (input: ExtractKnowledgeGraphInventoryInput) => Effect.Effect<A, E>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const workspaceRoot = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const temporary = await NodeFSP.mkdtemp(
            NodePath.join(NodeOS.tmpdir(), "t3-kg-worker-test-"),
          );
          return NodeFSP.realpath(temporary);
        }),
        (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
      );
      yield* Effect.promise(async () => {
        for (const [path, content] of fixture) {
          const absolutePath = NodePath.join(workspaceRoot, path);
          await NodeFSP.mkdir(NodePath.dirname(absolutePath), { recursive: true });
          await NodeFSP.writeFile(absolutePath, content);
        }
      });
      return yield* run({
        scope: scope(workspaceRoot),
        workspaceRoot,
        coChangeGroups: [["src/index.ts", "src/service.ts"]],
        seenGeneration: 11,
        generation: 7,
      });
    }),
  );
}

it.effect("returns the equivalent full graph and reuses unchanged analysis in one worker", () =>
  withWorkspace((input) =>
    Effect.gen(function* () {
      const events: KnowledgeGraphWorkerEvent[] = [];
      const client = new KnowledgeGraphWorkerClient({ onEvent: (event) => events.push(event) });
      try {
        const expected = yield* extractKnowledgeGraphInventoryInProcess(input);
        const first = yield* Effect.promise((signal) => client.extract(input, signal));
        const second = yield* Effect.promise((signal) => client.extract(input, signal));

        expect(first).toEqual(expected);
        expect(second).toEqual(expected);
        expect(encodeJson(first)).not.toContain("must-not-leak-worker");
        const completions = events.filter((event) => event.type === "completed");
        expect(completions).toHaveLength(2);
        expect(completions[0]?.cache).toMatchObject({ hits: 0, misses: 5, entries: 5 });
        expect(completions[1]?.cache).toMatchObject({ hits: 5, misses: 5, entries: 5 });
        expect(
          events.filter((event) => event.type === "started").map((event) => event.jobId),
        ).toEqual([0, 1]);
        expect(
          events
            .filter((event) => event.type === "chunk")
            .every((event) => event.sizeBytes <= KNOWLEDGE_GRAPH_WORKER_MAX_CHUNK_BYTES),
        ).toBe(true);
      } finally {
        yield* Effect.promise(() => client.close());
      }
    }),
  ),
);

it.effect("resolves cached imports against deletions, additions, and changed source", () =>
  withWorkspace((input) =>
    Effect.gen(function* () {
      const client = new KnowledgeGraphWorkerClient();
      try {
        const first = yield* Effect.promise((signal) => client.extract(input, signal));
        expect(first.edges.some((edge) => edge.kind === "imports")).toBe(true);
        yield* Effect.promise(() =>
          NodeFSP.rm(NodePath.join(input.workspaceRoot, "src/service.ts")),
        );
        const deleted = yield* Effect.promise((signal) =>
          client.extract({ ...input, generation: 8 }, signal),
        );
        expect(deleted.edges.some((edge) => edge.kind === "imports")).toBe(false);
        expect(deleted.fileFingerprints.some((file) => file.path === "src/service.ts")).toBe(false);

        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(input.workspaceRoot, "src/worker.ts"),
            "export class Worker {}\n",
          ),
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(input.workspaceRoot, "src/index.ts"),
            'import { Worker } from "./worker";\nexport function start() {}\n',
          ),
        );
        const updated = yield* Effect.promise((signal) =>
          client.extract({ ...input, generation: 9 }, signal),
        );
        const imported = updated.edges.find((edge) => edge.kind === "imports");
        expect(
          updated.nodes.find((node) => node.nodeId === imported?.targetNodeId)?.source?.path,
        ).toBe("src/worker.ts");
        const expected = yield* extractKnowledgeGraphInventoryInProcess({
          ...input,
          generation: 9,
        });
        expect(updated).toEqual(expected);
      } finally {
        yield* Effect.promise(() => client.close());
      }
    }),
  ),
);

it.effect(
  "discards a partially transferred graph on cancellation and can start a fresh worker",
  () =>
    withWorkspace((input) =>
      Effect.gen(function* () {
        const controller = new AbortController();
        let cancelled = false;
        const client = new KnowledgeGraphWorkerClient({
          onEvent: (event) => {
            if (event.type === "chunk" && !cancelled) {
              cancelled = true;
              controller.abort();
            }
          },
        });
        try {
          yield* Effect.promise(() =>
            expect(client.extract(input, controller.signal)).rejects.toMatchObject({
              _tag: "KnowledgeGraphInventoryError",
              operation: "worker",
            }),
          );
          expect(cancelled).toBe(true);
          const completed = yield* Effect.promise((signal) =>
            client.extract({ ...input, generation: 8 }, signal),
          );
          expect(completed.fileFingerprints).toHaveLength(5);
        } finally {
          yield* Effect.promise(() => client.close());
        }
      }),
    ),
);

class StubWorker extends NodeEvents.EventEmitter {
  readonly requests: KnowledgeGraphWorkerRequest[] = [];
  readonly started =
    Promise.withResolvers<Extract<KnowledgeGraphWorkerRequest, { readonly type: "extract" }>>();
  terminateCalls = 0;

  postMessage(request: KnowledgeGraphWorkerRequest): void {
    this.requests.push(request);
    if (request.type === "extract") this.started.resolve(request);
  }

  ref(): void {}
  unref(): void {}

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    return Promise.resolve(0);
  }
}

const stubInput = {
  scope: scope("/workspace"),
  workspaceRoot: "/workspace",
  coChangeGroups: [],
  seenGeneration: 5,
  generation: 3,
} satisfies ExtractKnowledgeGraphInventoryInput;

function emptyChunk(request: Extract<KnowledgeGraphWorkerRequest, { readonly type: "extract" }>) {
  return {
    type: "chunk",
    jobId: request.jobId,
    generation: request.generation,
    sequence: 0,
    payload: new TextEncoder().encode('{"section":"nodes","items":[]}'),
  };
}

it.each(["stale job", "stale generation", "out-of-order chunk", "oversized chunk"] as const)(
  "rejects a %s instead of accepting a partial result",
  async (failure) => {
    const worker = new StubWorker();
    const client = new KnowledgeGraphWorkerClient({ spawnWorker: () => worker });
    try {
      const extraction = client.extract(stubInput, new AbortController().signal);
      const rejected = expect(extraction).rejects.toMatchObject({
        _tag: "KnowledgeGraphInventoryError",
        operation: "worker",
      });
      const request = await worker.started.promise;
      const chunk = emptyChunk(request);
      worker.emit("message", {
        ...chunk,
        ...(failure === "stale job" ? { jobId: request.jobId + 1 } : {}),
        ...(failure === "stale generation" ? { generation: request.generation + 1 } : {}),
        ...(failure === "out-of-order chunk" ? { sequence: 1 } : {}),
        ...(failure === "oversized chunk"
          ? { payload: new Uint8Array(KNOWLEDGE_GRAPH_WORKER_MAX_CHUNK_BYTES + 1) }
          : {}),
      });
      await rejected;
      expect(worker.terminateCalls).toBe(1);
    } finally {
      await client.close();
    }
  },
);

it.each(["error", "exit"] as const)(
  "rejects a worker %s after a valid partial chunk",
  async (failure) => {
    const worker = new StubWorker();
    const client = new KnowledgeGraphWorkerClient({ spawnWorker: () => worker });
    try {
      const extraction = client.extract(stubInput, new AbortController().signal);
      const rejected = expect(extraction).rejects.toMatchObject({
        _tag: "KnowledgeGraphInventoryError",
        operation: "worker",
      });
      const request = await worker.started.promise;
      const node = {
        version: 1,
        nodeId: KnowledgeGraphNodeId.make("kg:worker-node"),
        scopeId: stubInput.scope.scopeId,
        kind: "repository",
        label: "workspace",
        provenance: "deterministic",
        confidence: 1,
        evidenceIds: [],
        nodeRevision: 0,
      };
      worker.emit("message", {
        ...emptyChunk(request),
        payload: new TextEncoder().encode(JSON.stringify({ section: "nodes", items: [node] })),
      });
      expect(worker.requests.at(-1)?.type).toBe("ack");
      worker.emit(failure, failure === "error" ? new Error("Worker crashed") : 1);
      await rejected;
      expect(worker.terminateCalls).toBe(1);
    } finally {
      await client.close();
    }
  },
);

it("terminates a timed-out job without completing it", async () => {
  const worker = new StubWorker();
  const deadline = Promise.withResolvers<() => void>();
  const client = new KnowledgeGraphWorkerClient({
    spawnWorker: () => worker,
    scheduleDeadline: (expire) => {
      deadline.resolve(expire);
      return () => {};
    },
  });
  try {
    const extraction = client.extract(stubInput, new AbortController().signal);
    const rejected = expect(extraction).rejects.toMatchObject({
      _tag: "KnowledgeGraphInventoryError",
      operation: "worker",
    });
    await worker.started.promise;
    (await deadline.promise)();
    await rejected;
    expect(worker.terminateCalls).toBe(1);
  } finally {
    await client.close();
  }
});

it("closes the active job and rejects further work after its scope ends", async () => {
  const worker = new StubWorker();
  const client = new KnowledgeGraphWorkerClient({ spawnWorker: () => worker });
  const extraction = client.extract(stubInput, new AbortController().signal);
  const rejected = expect(extraction).rejects.toMatchObject({
    _tag: "KnowledgeGraphInventoryError",
  });
  await worker.started.promise;
  await client.close();
  await rejected;
  await expect(client.extract(stubInput, new AbortController().signal)).rejects.toMatchObject({
    _tag: "KnowledgeGraphInventoryError",
  });
  expect(worker.terminateCalls).toBe(1);
});
