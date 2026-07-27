import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  OrchestrationExportThreadTranscriptInput,
  OrchestrationThreadTranscriptExport,
} from "./orchestration.ts";

const decodeExportInput = Schema.decodeUnknownEffect(OrchestrationExportThreadTranscriptInput);
const decodeExportResult = Schema.decodeUnknownEffect(OrchestrationThreadTranscriptExport);

it.effect("decodes a versioned Markdown thread transcript export", () =>
  Effect.gen(function* () {
    const input = yield* decodeExportInput({
      threadId: "thread-1",
    });
    const result = yield* decodeExportResult({
      formatVersion: 1,
      fileName: "thread-1.md",
      mediaType: "text/markdown",
      generatedAt: "2026-07-12T11:00:00.000Z",
      content: "# Thread",
    });

    assert.strictEqual(input.threadId, "thread-1");
    assert.strictEqual(result.formatVersion, 1);
    assert.strictEqual(result.mediaType, "text/markdown");
  }),
);
