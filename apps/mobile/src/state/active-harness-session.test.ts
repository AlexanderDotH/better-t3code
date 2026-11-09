import {
  ProviderInstanceId,
  ThreadId,
  type OrchestrationHarnessSyncState,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { activeMobileHarnessSession } from "./active-harness-session";

it("blocks active imported sessions until detail clears them without borrowing another thread's state", () => {
  const id = ThreadId.make("synced-thread");
  const state: OrchestrationHarnessSyncState = {
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerLabel: "Codex",
    activity: "active",
    sourceUpdatedAt: null,
    lastSyncedAt: "2026-01-01T00:00:00.000Z",
  };
  const shell = { id, harnessSync: state };
  expect(activeMobileHarnessSession(id, undefined, shell)).toBe(state);
  expect(activeMobileHarnessSession(id, { id }, shell)).toBe(state);
  expect(activeMobileHarnessSession(id, { id, harnessSync: null }, shell)).toBeNull();
  expect(
    activeMobileHarnessSession(id, { id, harnessSync: { ...state, activity: "idle" } }, shell),
  ).toBeNull();
  expect(activeMobileHarnessSession(id, { id, harnessSync: state }, { id })).toBe(state);
  expect(activeMobileHarnessSession(ThreadId.make("new-thread"), shell, shell)).toBeNull();
  expect(activeMobileHarnessSession(null, shell, shell)).toBeNull();
});
