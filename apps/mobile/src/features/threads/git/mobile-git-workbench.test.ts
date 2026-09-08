import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMobileGitWorkbenchThreadOptions,
  gateMobileGitWorkbenchTarget,
  mobileGitWorkbenchCanActivate,
  mobileGitWorkbenchStatusMessageKey,
  resolveMobileGitWorkbenchAvailability,
  resolveMobileGitWorkbenchBlockedRoute,
} from "./mobile-git-workbench";

const environmentId = EnvironmentId.make("environment-git");
const projectId = ProjectId.make("project-git");
const threadId = ThreadId.make("thread-git");

describe("mobile Git workbench availability", () => {
  it("blocks every new target while the saved feature flag is off", () => {
    const availability = resolveMobileGitWorkbenchAvailability({
      featureEnabled: false,
      gitWorkbenchVersion: 1,
      environmentId,
      threadId,
    });

    expect(availability).toEqual({ state: "disabled" });
    expect(mobileGitWorkbenchCanActivate(availability)).toBe(false);
    expect(gateMobileGitWorkbenchTarget(availability, { environmentId, threadId })).toBeNull();
    expect(mobileGitWorkbenchStatusMessageKey(availability)).toBe(
      "settings.betterT3.control.statusDisabled",
    );
  });

  it("keeps the enabled preference inert until the environment advertises capability v1", () => {
    const availability = resolveMobileGitWorkbenchAvailability({
      featureEnabled: true,
      gitWorkbenchVersion: undefined,
      environmentId,
      threadId,
    });

    expect(availability).toEqual({ state: "unsupported" });
    expect(mobileGitWorkbenchCanActivate(availability)).toBe(false);
    expect(mobileGitWorkbenchStatusMessageKey(availability)).toBe(
      "settings.betterT3.status.unsupported",
    );
  });

  it("requires an explicit thread and becomes reversible without changing the target", () => {
    const missingThread = resolveMobileGitWorkbenchAvailability({
      featureEnabled: true,
      gitWorkbenchVersion: 1,
      environmentId,
      threadId: null,
    });
    const enabled = resolveMobileGitWorkbenchAvailability({
      featureEnabled: true,
      gitWorkbenchVersion: 1,
      environmentId,
      threadId,
    });

    expect(missingThread).toEqual({ state: "context-required" });
    expect(mobileGitWorkbenchStatusMessageKey(missingThread)).toBe(
      "settings.betterT3.status.projectRequired",
    );
    expect(enabled).toEqual({ state: "available" });
    expect(gateMobileGitWorkbenchTarget(enabled, { environmentId, threadId })).toEqual({
      environmentId,
      threadId,
    });
  });

  it("returns blocked direct routes to their non-destructive thread owner", () => {
    expect(resolveMobileGitWorkbenchBlockedRoute({ environmentId, threadId })).toEqual({
      name: "Thread",
      params: { environmentId: String(environmentId), threadId: String(threadId) },
    });
  });

  it("offers only active threads from the explicitly selected environment and project", () => {
    const otherEnvironmentId = EnvironmentId.make("environment-other");
    const otherProjectId = ProjectId.make("project-other");
    const options = buildMobileGitWorkbenchThreadOptions(
      [
        {
          environmentId,
          projectId,
          id: ThreadId.make("older"),
          title: "Older",
          updatedAt: "2026-08-01T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId,
          projectId,
          id: ThreadId.make("newer"),
          title: "Newer",
          updatedAt: "2026-08-02T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId,
          projectId,
          id: ThreadId.make("archived"),
          title: "Archived",
          updatedAt: "2026-08-03T00:00:00.000Z",
          archivedAt: "2026-08-04T00:00:00.000Z",
        },
        {
          environmentId,
          projectId: otherProjectId,
          id: ThreadId.make("other-project"),
          title: "Other project",
          updatedAt: "2026-08-04T00:00:00.000Z",
          archivedAt: null,
        },
        {
          environmentId: otherEnvironmentId,
          projectId,
          id: ThreadId.make("other-environment"),
          title: "Other environment",
          updatedAt: "2026-08-05T00:00:00.000Z",
          archivedAt: null,
        },
      ],
      environmentId,
      projectId,
    );

    expect(options).toEqual([
      { threadId: ThreadId.make("newer"), label: "Newer", selected: false },
      { threadId: ThreadId.make("older"), label: "Older", selected: false },
    ]);
  });
});
