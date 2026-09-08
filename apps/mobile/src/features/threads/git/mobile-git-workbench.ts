import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { InterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

export type MobileGitWorkbenchAvailability =
  | { readonly state: "loading" }
  | { readonly state: "disabled" }
  | { readonly state: "unsupported" }
  | { readonly state: "context-required" }
  | { readonly state: "available" };

export function resolveMobileGitWorkbenchAvailability(input: {
  readonly featureEnabled: boolean | null;
  readonly gitWorkbenchVersion: number | undefined;
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): MobileGitWorkbenchAvailability {
  if (input.featureEnabled === null) return { state: "loading" };
  if (!input.featureEnabled) return { state: "disabled" };
  if ((input.gitWorkbenchVersion ?? 0) < 1) return { state: "unsupported" };
  if (input.environmentId === null || input.threadId === null) {
    return { state: "context-required" };
  }
  return { state: "available" };
}

export function mobileGitWorkbenchCanActivate(
  availability: MobileGitWorkbenchAvailability,
): boolean {
  return availability.state === "available";
}

export function gateMobileGitWorkbenchTarget<T>(
  availability: MobileGitWorkbenchAvailability,
  target: T,
): T | null {
  return mobileGitWorkbenchCanActivate(availability) ? target : null;
}

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
