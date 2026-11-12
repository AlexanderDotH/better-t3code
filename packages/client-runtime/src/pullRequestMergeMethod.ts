import type { PullRequestMergeMethod } from "@t3tools/contracts";

export function resolvePullRequestMergeMethod(
  allowed: ReadonlyArray<PullRequestMergeMethod>,
  current: PullRequestMergeMethod | null,
  projectDefault: PullRequestMergeMethod | null | undefined,
  lastSelected: PullRequestMergeMethod,
): PullRequestMergeMethod {
  for (const method of [current, projectDefault, lastSelected]) {
    if (method && allowed.includes(method)) return method;
  }
  return allowed[0] ?? "merge";
}
