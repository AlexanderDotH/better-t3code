import * as NodeWorkerThreads from "node:worker_threads";

import { ProjectCallsiteV1, ProjectEntityV1, ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { resolveTypeScriptCompatibleAnalysis } from "./typescriptCompatibleAnalysis.ts";
import { runCompatibilityStream } from "./typescriptCompatibleStreamWorker.ts";

const Input = Schema.Struct({
  root: Schema.String,
  files: Schema.Array(ProjectSourceFileV1),
  entities: Schema.Array(ProjectEntityV1),
  callsites: Schema.Array(ProjectCallsiteV1),
});
const StreamInput = Schema.Struct({ mode: Schema.Literals(["stream"]), root: Schema.String });
const isStreamInput = Schema.is(StreamInput);
const workerInput: unknown = NodeWorkerThreads.workerData;
if (isStreamInput(workerInput)) {
  await runCompatibilityStream(workerInput.root);
} else {
  const input = Schema.decodeUnknownSync(Input)(workerInput);
  const result = await resolveTypeScriptCompatibleAnalysis(input);
  NodeWorkerThreads.parentPort?.postMessage(result);
}
