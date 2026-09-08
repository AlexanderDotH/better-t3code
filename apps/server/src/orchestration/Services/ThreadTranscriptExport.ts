import type {
  OrchestrationThreadTranscriptExport,
  OrchestrationThreadTranscriptExportError,
  OrchestrationThreadTranscriptNotFoundError,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface ThreadTranscriptExportShape {
  readonly exportThread: (
    threadId: ThreadId,
  ) => Effect.Effect<
    OrchestrationThreadTranscriptExport,
    OrchestrationThreadTranscriptNotFoundError | OrchestrationThreadTranscriptExportError
  >;
}

export class ThreadTranscriptExport extends Context.Service<
  ThreadTranscriptExport,
  ThreadTranscriptExportShape
>()("t3/orchestration/Services/ThreadTranscriptExport") {}
