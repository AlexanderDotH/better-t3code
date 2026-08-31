import type { GitHistoryState } from "./GitWorkbench.types";

export const EMPTY_HISTORY: GitHistoryState = {
  commits: [],
  hasMore: false,
  loading: false,
  snapshotOid: null,
};

export const CODE_MIX_COLORS = ["#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#94a3b8"];

export function relativeAge(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "time unavailable";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
