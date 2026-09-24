// @effect-diagnostics nodeBuiltinImport:off - A simulated worker verifies deadlines and stream backpressure.
import * as NodeEvents from "node:events";
import type { ProjectSourceFileV1 } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { StreamingSemanticInput } from "./streamingTypes.ts";
import { typescriptCompatibleMessages } from "./typescriptCompatibleStreaming.ts";

const createWorker = vi.hoisted(() => vi.fn());
vi.mock("node:worker_threads", () => ({ Worker: createWorker }));
vi.mock("./typescriptCompatible.ts", () => ({
  resolveCompatibleWorker: () => ({ entry: "/fixture-worker", sourceMode: false }),
}));

const input: StreamingSemanticInput = {
  root: "/workspace",
  reader: {
    files: async () => ({ items: [], nextCursor: null }),
    callsites: async () => ({ items: [], nextCursor: null }),
    file: async () => undefined,
    callsitesAt: async () => [],
    target: async () => undefined,
  },
};
async function* emptyFiles(): AsyncGenerator<ProjectSourceFileV1> {}

function workerFixture() {
  const worker = Object.assign(new NodeEvents.EventEmitter(), {
    postMessage: vi.fn(),
    terminate: vi.fn(async () => 0),
  });
  createWorker.mockImplementation(function () {
    return worker;
  });
  return worker;
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("does not time out while committed output is being consumed", async () => {
  const worker = workerFixture();
  worker.postMessage.mockImplementation((message: { type: string }) => {
    worker.emit(
      "message",
      message.type === "files-complete"
        ? { type: "batch", messages: [{ type: "gap", gap: { message: "fixture" } }] }
        : { type: "done" },
    );
  });
  const stream = typescriptCompatibleMessages(input, emptyFiles());
  const first = stream.next();
  worker.emit("message", { type: "ready" });
  expect(await first).toMatchObject({ done: false, value: { type: "gap" } });
  await vi.advanceTimersByTimeAsync(180_000);
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(await stream.next()).toEqual({ done: true, value: undefined });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it("still terminates a worker that stops producing a requested response", async () => {
  const worker = workerFixture();
  const stream = typescriptCompatibleMessages(input, emptyFiles());
  const failure = expect(stream.next()).rejects.toThrow("stopped responding");
  await vi.advanceTimersByTimeAsync(120_000);
  await failure;
  expect(worker.terminate).toHaveBeenCalled();
});
