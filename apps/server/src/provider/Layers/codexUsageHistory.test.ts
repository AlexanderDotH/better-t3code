import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ServerProviderUsageLimits } from "@t3tools/contracts";
import { dailyUsagePace } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";

import { makeCodexUsageHistoryReader } from "./codexUsageHistory.ts";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 8, day, hour, minute).toISOString();
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

let home: string;
let transcript: string;
beforeEach(async () => {
  home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-usage-history-"));
  await NodeFSP.mkdir(NodePath.join(home, "sessions"));
  transcript = NodePath.join(home, "sessions", "rollout.jsonl");
});
afterEach(async () => {
  await NodeFSP.rm(home, { recursive: true, force: true });
});

describe("Codex native usage history", () => {
  it("keeps today's baseline through stale one-point readings from concurrent sessions", async () => {
    await NodeFSP.writeFile(
      transcript,
      metadata +
        usage(at(12, 20), 5) +
        usage(at(13, 8), 5, 100) +
        usage(at(13, 10), 28, 200) +
        usage(at(13, 10, 1), 27, 300) +
        usage(at(13, 11), 30, 400),
    );
    const read = makeCodexUsageHistoryReader(home);
    const snapshot = await read({
      ...limits,
      windows: [{ ...limits.windows[0]!, usedPercent: 30 }],
    });
    expect(dailyUsagePace(snapshot.windows[0]!, Date.parse(limits.checkedAt), 8)).toMatchObject({
      todayUsedPercent: 25,
      status: "exceeded",
      partial: false,
    });
    const lagging = await read({
      ...limits,
      windows: [{ ...limits.windows[0]!, usedPercent: 29 }],
    });
    expect(
      dailyUsagePace(lagging.windows[0]!, Date.parse(limits.checkedAt), 8)?.todayUsedPercent,
    ).toBe(24);

    await NodeFSP.appendFile(transcript, usage(at(13, 11, 1), 0) + usage(at(13, 11, 2), 2, 500));
    const redeemed = await read({
      ...limits,
      windows: [{ ...limits.windows[0]!, usedPercent: 2 }],
    });
    expect(dailyUsagePace(redeemed.windows[0]!, Date.parse(limits.checkedAt), 8)).toMatchObject({
      todayUsedPercent: 2,
      partial: false,
    });
  });

  it("recovers quota usage and the first token event before T3 started, even without a quota increase", async () => {
    await NodeFSP.writeFile(
      transcript,
      metadata +
        usage(at(12, 20), 3) +
        usage(at(13, 8), 3) +
        usage(at(13, 8, 3), 3, 200) +
        usage(at(13, 10), 6, 400),
    );
    const read = makeCodexUsageHistoryReader(home);
    const snapshot = await read(limits);
    expect(isUsageLimits(snapshot)).toBe(true);
    expect(dailyUsagePace(snapshot.windows[0]!, Date.parse(limits.checkedAt), 8)).toMatchObject({
      startedAt: Date.parse(at(13, 8, 3)),
      todayUsedPercent: 3,
      partial: false,
      status: "good",
    });
    expect(await makeCodexUsageHistoryReader(home)(limits)).toEqual(snapshot);

    await NodeFSP.appendFile(transcript, usage(at(13, 11), 7, 600).trimEnd());
    expect((await read(limits)).windows).toEqual(snapshot.windows);
    await NodeFSP.appendFile(transcript, "\n");
    const updated = await read({ ...limits, windows: [{ ...limits.windows[0]!, usedPercent: 7 }] });
    expect(updated.windows[0]?.usageHistory?.at(-1)).toMatchObject({
      at: at(13, 11),
      usedPercent: 7,
    });
    expect(dailyUsagePace(updated.windows[0]!, Date.parse(limits.checkedAt), 8)?.startedAt).toBe(
      Date.parse(at(13, 8, 3)),
    );
    await NodeFSP.writeFile(transcript, metadata + usage(at(13, 9), 0, 300));
    const replaced = await read({
      ...limits,
      windows: [{ ...limits.windows[0]!, usedPercent: 0 }],
    });
    expect(replaced.windows[0]?.usageHistory).toEqual([
      { at: at(13, 9), usedPercent: 0, hasUsage: true },
    ]);
  });

  it("reads archived CLI sessions, excludes other quota epochs, and does not infer absent activity", async () => {
    await NodeFSP.mkdir(NodePath.join(home, "archived_sessions"));
    await NodeFSP.writeFile(transcript, metadata + usage(at(13, 7), 40, 100, at(21, 12)));
    const read = makeCodexUsageHistoryReader(home);
    expect(
      dailyUsagePace((await read(limits)).windows[0]!, Date.parse(limits.checkedAt), 8),
    ).toMatchObject({ status: "unknown", startedAt: null, todayUsedPercent: null });
    await NodeFSP.writeFile(
      NodePath.join(home, "archived_sessions", "archived.jsonl"),
      metadata + usage(at(13, 8, 10), 6, 200),
    );
    expect(
      dailyUsagePace((await read(limits)).windows[0]!, Date.parse(limits.checkedAt), 8)?.startedAt,
    ).toBe(Date.parse(at(13, 8, 10)));
  });

  it("retains the first usage across a local midnight when quota percentages stay flat", async () => {
    const rows = Array.from({ length: 1_500 }, (_, minute) =>
      usage(
        new Date(new Date(2026, 8, 12, 20).getTime() + minute * 60_000).toISOString(),
        6,
        minute + 1,
      ),
    );
    await NodeFSP.writeFile(transcript, metadata + rows.join(""));
    const snapshot = await makeCodexUsageHistoryReader(home)(limits);
    expect(snapshot.windows[0]!.usageHistory!.length).toBeLessThan(100);
    expect(dailyUsagePace(snapshot.windows[0]!, Date.parse(limits.checkedAt), 8)?.startedAt).toBe(
      Date.parse(at(13, 0)),
    );
  });
});
