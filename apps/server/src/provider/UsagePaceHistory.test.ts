import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProviderUsageLimits,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { makeUsagePaceHistory, providerUsagePaceHistoryKey } from "./UsagePaceHistory.ts";

const beforeMidnight = "2026-09-15T23:00:00.000Z";
const checkedAt = "2026-09-16T12:00:00.000Z";
const limits = (at: string, usedPercent: number): ServerProviderUsageLimits => ({
  checkedAt: at,
  windows: [
    {
      id: "weekly",
      kind: "weekly",
      label: "Weekly",
      windowDurationMins: 10_080,
      resetsAt: "2026-09-20T00:00:00.000Z",
      usedPercent,
    },
  ],
});

it("keeps driver, account, workspace, and credential identities separate", () => {
  const provider = {
    instanceId: ProviderInstanceId.make("claude-one"),
    driver: ProviderDriverKind.make("claudeAgent"),
    auth: { status: "authenticated" as const, email: "One@example.com", workspaceId: "team-one" },
  };
  const key = providerUsagePaceHistoryKey(provider);
  expect(
    providerUsagePaceHistoryKey({
      ...provider,
      instanceId: ProviderInstanceId.make("claude-two"),
      auth: { ...provider.auth, email: "one@example.com" },
    }),
  ).toBe(key);
  for (const other of [
    { ...provider, driver: ProviderDriverKind.make("cursor") },
    { ...provider, auth: { ...provider.auth, email: "two@example.com" } },
    { ...provider, auth: { ...provider.auth, workspaceId: "team-two" } },
    {
      ...provider,
      usageLimits: { ...limits(checkedAt, 5), credentialFingerprint: "another-credential" },
    },
  ])
    expect(providerUsagePaceHistoryKey(other)).not.toBe(key);
  expect(
    providerUsagePaceHistoryKey({ ...provider, driver: ProviderDriverKind.make("codex") }),
  ).toBeUndefined();
  const verifiedQuota = {
    ...provider,
    auth: { status: "unknown" as const },
    usageLimits: { ...limits(checkedAt, 5), credentialFingerprint: "verified-account" },
  };
  expect(providerUsagePaceHistoryKey(verifiedQuota)).toBeDefined();
  expect(providerUsagePaceHistoryKey(verifiedQuota)).toBe(
    providerUsagePaceHistoryKey({
      ...verifiedQuota,
      auth: { status: "authenticated" },
    }),
  );
});

it.effect("restores observed baselines after restart and isolates accounts and reset epochs", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const first = yield* makeUsagePaceHistory(directory);
    yield* first.record({ key: "claude:one", limits: limits(beforeMidnight, 5) });
    const restarted = yield* makeUsagePaceHistory(directory);
    const fresh = limits(checkedAt, 6);
    const restored = yield* restarted.record({
      key: "claude:one",
      limits: {
        ...fresh,
        windows: fresh.windows.map((window) => ({
          ...window,
          usageHistory: [{ at: checkedAt, usedPercent: 6 }],
        })),
      },
    });
    expect(restored.windows[0]?.usageHistory).toEqual([
      { at: beforeMidnight, usedPercent: 5 },
      { at: checkedAt, usedPercent: 6 },
    ]);
    expect(
      (yield* restarted.record({ key: "claude:two", limits: fresh })).windows[0]?.usageHistory,
    ).toEqual([{ at: checkedAt, usedPercent: 6 }]);
    const failed = { checkedAt, windows: [], unavailable: { reason: "probeFailed" as const } };
    expect(yield* restarted.record({ key: "claude:one", limits: failed })).toBe(failed);
    const again = yield* makeUsagePaceHistory(directory);
    expect(
      (yield* again.record({ key: "claude:one", limits: fresh })).windows[0]?.usageHistory,
    ).toEqual(restored.windows[0]?.usageHistory);
    const reset = {
      ...fresh,
      windows: fresh.windows.map((window) => ({ ...window, usedPercent: 0 })),
    };
    expect(
      (yield* again.record({ key: "claude:one", limits: reset })).windows[0]?.usageHistory,
    ).toEqual([{ at: checkedAt, usedPercent: 0 }]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("leaves native Codex history and windows without a duration untouched", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const history = yield* makeUsagePaceHistory(directory);
    for (const window of [
      {
        ...limits(checkedAt, 5).windows[0]!,
        usageHistorySource: "codex" as const,
        usageHistory: [],
      },
      { ...limits(checkedAt, 5).windows[0]!, windowDurationMins: undefined },
    ]) {
      const current = { checkedAt, windows: [window] };
      expect(yield* history.record({ key: "account", limits: current })).toBe(current);
    }
    expect(yield* fs.readDirectory(directory)).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
