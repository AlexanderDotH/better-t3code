import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

type ScopeProject = Pick<EnvironmentProject, "environmentId" | "id">;
type ScopeThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "worktreePath"
>;

export function initialProjectIndexScope(input: {
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<ScopeProject>;
  readonly threads: ReadonlyArray<ScopeThread>;
  readonly projectId?: ProjectId;
  readonly threadId?: ThreadId;
}) {
  const projects = input.projects.filter(
    (project) => project.environmentId === input.environmentId,
  );
  const threads = input.threads.filter(
    (thread) =>
      thread.environmentId === input.environmentId &&
      projects.some((project) => project.id === thread.projectId),
  );
  const explicitThread = input.threadId
    ? threads.find((thread) => thread.id === input.threadId)
    : null;
  if (input.projectId !== undefined || input.threadId !== undefined) {
    return {
      projectId: input.projectId ?? explicitThread?.projectId ?? null,
      threadId: explicitThread?.worktreePath === null ? null : (input.threadId ?? null),
    };
  }
  return { projectId: null, threadId: null };
}

export function projectIndexWorktrees<Thread extends ScopeThread & { readonly title: string }>(
  threads: ReadonlyArray<Thread>,
  environmentId: EnvironmentId,
  projectId: ProjectId | null,
) {
  return threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.projectId === projectId &&
        thread.worktreePath !== null,
    )
    .toSorted((left, right) => left.title.localeCompare(right.title));
}
