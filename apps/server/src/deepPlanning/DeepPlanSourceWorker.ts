// @effect-diagnostics nodeBuiltinImport:off - Source reads, hashing, and attachment processing belong to this owned worker.
import * as NodeWorkerThreads from "node:worker_threads";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { DeepPlanSourceError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  SourceExportJob,
  SourceExportResponse,
  writeSourceExport,
} from "./DeepPlanSourceExport.ts";

const job = Schema.decodeUnknownSync(SourceExportJob)(NodeWorkerThreads.workerData);
const port = NodeWorkerThreads.parentPort;
if (port === null) throw new Error("Source export requires an owned worker port.");
const encodeResponse = Schema.encodeSync(SourceExportResponse);
const isSourceError = Schema.is(DeepPlanSourceError);

const capture = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* writeSourceExport(job).pipe(sql.withTransaction);
}).pipe(
  Effect.scoped,
  Effect.provide(
    Layer.mergeAll(
      NodeSqliteClient.layer({ filename: job.dbPath, readonly: true }),
      NodeServices.layer,
    ),
  ),
  Effect.match({
    onSuccess: (result) => ({ type: "done" as const, result }),
    onFailure: (error) => ({
      type: "failed" as const,
      error: isSourceError(error)
        ? error
        : new DeepPlanSourceError({
            code: "source-unavailable",
            message: "The source history or an attachment could not be frozen.",
          }),
    }),
  }),
);

void Effect.runPromise(capture).then(
  (response) => port.postMessage(encodeResponse(response)),
  (cause: unknown) => {
    throw cause;
  },
);
