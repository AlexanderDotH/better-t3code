import type { EnvironmentId } from "@t3tools/contracts";

export type GitActionsControlIntent =
  | "quick"
  | "commit-staged"
  | "stage-all-and-commit"
  | "pull"
  | "push"
  | "create-pull-request";

interface GitActionsControlRequest {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly intent: GitActionsControlIntent;
}

const EVENT_NAME = "t3:git-actions-control-request";

export function requestGitActionsControl(request: GitActionsControlRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GitActionsControlRequest>(EVENT_NAME, { detail: request }));
}

export function subscribeGitActionsControl(
  listener: (request: GitActionsControlRequest) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handle = (event: Event) =>
    listener((event as CustomEvent<GitActionsControlRequest>).detail);
  window.addEventListener(EVENT_NAME, handle);
  return () => window.removeEventListener(EVENT_NAME, handle);
}
