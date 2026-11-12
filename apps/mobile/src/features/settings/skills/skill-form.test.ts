import { ProjectId, ProviderInstanceId, type SkillDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { skillCreateFromDraft, skillDraftFromDescriptor, skillUpdateFromDraft } from "./skill-form";

describe("mobile skill forms", () => {
  it("serializes metadata and preserves instruction whitespace for both scopes", () => {
    const draft = {
      name: " reviewer ",
      description: " Review changes ",
      displayName: " Code review ",
      shortDescription: " Review ",
      body: "\n  Keep this indentation.\n",
    };
    const global = skillCreateFromDraft(draft, {
      scope: "global",
      projectId: "ignored",
      projectCwd: "/ignored",
    });
    expect(global).toEqual({
      name: "reviewer",
      description: "Review changes",
      displayName: "Code review",
      shortDescription: "Review",
      body: draft.body,
      scope: "global",
    });
    expect(
      skillCreateFromDraft(draft, {
        scope: "project",
        projectId: "p1",
        projectCwd: "/host/project",
      }),
    ).toEqual({ ...global, scope: "project", projectId: "p1", projectCwd: "/host/project" });
    expect(() =>
      skillCreateFromDraft(draft, { scope: "project", projectId: "p1", projectCwd: " " }),
    ).toThrow("projectRequired");
    for (const patch of [{ name: " " }, { description: " " }]) {
      expect(() =>
        skillCreateFromDraft(
          { ...draft, ...patch },
          { scope: "global", projectId: "", projectCwd: "" },
        ),
      ).toThrow("settings.skills.required");
    }
  });

  it("retains the renamed skill's provider, path and project target on update", () => {
    const skill: SkillDescriptor = {
      id: "project:reviewer",
      name: "reviewer",
      path: "/host/project/.agents/skills/reviewer/SKILL.md",
      scope: "project",
      enabled: true,
      readOnly: false,
      providerSupport: [],
      providerInstanceId: ProviderInstanceId.make("codex_work"),
      projectId: ProjectId.make("p1"),
      projectCwd: "/host/project",
      description: "Review",
      body: "Instructions",
      displayName: "Review code",
      shortDescription: "Review",
    };
    const draft = skillDraftFromDescriptor(skill);
    expect(draft).toEqual({
      name: "reviewer",
      description: "Review",
      body: "Instructions",
      displayName: "Review code",
      shortDescription: "Review",
    });
    const renamed = {
      ...skill,
      name: "new-reviewer",
      path: "/host/project/.agents/skills/new-reviewer/SKILL.md",
    };
    expect(
      skillUpdateFromDraft(
        { ...draft, name: renamed.name, displayName: "", shortDescription: "" },
        renamed,
      ),
    ).toEqual({
      target: {
        scope: "project",
        name: "new-reviewer",
        path: renamed.path,
        providerInstanceId: skill.providerInstanceId,
        projectId: skill.projectId,
        projectCwd: skill.projectCwd,
      },
      description: "Review",
      body: "Instructions",
      displayName: "",
      shortDescription: "",
    });
  });
});
