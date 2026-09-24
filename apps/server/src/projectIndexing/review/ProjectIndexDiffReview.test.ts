import { assert, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type {
  ProjectIndexingBridgeShape,
  ProjectIndexReviewDiff,
  ResolvedProjectIndexScope,
} from "../runtime/ProjectIndexingBridge.ts";
import {
  encodeProjectIndexJson,
  ProjectIndexRuntimeError,
} from "../runtime/ProjectIndexingErrors.ts";
import {
  projectIndexReviewDiffHash,
  reviewProjectIndexDiff,
  validateProjectIndexReviewOutput,
} from "./ProjectIndexDiffReview.ts";

const resolved: ResolvedProjectIndexScope = {
  workspaceRoot: "/workspace",
  scope: {
    scopeId: "scope",
    projectId: ProjectId.make("project"),
    workspaceFingerprint: "workspace",
  },
};
const range = { startLine: 3, startColumn: 1, endLine: 3, endColumn: 9 };
const diff: ProjectIndexReviewDiff = {
  diff: "diff --git a/value.ts b/value.ts\n--- a/value.ts\n+++ b/value.ts\n@@ -3 +3 @@\n-return 1\n+return 2\n",
  files: [
    {
      filePath: "value.ts",
      changedRanges: [range],
      sourceHash: "selected-index-content",
      rangePatches: ["@@ -3 +3 @@\n-return 1\n+return 2\n"],
    },
  ],
};
const context = { text: "The return value is part of a public protocol.", evidence: [], gaps: [] };
const diffHash = projectIndexReviewDiffHash(diff);
const output = {
  scopeId: resolved.scope.scopeId,
  workspaceFingerprint: resolved.scope.workspaceFingerprint,
  revision: 2,
  diffHash,
  partIndex: 0,
  findings: [
    {
      filePath: "value.ts",
      rangeIndex: 0,
      severity: "warning",
      category: "correctness",
      message: "This changes the public return value.",
      evidenceIds: [`diff:${diffHash}:value.ts`],
      diffExcerpt: "+return 2",
    },
  ],
};

const decodeRequestAnchor = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      scopeId: Schema.String,
      workspaceFingerprint: Schema.String,
      revision: Schema.Int,
      diffHash: Schema.String,
      partIndex: Schema.Int,
    }),
  ),
);

it.effect("grounds findings in an actual changed range and selected-content hash", () =>
  Effect.gen(function* () {
    const findings = yield* validateProjectIndexReviewOutput({
      resolved,
      revision: 2,
      diff,
      part: diff.diff,
      partIndex: 0,
      context,
      output,
    });
    assert.deepStrictEqual(findings[0]?.range, range);
    assert.strictEqual(findings[0]?.sourceHash, "selected-index-content");
    assert.strictEqual(findings[0]?.provenance, "llm");
    assert.strictEqual(findings[0]?.sourceSide, "after");
    assert.strictEqual(findings[0]?.diffExcerpt, "+return 2");
  }),
);

it.effect(
  "anchors removed-code findings to the before side without inventing a current source",
  () =>
    Effect.gen(function* () {
      const removed: ProjectIndexReviewDiff = {
        diff: "diff --git a/value.ts b/value.ts\n--- a/value.ts\n+++ /dev/null\n@@ -3 +0,0 @@\n-return 1\n",
        files: [
          {
            filePath: "value.ts",
            changedRanges: [range],
            sourceSide: "before",
            sourceHash: "deleted-source-content",
            rangePatches: ["@@ -3 +0,0 @@\n-return 1\n"],
          },
        ],
      };
      const removedHash = projectIndexReviewDiffHash(removed);
      const findings = yield* validateProjectIndexReviewOutput({
        resolved,
        revision: 2,
        diff: removed,
        part: removed.diff,
        partIndex: 0,
        context,
        output: {
          ...output,
          diffHash: removedHash,
          findings: [
            {
              ...output.findings[0],
              diffExcerpt: "-return 1",
              evidenceIds: [`diff:${removedHash}:value.ts`],
            },
          ],
        },
      });
      assert.strictEqual(findings[0]?.sourceSide, "before");
      assert.strictEqual(findings[0]?.sourceHash, "deleted-source-content");
      assert.strictEqual(findings[0]?.diffExcerpt, "-return 1");
      assert.deepStrictEqual(findings[0]?.range, range);
    }),
);

it.effect("rejects invented ranges, quotations, and project evidence", () =>
  Effect.gen(function* () {
    for (const patch of [
      { rangeIndex: 1 },
      { filePath: "other.ts" },
      { diffExcerpt: "+return 99" },
      { evidenceIds: ["invented"] },
    ]) {
      const outcome = yield* validateProjectIndexReviewOutput({
        resolved,
        revision: 2,
        diff,
        part: diff.diff,
        partIndex: 0,
        context,
        output: { ...output, findings: [{ ...output.findings[0], ...patch }] },
      }).pipe(Effect.result);
      assert.isTrue(Result.isFailure(outcome));
    }
  }),
);

it.effect("rejects a quotation taken from another file's hunk", () =>
  Effect.gen(function* () {
    const combined = {
      ...diff,
      diff: `${diff.diff}\n+different change`,
      files: [
        ...diff.files,
        {
          filePath: "other.ts",
          sourceHash: "other-hash",
          changedRanges: [range],
          rangePatches: ["+different change"],
        },
      ],
    };
    const combinedHash = projectIndexReviewDiffHash(combined);
    const result = yield* validateProjectIndexReviewOutput({
      resolved,
      revision: 2,
      diff: combined,
      part: combined.diff,
      partIndex: 0,
      context,
      output: {
        ...output,
        diffHash: combinedHash,
        findings: [
          {
            ...output.findings[0],
            filePath: "other.ts",
            evidenceIds: [`diff:${combinedHash}:other.ts`],
          },
        ],
      },
    }).pipe(Effect.result);
    assert.isTrue(Result.isFailure(result));
  }),
);

it.effect("rejects a staged diff changed during generation and releases admission", () =>
  Effect.gen(function* () {
    let reads = 0;
    let released = false;
    const bridge: ProjectIndexingBridgeShape = {
      resolveScope: () => Effect.succeed(resolved),
      listScopes: () => Effect.succeed([resolved]),
      capabilities: () => Effect.succeed({ contextWindowTokens: 32_768, maxOutputTokens: 8_192 }),
      admit: () =>
        Effect.succeed({
          release: Effect.sync(() => {
            released = true;
          }),
        }),
      reconcileWatchers: () => Effect.void,
      readDiff: ({ selection }) =>
        Effect.sync(() => {
          assert.strictEqual(selection, "staged");
          reads++;
          return reads === 1 ? diff : { ...diff, diff: diff.diff.replace("return 2", "return 3") };
        }),
      generate: (input) =>
        decodeRequestAnchor(input.prompt.split("\n\n").at(-1)).pipe(
          Effect.map((request) => ({ text: encodeProjectIndexJson({ ...request, findings: [] }) })),
          Effect.mapError(
            (cause) => new ProjectIndexRuntimeError({ detail: "Invalid test request", cause }),
          ),
        ),
    };
    const result = yield* reviewProjectIndexDiff({
      bridge,
      resolved,
      revision: 2,
      selection: "staged",
      modelSelection: { instanceId: ProviderInstanceId.make("selected"), model: "explicit" },
      context,
      assertCurrent: Effect.void,
    }).pipe(Effect.result);
    assert.isTrue(Result.isFailure(result));
    assert.strictEqual(reads, 2);
    assert.isTrue(released);
  }),
);
