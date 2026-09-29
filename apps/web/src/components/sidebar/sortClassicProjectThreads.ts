import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import {
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
  type ThreadSortInput,
} from "@t3tools/client-runtime/state/thread-sort";

type ClassicProjectThread = {
  readonly id: string;
  readonly createdAt: string;
  readonly pinnedAt?: string | null | undefined;
  readonly pinOrderKey?: string | null | undefined;
  readonly activeOrderKey?: string | null | undefined;
  readonly unsettledAt?: string | null | undefined;
  readonly environmentId?: string | undefined;
} & Partial<ThreadSortInput>;

export function sortClassicProjectThreads<T extends ClassicProjectThread>(
  threads: readonly T[],
  sortOrder: SidebarThreadSortOrder,
): T[] {
  const pinned: T[] = [];
  const ordinary: T[] = [];
  for (const thread of threads) {
    (thread.pinnedAt == null ? ordinary : pinned).push(thread);
  }
  return [
    ...sortPinnedThreadsByOrderKey(pinned),
    ...sortActiveThreadsByOrderKey(ordinary, sortOrder),
  ];
}
