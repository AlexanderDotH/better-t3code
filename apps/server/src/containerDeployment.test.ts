// @effect-diagnostics nodeBuiltinImport:off - Packaging assertions read repository fixtures.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(import.meta.dirname, "../../..");
const read = (relativePath: string) =>
  NodeFS.readFileSync(NodePath.join(repoRoot, relativePath), "utf8");

describe("container deployment", () => {
  it("ships the native server as a non-root Node 24 container with every provider", () => {
    const dockerfile = read("deploy/container/Dockerfile");
    const lock = JSON.parse(read("deploy/container/providers.lock.json")) as {
      readonly providers: Readonly<Record<string, { readonly version: string }>>;
      readonly tools: Readonly<Record<string, { readonly version: string }>>;
    };

    expect(dockerfile).toContain("node:24-bookworm");
    expect(dockerfile).toContain("T3CODE_DEPLOYMENT=container");
    expect(dockerfile).toContain("USER t3");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("tini");
    expect(dockerfile).toContain("@openai/codex@");
    expect(dockerfile).toContain("@anthropic-ai/claude-code@");
    expect(dockerfile).toContain("opencode-ai@");
    expect(dockerfile).toContain("https://cursor.com/install");
    expect(dockerfile).toContain("https://x.ai/cli/install.sh");
    expect(Object.keys(lock.providers).toSorted()).toEqual([
      "claude",
      "codex",
      "cursor",
      "gemini",
      "grok",
      "opencode",
    ]);
    expect(dockerfile).toContain(`ARG CODEX_VERSION=${lock.providers.codex?.version}`);
    expect(dockerfile).toContain(`ARG CLAUDE_VERSION=${lock.providers.claude?.version}`);
    expect(dockerfile).toContain(`ARG OPENCODE_VERSION=${lock.providers.opencode?.version}`);
    expect(dockerfile).toContain(`ARG GLAB_VERSION=${lock.tools.glab?.version}`);
  });

  it("keeps state, workspace, and credentials explicit without privileged host access", () => {
    const compose = read("compose.yaml");

    expect(compose).toContain("/data");
    expect(compose).toContain("/workspace");
    expect(compose).toContain("/home/t3");
    expect(compose).toContain("OPENAI_API_KEY");
    expect(compose).toContain("T3CODE_BITBUCKET_ACCESS_TOKEN");
    expect(compose).toContain("T3CODE_BITBUCKET_API_TOKEN");
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).not.toContain("privileged:");
    expect(compose).not.toContain("/var/run/docker.sock");
  });
});
