// @effect-diagnostics nodeBuiltinImport:off - Owns a bounded analysis process independent of the T3 process lifecycle.
// @effect-diagnostics globalTimers:off - Protocol request deadlines close this client's owned child on timeout.
import * as NodeChildProcess from "node:child_process";

import * as Schema from "effect/Schema";

const Envelope = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Int, Schema.String])),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String, code: Schema.Int })),
});
const decodeEnvelope = Schema.decodeUnknownSync(Envelope);
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/** Owns only its analysis child; it never launches a project command or handles workspace edits. */
export class IndexerLspClient {
  private readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private buffer = Buffer.alloc(0);
  private nextId = 0;
  private closed = false;
  private readonly signal: AbortSignal | undefined;
  private readonly idleTimer: ReturnType<typeof setTimeout>;
  private readonly abort = () => this.close(new Error("Semantic analysis cancelled."));

  constructor(executable: string, root: string, signal?: AbortSignal, idleTimeoutMs = 120_000) {
    signal?.throwIfAborted();
    this.signal = signal;
    this.child = NodeChildProcess.spawn(executable, ["--lsp", "--stdio"], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // ATA is disabled in initialization. An empty PATH also prevents npm/content-mapper launches.
      env: { ...process.env, PATH: "", GOMEMLIMIT: "512MiB" },
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stdout.on("error", (error) => this.close(error));
    this.child.stdin.on("error", (error) => this.close(error));
    this.child.stderr.resume();
    this.child.on("error", (error) => this.close(error));
    this.child.on("exit", (code) => this.close(new Error(`Language service exited (${code}).`)));
    this.idleTimer = setTimeout(
      () =>
        this.close(
          new Error("Semantic analysis stopped responding; syntax inventory remains available."),
        ),
      idleTimeoutMs,
    );
    this.idleTimer.unref();
    signal?.addEventListener("abort", this.abort, { once: true });
  }

  private send(message: unknown) {
    if (this.closed) throw new Error("Language service is closed.");
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: unknown): Promise<unknown> {
    this.signal?.throwIfAborted();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Language-service request timed out: ${method}`));
        this.close();
      }, REQUEST_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private receive(chunk: Buffer) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length > 0) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) {
          if (this.buffer.length > 8192)
            throw new Error("Invalid language-service message header.");
          return;
        }
        const header = this.buffer.subarray(0, headerEnd).toString("ascii");
        const length = Number(/(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header)?.[1]);
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_MESSAGE_BYTES)
          throw new Error("Language-service response exceeds the message budget.");
        const bodyEnd = headerEnd + 4 + length;
        if (this.buffer.length < bodyEnd) return;
        const message = decodeEnvelope(
          JSON.parse(this.buffer.subarray(headerEnd + 4, bodyEnd).toString("utf8")),
        );
        this.buffer = this.buffer.subarray(bodyEnd);
        if (message.method) {
          if (message.id !== undefined) {
            if (
              message.method === "client/registerCapability" ||
              message.method === "client/unregisterCapability"
            ) {
              // The extraction session is a fixed source snapshot; no background filesystem watchers are registered.
              this.send({ jsonrpc: "2.0", id: message.id, result: null });
            } else {
              this.send({
                jsonrpc: "2.0",
                id: message.id,
                error: { code: -32601, message: "Indexer does not execute workspace actions." },
              });
            }
          }
          continue;
        }
        if (typeof message.id !== "number") continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.idleTimer.refresh();
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    } catch (error) {
      this.close(error instanceof Error ? error : new Error(String(error)));
    }
  }

  close(error = new Error("Language service closed.")) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.signal?.removeEventListener("abort", this.abort);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill();
    const forceExit = setTimeout(() => this.child.kill("SIGKILL"), 1000);
    forceExit.unref();
    this.child.once("close", () => clearTimeout(forceExit));
  }
}
