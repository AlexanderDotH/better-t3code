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

  it("accepts only directory-safe skill names", () => {
    expect(isValidSkillName("review-follow-up")).toBe(true);
    expect(isValidSkillName("review_follow_up2")).toBe(true);
    expect(isValidSkillName("../escape")).toBe(false);
    expect(isValidSkillName("bad/name")).toBe(false);
    expect(isValidSkillName("-bad")).toBe(false);
  });
});
