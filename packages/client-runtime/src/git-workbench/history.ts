export interface GitWorkbenchHistoryPage<Commit> {
  readonly queryKey: string;
  readonly snapshotOid: string;
  readonly commits: ReadonlyArray<Commit>;
  readonly nextCursor: string | null;
}

export interface GitWorkbenchHistory<Commit> {
  readonly queryKey: string;
  readonly snapshotOid: string | null;
  readonly commits: ReadonlyArray<Commit>;
  readonly nextCursor: string | null;
}

export function beginGitWorkbenchHistory<Commit>(queryKey: string): GitWorkbenchHistory<Commit> {
  return {
    queryKey,
    snapshotOid: null,
    commits: [],
    nextCursor: null,
  };
}

export function appendGitWorkbenchHistoryPage<Commit>(
  current: GitWorkbenchHistory<Commit>,
  page: GitWorkbenchHistoryPage<Commit>,
  identify: (commit: Commit) => string,
): GitWorkbenchHistory<Commit> {
  if (page.queryKey !== current.queryKey) {
    return current;
  }
  if (current.snapshotOid !== null && page.snapshotOid !== current.snapshotOid) {
    return current;
  }

  const known = new Set(current.commits.map(identify));
  const appended = page.commits.filter((commit) => {
    const id = identify(commit);
    if (known.has(id)) {
      return false;
    }
    known.add(id);
    return true;
  });

  return {
    queryKey: current.queryKey,
    snapshotOid: current.snapshotOid ?? page.snapshotOid,
    commits: [...current.commits, ...appended],
    nextCursor: page.nextCursor,
  };
}
