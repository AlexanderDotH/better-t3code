import {
  MessageId,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Arbitrary from "effect/unstable/arbitrary/Arbitrary";

import { encodeShellSnapshotForCache } from "./persistence.ts";

// Bound the sample count while retaining enough size to populate optional
// fields, which generation omits when size is below the required field count.
const SAMPLE_OPTIONS = { count: 64, size: 30, seed: "shell-snapshot-cache" };
const PROJECT_ICONS = [
  undefined,
  null,
  { kind: "lucide", name: "folder-code", color: "blue" },
  { kind: "emoji", emoji: "🧪" },
  { kind: "monogram", text: "T3", color: "blue" },
] satisfies ReadonlyArray<OrchestrationProjectShell["projectIcon"]>;
const UPDATED_AT = "2026-09-25T00:00:00.000Z";

// Round-trip generated values so trimmed strings match client-held values.
const sampleDecoded = <S extends Schema.Constraint>(schema: S) =>
  Effect.gen(function* () {
    const encode = Schema.encodeEffect(schema);
    const decode = Schema.decodeEffect(schema);
    const generated = yield* Arbitrary.sampleEffect(Arbitrary.schema(schema), SAMPLE_OPTIONS);
    const decoded = yield* Effect.forEach(generated, (value) =>
      encode(value).pipe(Effect.flatMap(decode), Effect.option),
    );
    return Arr.getSomes(decoded);
  });
const encodeSnapshot = Schema.encodeEffect(OrchestrationShellSnapshot);
const decodeThreadShell = Schema.decodeEffect(OrchestrationThreadShell);

describe("encodeShellSnapshotForCache", () => {
  it.effect("matches the Schema encoding of a generated snapshot", () =>
    Effect.gen(function* () {
      const threads = yield* sampleDecoded(OrchestrationThreadShell);
      const projects = yield* sampleDecoded(OrchestrationProjectShell);
      expect(threads.length).toBeGreaterThan(0);
      expect(projects.length).toBeGreaterThanOrEqual(PROJECT_ICONS.length);

      const baseThread = Arr.getUnsafe(threads, 0);
      // Guarantee populated metadata even when generated branches fail normalization.
      const populatedThread = yield* decodeThreadShell({
        ...baseThread,
        session: {
          threadId: baseThread.id,
          status: "running",
          providerName: "codex",
          providerInstanceId: baseThread.modelSelection.instanceId,
          runtimeSessionId: null,
          runtimeMode: baseThread.runtimeMode,
          activeTurnId: null,
          abortState: null,
          lastError: null,
          updatedAt: UPDATED_AT,
        },
        harnessSync: {
          providerInstanceId: baseThread.modelSelection.instanceId,
          providerLabel: "Codex",
          activity: "active",
          sourceUpdatedAt: UPDATED_AT,
          lastSyncedAt: UPDATED_AT,
        },
        fork: {
          provenance: {
            sourceThreadId: baseThread.id,
            sourceTitle: baseThread.title,
            boundary: { kind: "message", messageId: MessageId.make("fork-boundary") },
            forkedAt: UPDATED_AT,
          },
          workspace: {
            spec: {
              mode: "local",
              baseBranch: null,
              startFromOrigin: false,
              runSetupScript: false,
            },
            status: "ready",
            preparedAt: UPDATED_AT,
            lastError: null,
          },
          handoff: {
            status: "pending",
            historyInputChars: 100,
            historyAttachmentCount: 1,
            remainingInputChars: 900,
            remainingAttachmentCount: 9,
            completedAt: null,
          },
        },
      });
      const snapshot: OrchestrationShellSnapshot = {
        snapshotSequence: 1,
        // Exercise every icon variant, including the monogram wire transform.
        projects: projects.map((project, index) => ({
          ...project,
          projectIcon: PROJECT_ICONS[index % PROJECT_ICONS.length],
        })),
        threads: [...threads, populatedThread],
        updatedAt: UPDATED_AT,
      };

      expect(yield* encodeShellSnapshotForCache(snapshot)).toEqual(yield* encodeSnapshot(snapshot));
    }),
  );
});
