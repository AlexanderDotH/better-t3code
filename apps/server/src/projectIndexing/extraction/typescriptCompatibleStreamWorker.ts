import * as NodeWorkerThreads from "node:worker_threads";
import { ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { analyzeTypeScriptDeclarations } from "./typescriptCompatibleAnalysis.ts";
import { SEMANTIC_BATCH_SIZE, type CompilerMessage } from "./streamingTypes.ts";

const InputMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["files"]),
    items: Schema.Array(ProjectSourceFileV1).check(Schema.isMaxLength(SEMANTIC_BATCH_SIZE)),
  }),
  Schema.Struct({ type: Schema.Literals(["files-complete"]) }),
  Schema.Struct({ type: Schema.Literals(["ack"]) }),
]);
const decodeMessage = Schema.decodeUnknownSync(InputMessage);

export async function runCompatibilityStream(root: string) {
  const port = NodeWorkerThreads.parentPort;
  if (!port) throw new Error("Compiler streaming requires an owned worker message port.");
  const files: ProjectSourceFileV1[] = [];
  let acknowledge: (() => void) | undefined;
  let endInput: (() => void) | undefined;
  const inputComplete = new Promise<void>((resolve) => {
    endInput = resolve;
  });
  port.on("message", (value: unknown) => {
    const message = decodeMessage(value);
    if (message.type === "files") {
      files.push(...message.items);
      port.postMessage({ type: "input-ack" });
    } else if (message.type === "files-complete") endInput?.();
    else {
      const resolve = acknowledge;
      acknowledge = undefined;
      resolve?.();
    }
  });
  port.postMessage({ type: "ready" });
  await inputComplete;
  let messages: CompilerMessage[] = [];
  const flush = async () => {
    if (messages.length === 0) return;
    const ack = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    port.postMessage({ type: "batch", messages });
    messages = [];
    await ack;
  };
  const emit = async (message: CompilerMessage) => {
    messages.push(message);
    if (messages.length >= SEMANTIC_BATCH_SIZE) await flush();
  };
  await analyzeTypeScriptDeclarations(
    { root, files },
    { call: (call) => emit({ type: "call", call }), gap: (gap) => emit({ type: "gap", gap }) },
  );
  await flush();
  port.postMessage({ type: "done" });
  port.close();
}
