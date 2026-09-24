import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { deriveProjectIndexChatStatus } from "@t3tools/client-runtime/project-indexing";
import type {
  EnvironmentId,
  ProjectId,
  ProjectIndexActivityV1,
  ScopedProjectRef,
  ThreadId,
} from "@t3tools/contracts";

export interface ScopedProjectIndexActivity {
  readonly environmentId: EnvironmentId;
  readonly activity: ProjectIndexActivityV1;
}

function activityPriority(state: ProjectIndexActivityV1["state"]): number {
  switch (state) {
    case "queued":
    case "discovering":
    case "extracting":
    case "analyzing":
    case "updating":
      return 3;
    case "waiting-for-provider":
    case "waiting-for-resources":
      return 2;
    case "partial":
    case "paused":
    case "failed":
      return 1;
    default:
      return 0;
  }
}

function preferActivity(
  candidate: ProjectIndexActivityV1,
  previous: ProjectIndexActivityV1,
  preferredThreadId?: ThreadId,
): boolean {
  const candidatePriority = activityPriority(candidate.state);
  const previousPriority = activityPriority(previous.state);
  if (candidatePriority !== previousPriority) return candidatePriority > previousPriority;

  if (preferredThreadId !== undefined) {
    const candidateIsPreferred = candidate.scope.threadId === preferredThreadId;
    const previousIsPreferred = previous.scope.threadId === preferredThreadId;
    if (candidateIsPreferred !== previousIsPreferred) return candidateIsPreferred;
  }

  if (candidate.updatedAt !== previous.updatedAt) return candidate.updatedAt > previous.updatedAt;
  return candidate.scope.scopeId > previous.scope.scopeId;
}

export function selectProjectIndexActivity(
  scopes: ReadonlyMap<string, ProjectIndexActivityV1> | undefined,
  projectId: ProjectId,
  preferredThreadId?: ThreadId,
): ProjectIndexActivityV1 | null {
  let selected: ProjectIndexActivityV1 | null = null;
  for (const activity of scopes?.values() ?? []) {
    if (activity.scope.projectId !== projectId || deriveProjectIndexChatStatus(activity) === null)
      continue;
    if (selected === null || preferActivity(activity, selected, preferredThreadId)) {
      selected = activity;
    }
  }
  return selected;
}

export function selectActiveProjectIndexActivities(
  activitiesByEnvironment: ReadonlyMap<EnvironmentId, ReadonlyMap<string, ProjectIndexActivityV1>>,
  previousSelection?: ReadonlyMap<string, ScopedProjectIndexActivity>,
): ReadonlyMap<string, ScopedProjectIndexActivity> {
  const selected = new Map<string, ScopedProjectIndexActivity>();
  for (const [environmentId, scopes] of activitiesByEnvironment) {
    for (const activity of scopes.values()) {
      const status = deriveProjectIndexChatStatus(activity);
      if (status === null || activityPriority(status.state) < 2) continue;

      const projectKey = scopedProjectKey(scopeProjectRef(environmentId, activity.scope.projectId));
      const previous = selected.get(projectKey);
      if (previous === undefined || preferActivity(activity, previous.activity)) {
        const unchanged = previousSelection?.get(projectKey);
        selected.set(
          projectKey,
          unchanged?.environmentId === environmentId && unchanged.activity === activity
            ? unchanged
            : { environmentId, activity },
        );
      }
    }
  }
  return selected;
}

export function selectProjectGroupIndexingActivity(
  activeByProject: ReadonlyMap<string, ScopedProjectIndexActivity>,
  projectRefs: ReadonlyArray<ScopedProjectRef>,
): ScopedProjectIndexActivity | null {
  let selected: ScopedProjectIndexActivity | null = null;
  for (const projectRef of projectRefs) {
    const candidate = activeByProject.get(scopedProjectKey(projectRef));
    if (candidate && (selected === null || preferActivity(candidate.activity, selected.activity))) {
      selected = candidate;
    }
  }
  return selected;
}
