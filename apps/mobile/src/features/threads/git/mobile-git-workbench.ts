import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

import type { MobileGitWorkbenchAvailability } from "../../../state/git-workbench-availability";
export {
  resolveMobileGitWorkbenchAvailability,
  mobileGitWorkbenchCanActivate,
  gateMobileGitWorkbenchTarget,
  type MobileGitWorkbenchAvailability,
} from "../../../state/git-workbench-availability";

export function mobileGitWorkbenchStatusMessageKey(
  availability: MobileGitWorkbenchAvailability,
): InterfaceMessageKey {
  switch (availability.state) {
    case "available":
      return "settings.betterT3.control.statusEnabled";
    case "disabled":
      return "settings.betterT3.control.statusDisabled";
    case "unsupported":
      return "settings.betterT3.status.unsupported";
    case "context-required":
      return "settings.betterT3.status.projectRequired";
    case "loading":
      return "settings.betterT3.status.loading";
  }
}

export function resolveMobileGitWorkbenchBlockedRoute(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  return {
    name: "Thread" as const,
    params: {
      environmentId: String(input.environmentId),
      threadId: String(input.threadId),
    },
  };
}

export interface MobileGitWorkbenchThread {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export function buildMobileGitWorkbenchThreadOptions(
  threads: ReadonlyArray<MobileGitWorkbenchThread>,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<{
  readonly threadId: ThreadId;
  readonly label: string;
  readonly selected: false;
}> {
  return threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.projectId === projectId &&
        thread.archivedAt === null,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((thread) => ({ threadId: thread.id, label: thread.title, selected: false as const }));
}
