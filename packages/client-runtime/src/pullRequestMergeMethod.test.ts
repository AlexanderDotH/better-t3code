import { ProjectId, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { describe, expect, it } from "vite-plus/test";
import { resolvePullRequestMergeMethod } from "./pullRequestMergeMethod.ts";

describe("pull request merge method", () => {
  it("uses the server/project default before the device's last choice", () => {
    const projectId = ProjectId.make("project");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      pullRequestMergeMethod: "merge" as const,
      projectSettingsOverrides: { [projectId]: { pullRequestMergeMethod: "rebase" as const } },
    };
    const allowed = ["merge", "squash", "rebase"] as const;
    const environmentDefault = resolveProjectSettings(settings, null).settings
      .pullRequestMergeMethod;
    const projectDefault = resolveProjectSettings(settings, projectId).settings
      .pullRequestMergeMethod;
    expect(resolvePullRequestMergeMethod(allowed, null, environmentDefault, "squash")).toBe(
      "merge",
    );
    expect(resolvePullRequestMergeMethod(allowed, null, projectDefault, "squash")).toBe("rebase");
    expect(resolvePullRequestMergeMethod(allowed, "squash", projectDefault, "merge")).toBe(
      "squash",
    );
    expect(resolvePullRequestMergeMethod(["merge"], "rebase", projectDefault, "squash")).toBe(
      "merge",
    );
    expect(resolvePullRequestMergeMethod(allowed, null, undefined, "squash")).toBe("squash");
  });
});
