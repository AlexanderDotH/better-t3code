import { describe, expect, it } from "vite-plus/test";

import { isValidSkillName, parseSkillFile, serializeSkillFile } from "./skillFile.ts";

describe("skillFile", () => {
  it("parses Codex skill frontmatter and preserves the instruction body", () => {
    const parsed = parseSkillFile(`---
name: "review-follow-up"
description: "Use when reviewing follow-up changes."
metadata:
  display-name: "Review follow-up"
  short-description: "Focused review workflow"
---

# Guidance

Check changed files first.
`);

    expect(parsed).toEqual({
      name: "review-follow-up",
      description: "Use when reviewing follow-up changes.",
      displayName: "Review follow-up",
      shortDescription: "Focused review workflow",
      body: "# Guidance\n\nCheck changed files first.\n",
    });
  });

  it("serializes metadata as frontmatter that can be parsed again", () => {
    const contents = serializeSkillFile(
      {
        name: "plan-release",
        description: "Prepare a release checklist.",
        displayName: "Plan release",
        shortDescription: "Release checklist",
      },
      "\n# Guidance\n\nDraft the checklist.\n",
    );

    expect(parseSkillFile(contents)).toEqual({
      name: "plan-release",
      description: "Prepare a release checklist.",
      displayName: "Plan release",
      shortDescription: "Release checklist",
      body: "# Guidance\n\nDraft the checklist.\n",
    });
  });

  it("reads folded and literal descriptions from public skill frontmatter", () => {
    const folded = parseSkillFile(
      "---\nname: investigate-anything\ndescription: >-\n  Start an investigation.\n  Choose a workflow.\n---\n# Instructions",
    );
    expect(folded.description).toBe("Start an investigation. Choose a workflow.");
    const literal = parseSkillFile(
      "---\nname: review\ndescription: |\n  First line.\n  Second line.\n---\n# Instructions",
    );
    expect(literal.description).toBe("First line.\nSecond line.\n");
  });

  it("keeps the body readable when frontmatter is invalid", () => {
    expect(parseSkillFile("---\nname: [unfinished\n---\n# Instructions")).toMatchObject({
      name: null,
      body: "# Instructions",
    });
  });

  it("accepts only directory-safe skill names", () => {
    expect(isValidSkillName("review-follow-up")).toBe(true);
    expect(isValidSkillName("review_follow_up2")).toBe(true);
    expect(isValidSkillName("../escape")).toBe(false);
    expect(isValidSkillName("bad/name")).toBe(false);
    expect(isValidSkillName("-bad")).toBe(false);
  });
});
