import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";

import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { searchSlashCommandItems } from "./composerSlashCommandSearch";

describe("searchSlashCommandItems", () => {
  const claudeDriver = ProviderDriverKind.make("claudeAgent");
  type SlashSearchItem = Extract<
    ComposerCommandItem,
    { type: "slash-command" | "provider-slash-command" | "skill" }
  >;

  it("moves exact provider command matches ahead of broader description matches", () => {
    const items = [
      {
        id: "slash:default",
        type: "slash-command",
        command: "default",
        label: "/default",
        description: "Switch this thread back to normal build mode",
      },
      {
        id: "provider-slash-command:claudeAgent:ui",
        type: "provider-slash-command",
        provider: claudeDriver,
        command: { name: "ui" },
        label: "/ui",
        description: "Explore, build, and refine UI.",
      },
      {
        id: "provider-slash-command:claudeAgent:frontend-design",
        type: "provider-slash-command",
        provider: claudeDriver,
        command: { name: "frontend-design" },
        label: "/frontend-design",
        description: "Create distinctive, production-grade frontend interfaces",
      },
    ] satisfies Array<SlashSearchItem>;

    expect(searchSlashCommandItems(items, "ui").map((item) => item.id)).toEqual([
      "provider-slash-command:claudeAgent:ui",
      "slash:default",
    ]);
  });

  it("supports fuzzy provider command matches", () => {
    const items = [
      {
        id: "provider-slash-command:claudeAgent:gh-fix-ci",
        type: "provider-slash-command",
        provider: claudeDriver,
        command: { name: "gh-fix-ci" },
        label: "/gh-fix-ci",
        description: "Fix failing GitHub Actions",
      },
      {
        id: "provider-slash-command:claudeAgent:github",
        type: "provider-slash-command",
        provider: claudeDriver,
        command: { name: "github" },
        label: "/github",
        description: "General GitHub help",
      },
    ] satisfies Array<SlashSearchItem>;

    expect(searchSlashCommandItems(items, "gfc").map((item) => item.id)).toEqual([
      "provider-slash-command:claudeAgent:gh-fix-ci",
    ]);
  });

  it("matches skills by command name and display name", () => {
    const items = [
      {
        id: "skill:codex:review-follow-up",
        type: "skill",
        provider: ProviderDriverKind.make("codex"),
        skill: {
          name: "review-follow-up",
          displayName: "Review follow-up",
          description: "Review follow-up changes",
          path: "/tmp/skills/review-follow-up/SKILL.md",
          scope: "user",
          enabled: true,
        },
        label: "/review-follow-up",
        description: "Review follow-up changes",
      },
      {
        id: "provider-slash-command:claudeAgent:review",
        type: "provider-slash-command",
        provider: claudeDriver,
        command: { name: "review" },
        label: "/review",
        description: "Run a generic review",
      },
    ] satisfies Array<SlashSearchItem>;

    expect(searchSlashCommandItems(items, "rfu").map((item) => item.id)).toEqual([
      "skill:codex:review-follow-up",
    ]);
    expect(searchSlashCommandItems(items, "Review follow").map((item) => item.id)).toEqual([
      "skill:codex:review-follow-up",
    ]);
  });
});
