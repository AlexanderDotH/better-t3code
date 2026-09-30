import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

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
