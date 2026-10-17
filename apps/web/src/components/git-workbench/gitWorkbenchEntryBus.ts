import type { EnvironmentId } from "@t3tools/contracts";

export interface GitWorkbenchEntryRequest {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly focusCommit?: boolean;
  readonly returnFocusTarget: HTMLElement | null;
}

type EntryListener = (request: GitWorkbenchEntryRequest) => boolean;

const listeners = new Set<EntryListener>();

export function requestGitWorkbenchEntry(
  request: Omit<GitWorkbenchEntryRequest, "returnFocusTarget">,
): boolean {
  const activeElement = typeof document === "undefined" ? null : document.activeElement;
  const entry: GitWorkbenchEntryRequest = {
    ...request,
    returnFocusTarget:
      typeof HTMLElement !== "undefined" && activeElement instanceof HTMLElement
        ? activeElement
        : null,
  };
  for (const listener of listeners) {
    if (listener(entry)) return true;
  }
  return false;
}

export function subscribeGitWorkbenchEntry(listener: EntryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
