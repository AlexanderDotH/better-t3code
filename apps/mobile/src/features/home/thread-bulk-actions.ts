import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentId } from "@t3tools/contracts";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { threadCanArchive } from "./threadArchive";

export type ThreadBulkAction =
  | "settle"
  | "snooze"
  | "unpin"
  | "regenerate-title"
  | "mark-unread"
  | "archive"
  | "delete";

export function planThreadBulkAction(input: {
  readonly action: ThreadBulkAction;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly operateEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly settlementEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly snoozeEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly pinningEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly titleRegenerationEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly now: string;
}) {
  const threads = [
    ...new Map(
      input.threads.map((thread) => [scopedThreadKey(thread.environmentId, thread.id), thread]),
    ).values(),
  ].filter((thread) => {
    if (thread.archivedAt !== null) return false;
    if (input.action === "settle") return thread.settledOverride !== "settled";
    if (input.action === "unpin") return thread.pinnedAt != null;
    if (input.action === "regenerate-title") return thread.titleRegeneration == null;
    return true;
  });
  const available = (thread: EnvironmentThreadShell) => {
    if (input.action === "mark-unread") return true;
    if (!input.operateEnvironmentIds.has(thread.environmentId)) return false;
    switch (input.action) {
      case "settle":
        return input.settlementEnvironmentIds.has(thread.environmentId);
      case "snooze":
        return (
          input.snoozeEnvironmentIds.has(thread.environmentId) &&
          canSnooze(thread, { now: input.now })
        );
      case "unpin":
        return input.pinningEnvironmentIds.has(thread.environmentId);
      case "regenerate-title":
        return input.titleRegenerationEnvironmentIds.has(thread.environmentId);
      case "archive":
        return threadCanArchive(thread.runtime);
      case "delete":
        return true;
    }
  };
  return { threads, disabled: threads.length === 0 || !threads.every(available) };
}
