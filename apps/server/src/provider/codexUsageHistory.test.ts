// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ServerProviderUsageLimits } from "@t3tools/contracts";
import { dailyUsagePace } from "@t3tools/shared/usageLimits";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { usageHardBudgetBlockReason } from "./usageHardBudget.ts";
import { makeCodexUsageHistoryReader } from "./codexUsageHistory.ts";

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const at = (day: number, hour: number, minute = 0) =>
  DateTime.formatIso(
    DateTime.makeZonedUnsafe(
      { year: 2026, month: 9, day, hour, minute },
      { adjustForTimeZone: true },
    ),
  );
const resetsAt = at(20, 12);
const isUsageLimits = Schema.is(ServerProviderUsageLimits);
const limits: ServerProviderUsageLimits = {
  checkedAt: at(13, 12),
  windows: [
    {
      id: "primary",
      label: "Weekly",
      kind: "weekly",
      usedPercent: 6,
      resetsAt,
      windowDurationMins: 10_080,
    },
  ],
};
const withUsed = (usedPercent: number): ServerProviderUsageLimits => ({
  ...limits,
  windows: [{ ...limits.windows[0]!, usedPercent }],
});
const metadata = [
  { type: "session_meta", timestamp: at(12, 10), payload: { id: "native-cli-session" } },
  { type: "turn_context", payload: { model: "gpt-5.6-sol" } },
]
  .map((row) => JSON.stringify(row) + "\n")
  .join("");

function usage(timestamp: string, usedPercent: number, tokens = 0, reset = resetsAt) {
  return (
    JSON.stringify({
      type: "event_msg",
      timestamp,
      payload: {
        type: "token_count",
        info: tokens ? { last_token_usage: { input_tokens: tokens, output_tokens: 1 } } : null,
        rate_limits: {
          limit_id: "codex",
          plan_type: "pro",
          primary: {
            used_percent: usedPercent,
            window_minutes: 10_080,
            resets_at: Date.parse(reset) / 1_000,
          },
        },
      },
    }) + "\n"
  );
}

const withCodexHome = (
  test: (home: string, transcript: string) => Effect.Effect<void>,
): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-usage-history-"))),
    (home) =>
      Effect.promise(() => NodeFSP.mkdir(NodePath.join(home, "sessions"))).pipe(
        Effect.andThen(test(home, NodePath.join(home, "sessions", "rollout.jsonl"))),
      ),
    (home) => Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );

const writeFile = (path: string, content: string) =>
  Effect.promise(() => NodeFSP.writeFile(path, content));
const appendFile = (path: string, content: string) =>
  Effect.promise(() => NodeFSP.appendFile(path, content));

const reader = (home: string) => makeCodexUsageHistoryReader(home);
const paceAt = (snapshot: ServerProviderUsageLimits) =>
  dailyUsagePace(snapshot.windows[0]!, Date.parse(limits.checkedAt), 8);

describe("Codex native usage history", () => {
  it.effect("keeps today's baseline through stale readings and lets the hard budget decide", () =>
    withCodexHome((home, transcript) =>
      Effect.gen(function* () {
        yield* writeFile(
          transcript,
          metadata +
            usage(at(12, 20), 5) +
            usage(at(13, 8), 5, 100) +
            usage(at(13, 10), 28, 200) +
            usage(at(13, 10, 1), 27, 300) +
            usage(at(13, 11), 30, 400),
        );
        const read = reader(home);
        const snapshot = yield* read(withUsed(30));
        expect(paceAt(snapshot)).toMatchObject({
          todayUsedPercent: 25,
          status: "exceeded",
          partial: false,
        });
        expect(usageHardBudgetBlockReason(snapshot, Date.parse(limits.checkedAt))).toContain(
          "reached",
        );
        expect(paceAt(yield* read(withUsed(29)))?.todayUsedPercent).toBe(24);

        yield* appendFile(transcript, usage(at(13, 11, 1), 0) + usage(at(13, 11, 2), 2, 500));
        const redeemed = yield* read(withUsed(2));
        expect(paceAt(redeemed)).toMatchObject({ todayUsedPercent: 2, partial: false });
        expect(usageHardBudgetBlockReason(redeemed, Date.parse(limits.checkedAt))).toBeNull();
      }),
    ),
  );

  it.effect(
    "recovers usage and the first token event from before T3 started, resuming appended lines",
    () =>
      withCodexHome((home, transcript) =>
        Effect.gen(function* () {
          yield* writeFile(
            transcript,
            metadata +
              usage(at(12, 20), 3) +
              usage(at(13, 8), 3) +
              usage(at(13, 8, 3), 3, 200) +
              usage(at(13, 10), 6, 400),
          );
          const read = reader(home);
          const snapshot = yield* read(limits);
          expect(isUsageLimits(snapshot)).toBe(true);
          expect(paceAt(snapshot)).toMatchObject({
            startedAt: Date.parse(at(13, 8, 3)),
            todayUsedPercent: 3,
            partial: false,
            status: "good",
          });
          expect(yield* reader(home)(limits)).toEqual(snapshot);

          yield* appendFile(transcript, usage(at(13, 11), 7, 600).trimEnd());
          expect((yield* read(limits)).windows).toEqual(snapshot.windows);
          yield* appendFile(transcript, "\n");
          const updated = yield* read(withUsed(7));
          expect(updated.windows[0]?.usageHistory?.at(-1)).toMatchObject({
            at: at(13, 11),
            usedPercent: 7,
          });
          expect(paceAt(updated)?.startedAt).toBe(Date.parse(at(13, 8, 3)));
          yield* writeFile(transcript, metadata + usage(at(13, 9), 0, 300));
          expect((yield* read(withUsed(0))).windows[0]?.usageHistory).toEqual([
            { at: at(13, 9), usedPercent: 0, hasUsage: true },
          ]);
        }),
      ),
  );

  it.effect(
    "reads archived sessions, excludes other quota epochs, and does not infer absent activity",
    () =>
      withCodexHome((home, transcript) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => NodeFSP.mkdir(NodePath.join(home, "archived_sessions")));
          yield* writeFile(transcript, metadata + usage(at(13, 7), 40, 100, at(21, 12)));
          const read = reader(home);
          expect(paceAt(yield* read(limits))).toMatchObject({
            status: "unknown",
            startedAt: null,
            todayUsedPercent: null,
          });
          yield* writeFile(
            NodePath.join(home, "archived_sessions", "archived.jsonl"),
            metadata + usage(at(13, 8, 10), 6, 200),
          );
          expect(paceAt(yield* read(limits))?.startedAt).toBe(Date.parse(at(13, 8, 10)));
        }),
      ),
  );

  it.effect(
    "retains the first usage across a local midnight when quota percentages stay flat",
    () =>
      withCodexHome((home, transcript) =>
        Effect.gen(function* () {
          const rows = Array.from({ length: 1_500 }, (_, minute) =>
            usage(iso(Date.parse(at(12, 20)) + minute * 60_000), 6, minute + 1),
          );
          yield* writeFile(transcript, metadata + rows.join(""));
          const snapshot = yield* reader(home)(limits);
          expect(snapshot.windows[0]!.usageHistory!.length).toBeLessThan(100);
          expect(paceAt(snapshot)?.startedAt).toBe(Date.parse(at(13, 0)));
        }),
      ),
  );
});
