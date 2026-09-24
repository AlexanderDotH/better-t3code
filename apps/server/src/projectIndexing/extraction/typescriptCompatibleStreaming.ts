// @effect-diagnostics nodeBuiltinImport:off - A dedicated worker owns all compiler AST state.
// @effect-diagnostics globalTimers:off - A response deadline terminates only this captured worker.
import * as NodeWorkerThreads from "node:worker_threads";
import type { ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { resolveCompatibleWorker } from "./typescriptCompatible.ts";
import {
  CompilerMessage,
  SEMANTIC_BATCH_SIZE,
  type StreamingSemanticInput,
} from "./streamingTypes.ts";

const Message = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["ready", "input-ack", "done"]) }),
  Schema.Struct({
    type: Schema.Literals(["batch"]),
    messages: Schema.Array(CompilerMessage).check(Schema.isMaxLength(SEMANTIC_BATCH_SIZE)),
  }),
]);
type Message = typeof Message.Type;
const decodeMessage = Schema.decodeUnknownSync(Message);

export async function* typescriptCompatibleMessages(
  input: StreamingSemanticInput,
  files: AsyncIterable<ProjectSourceFileV1>,
): AsyncGenerator<CompilerMessage> {
  input.signal?.throwIfAborted();
  const { entry, sourceMode } = resolveCompatibleWorker();
  const worker = new NodeWorkerThreads.Worker(entry, {
    workerData: { mode: "stream", root: input.root },
    execArgv: sourceMode ? ["--experimental-strip-types"] : [],
    resourceLimits: { maxOldGenerationSizeMb: 512 },
  });
  let message: Message | undefined;
  let receive:
    | {
        resolve: (message: Message) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let failure: Error | undefined;
  let done = false;
  const fail = (error: Error) => {
    failure = error;
    if (receive) clearTimeout(receive.timer);
    receive?.reject(error);
    receive = undefined;
    void worker.terminate();
  };
  worker.on("message", (value: unknown) => {
    try {
      const decoded = decodeMessage(value);
      if (receive) {
        const waiting = receive;
        receive = undefined;
        clearTimeout(waiting.timer);
        waiting.resolve(decoded);
      } else if (message)
        fail(new Error("Compiler worker produced output without acknowledgement."));
      else message = decoded;
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (!done) fail(new Error(`Compiler worker exited before stream completion (${code}).`));
  });
  const next = async () => {
    if (failure) throw failure;
    if (message) {
      const current = message;
      message = undefined;
      return current;
    }
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          fail(
            new Error("Compiler worker stopped responding; committed batches remain available."),
          ),
        120_000,
      );
      timer.unref();
      receive = { resolve, reject, timer };
    });
  };
  const abort = () => fail(new Error("Compiler worker stream cancelled."));
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    if ((await next()).type !== "ready") throw new Error("Compiler worker was not ready.");
    let page: ProjectSourceFileV1[] = [];
    const send = async () => {
      worker.postMessage({ type: "files", items: page }, []);
      page = [];
      if ((await next()).type !== "input-ack")
        throw new Error("Compiler worker did not acknowledge its source page.");
    };
    for await (const file of files) {
      input.signal?.throwIfAborted();
      page.push(file);
      if (page.length === SEMANTIC_BATCH_SIZE) await send();
    }
    if (page.length > 0) await send();
    worker.postMessage({ type: "files-complete" }, []);
    while (true) {
      const result = await next();
      if (result.type === "done") {
        done = true;
        break;
      }
      if (result.type !== "batch") throw new Error("Unexpected compiler stream message.");
      for (const item of result.messages) yield item;
      worker.postMessage({ type: "ack" }, []);
    }
  } finally {
    done = true;
    if (receive) clearTimeout(receive.timer);
    input.signal?.removeEventListener("abort", abort);
    await worker.terminate();
  }
}
