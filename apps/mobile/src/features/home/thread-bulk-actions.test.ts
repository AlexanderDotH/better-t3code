import { describe, expect, it } from "vite-plus/test";
import { CommandId, EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { makeThreadShellFixture } from "../../test-fixtures";
import { planThreadBulkAction } from "./thread-bulk-actions";

describe("bulk thread action planning", () => {
  const environmentId = EnvironmentId.make("local");
  const otherEnvironmentId = EnvironmentId.make("remote");
  const thread = makeThreadShellFixture({ environmentId, id: ThreadId.make("same") });
  const remote = { ...thread, environmentId: otherEnvironmentId };
  const supported = new Set([environmentId, otherEnvironmentId]);
  const plan = (
    action: Parameters<typeof planThreadBulkAction>[0]["action"],
    threads = [thread, remote],
    operateEnvironmentIds = supported,
  ) =>
    planThreadBulkAction({
      action,
      threads,
      operateEnvironmentIds,
      settlementEnvironmentIds: supported,
      snoozeEnvironmentIds: supported,
      pinningEnvironmentIds: supported,
      titleRegenerationEnvironmentIds: supported,
      now: "2026-11-11T12:00:00.000Z",
    });

  it("keeps equal thread IDs from different environments and deduplicates repeats", () => {
    expect(plan("mark-unread", [thread, remote, thread]).threads).toEqual([thread, remote]);
    expect(plan("mark-unread", [thread], new Set()).disabled).toBe(false);
  });

  it("targets only actionable pins, titles and settlements", () => {
    expect(plan("unpin").disabled).toBe(true);
    expect(
      plan("unpin", [{ ...thread, pinnedAt: "2026-11-11T10:00:00.000Z" }]).threads,
    ).toHaveLength(1);
    expect(
      plan("regenerate-title", [
        {
          ...thread,
          titleRegeneration: {
            requestId: CommandId.make("regenerate"),
            startedAt: "2026-11-11T10:00:00.000Z",
          },
        },
      ]).disabled,
    ).toBe(true);
    expect(plan("settle", [{ ...thread, settledOverride: "settled" }]).disabled).toBe(true);
  });

  it("disables a mutation when any destination has lost permission", () => {
    expect(plan("delete", [thread, remote], new Set([environmentId])).disabled).toBe(true);
  });

  it("rejects a snooze selection with a pending request and an archive with an active run", () => {
    expect(plan("snooze", [thread, { ...remote, hasPendingApprovals: true }]).disabled).toBe(true);
    expect(
      plan("archive", [
        {
          ...thread,
          runtime: {
            status: "running",
            activeRunId: null,
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerName: "Codex",
            lastError: null,
            updatedAt: thread.updatedAt,
          },
        },
      ]).disabled,
    ).toBe(true);
  });
});
