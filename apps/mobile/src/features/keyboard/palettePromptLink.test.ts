import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { palettePromptLink } from "./palettePromptLink";

describe("palette prompt links", () => {
  const instanceId = ProviderInstanceId.make("my-codex");
  const input = {
    prompt: "  Fix the failing build  ",
    project: {
      environmentId: EnvironmentId.make("local"),
      id: ProjectId.make("app"),
      title: "App",
      workspaceRoot: "/repo",
      repositoryIdentity: {
        canonicalKey: "github.com/org/repo",
        locator: {
          source: "git-remote" as const,
          remoteName: "origin",
          remoteUrl: "git@github.com:org/repo.git",
        },
      },
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-11-11T00:00:00.000Z",
      updatedAt: "2026-11-11T00:00:00.000Z",
    },
    modelSelection: { instanceId, model: "gpt-5.4" },
    providers: [{ instanceId, driver: ProviderDriverKind.make("codex") }],
    withContext: true,
  };

  it("shares repository and provider driver context without exposing device instance IDs", () => {
    const url = new URL(palettePromptLink(input)!);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      prompt: "Fix the failing build",
      repo: "org/repo",
      provider: "codex",
      model: "gpt-5.4",
    });
    expect(new URL(palettePromptLink({ ...input, providers: [] })!).searchParams.has("model")).toBe(
      false,
    );
  });

  it("omits unavailable contextual links and empty or oversized prompts", () => {
    expect(palettePromptLink({ ...input, project: null })).toBeNull();
    expect(palettePromptLink({ ...input, prompt: " " })).toBeNull();
    expect(palettePromptLink({ ...input, prompt: "x".repeat(8001) })).toBeNull();
    expect(
      new URL(palettePromptLink({ ...input, withContext: false })!).searchParams.has("repo"),
    ).toBe(false);
  });
});
