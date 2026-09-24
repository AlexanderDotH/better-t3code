// @effect-diagnostics nodeBuiltinImport:off - Simulated helper streams verify progress and backpressure without launching a runtime.
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";
import type { ProjectSourceFileV1 } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { StreamingSemanticInput } from "./streamingTypes.ts";
import { nativeCompilerMessages } from "./nativeStreaming.ts";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("./nativeSemantic.ts", () => ({ resolveAnalysisHelper: async () => "/fixture-helper" }));

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

function helperFixture() {
  const child = Object.assign(new NodeEvents.EventEmitter(), {
    stdin: new NodeStream.PassThrough(),
    stdout: new NodeStream.PassThrough(),
    stderr: new NodeStream.PassThrough(),
    kill: vi.fn(),
    exitCode: null as number | null,
    signalCode: null,
  });
  const spawned = Promise.withResolvers<void>();
  spawn.mockImplementation(() => {
    spawned.resolve();
    return child;
  });
  return { child, spawned: spawned.promise };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it.each(["csharp", "java"] as const)(
  "keeps %s analysis alive while producing results and waiting for the consumer",
  async (language) => {
    const { child, spawned } = helperFixture();
    const stream = nativeCompilerMessages(input, language, emptyFiles());
    let pending = stream.next();
    await spawned;
    for (let index = 0; index < 8; index++) {
      await vi.advanceTimersByTimeAsync(20_000);
      child.stdout.write(JSON.stringify({ type: "gap", gap: { message: "fixture" } }) + "\n");
      expect(await pending).toMatchObject({ done: false });
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(child.kill).not.toHaveBeenCalled();
      pending = stream.next();
    }
    child.exitCode = 0;
    child.stdout.end();
    child.emit("close", 0);
    expect(await pending).toEqual({ done: true, value: undefined });
  },
);

it("terminates a helper that stops responding", async () => {
  const { child, spawned } = helperFixture();
  child.kill.mockImplementation(() => child.emit("close", null));
  const stream = nativeCompilerMessages(input, "csharp", emptyFiles());
  const failure = expect(stream.next()).rejects.toThrow("stopped responding");
  await spawned;
  await vi.advanceTimersByTimeAsync(120_000);
  await failure;
  expect(child.kill).toHaveBeenCalled();
});
