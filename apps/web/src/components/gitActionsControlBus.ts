import type {
  EnvironmentId,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
} from "@t3tools/contracts";

export type GitActionsControlIntent =
  | "quick"
  | "commit-staged"
  | "stage-all-and-commit"
  | "pull"
  | "push"
  | "open-pull-request"
  | "create-pull-request";

interface GitActionsControlScope {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

interface GitActionsControlIntentRequest extends GitActionsControlScope {
  readonly intent: GitActionsControlIntent;
}

export type GitCommitOutcome =
  | { readonly status: "success"; readonly result: GitRunStackedActionResult }
  | { readonly status: "failure"; readonly message: string }
  | { readonly status: "cancelled" }
  | { readonly status: "queued" }
  | {
      readonly status: "blocked";
      readonly reason: "changed" | "empty" | "busy" | "unavailable" | "operation";
    };

export interface GitCommitRequestInput extends GitActionsControlScope {
  readonly expectedStateToken: string;
  readonly commitSelection: NonNullable<GitRunStackedActionInput["commitSelection"]>;
  readonly commitMessage?: string;
  readonly featureBranch?: boolean;
}

interface GitCommitControlRequest extends GitCommitRequestInput {
  readonly intent: "execute-commit";
  readonly claim: () => boolean;
  readonly complete: (outcome: GitCommitOutcome) => void;
}

type GitActionsControlRequest = GitActionsControlIntentRequest | GitCommitControlRequest;

const EVENT_NAME = "t3:git-actions-control-request";

export function requestGitActionsControl(request: GitActionsControlIntentRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GitActionsControlRequest>(EVENT_NAME, { detail: request }));
}

/** A matching control claims the request once and reports the result of its existing runner. */
export function requestGitCommit(input: GitCommitRequestInput): Promise<GitCommitOutcome> {
  if (typeof window === "undefined") {
    return Promise.resolve({ status: "blocked", reason: "unavailable" });
  }
  return new Promise((resolve) => {
    let claimed = false;
    let completed = false;
    const complete = (outcome: GitCommitOutcome) => {
      if (completed) return;
      completed = true;
      resolve(outcome);
    };
    const request: GitCommitControlRequest = {
      ...input,
      intent: "execute-commit",
      claim: () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      complete,
    };
    window.dispatchEvent(
      new CustomEvent<GitActionsControlRequest>(EVENT_NAME, { detail: request }),
    );
    if (!claimed) complete({ status: "blocked", reason: "unavailable" });
  });
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
