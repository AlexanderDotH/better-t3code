// @effect-diagnostics nodeBuiltinImport:off - Simulated child streams exercise protocol deadlines without launching processes.
import * as NodeEvents from "node:events";
import * as NodeStream from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { IndexerLspClient } from "./lspClient.ts";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

function childProcess() {
  const child = Object.assign(new NodeEvents.EventEmitter(), {
    stdin: new NodeStream.PassThrough(),
    stdout: new NodeStream.PassThrough(),
    stderr: new NodeStream.PassThrough(),
    kill: vi.fn(),
  });
  spawn.mockReturnValue(child);
  const respond = (id: number) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id, result: { complete: true } });
    child.stdout.emit(
      "data",
      Buffer.from("Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body),
    );
  };
  return { child, respond };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("indexer language service deadlines", () => {
  it("continues past two minutes while analysis requests make progress", async () => {
    const { child, respond } = childProcess();
    const client = new IndexerLspClient("/indexer", "/workspace");
    try {
      for (let id = 1; id <= 12; id++) {
        const response = client.request("textDocument/prepareCallHierarchy", {});
        await vi.advanceTimersByTimeAsync(20_000);
        respond(id);
        await expect(response).resolves.toEqual({ complete: true });
        expect(child.kill).not.toHaveBeenCalled();
      }
    } finally {
      client.close();
    }
  });

  it("still closes a stalled request and rejects pending work", async () => {
    const { child } = childProcess();
    const client = new IndexerLspClient("/indexer", "/workspace");
    const failure = expect(client.request("stalled", {})).rejects.toThrow(
      "request timed out: stalled",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("closes an idle session and honors cancellation immediately", async () => {
    const { child } = childProcess();
    const controller = new AbortController();
    const client = new IndexerLspClient("/indexer", "/workspace", controller.signal);
    const failure = expect(client.request("pending", {})).rejects.toThrow("cancelled");
    controller.abort();
    await failure;
    expect(child.kill).toHaveBeenCalledTimes(1);

    const idle = childProcess();
    const idleClient = new IndexerLspClient("/indexer", "/workspace");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(idle.child.kill).toHaveBeenCalled();
    idleClient.close();
  });
});
