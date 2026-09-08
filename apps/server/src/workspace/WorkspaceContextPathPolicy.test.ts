import { describe, expect, it } from "vite-plus/test";

import {
  isWorkspaceContextSearchablePath,
  normalizeWorkspaceContextPath,
  shouldSkipWorkspaceContextDirectory,
} from "./WorkspaceContextPathPolicy.ts";

describe("WorkspaceContextPathPolicy", () => {
  it("normalizes safe relative paths and rejects absolute or parent paths", () => {
    expect(normalizeWorkspaceContextPath("./src\\index.ts")).toBe("src/index.ts");
    expect(normalizeWorkspaceContextPath("/etc/passwd")).toBeNull();
    expect(normalizeWorkspaceContextPath("../secret.txt")).toBeNull();
  });

  it("keeps useful hidden project directories while skipping generated and dependency trees", () => {
    expect(isWorkspaceContextSearchablePath(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkspaceContextSearchablePath(".agents/skills/review/SKILL.md")).toBe(true);
    expect(shouldSkipWorkspaceContextDirectory("node_modules")).toBe(true);
    expect(shouldSkipWorkspaceContextDirectory("dist")).toBe(true);
    expect(isWorkspaceContextSearchablePath("node_modules/pkg/index.ts")).toBe(false);
  });

  it("excludes env and private-key files from broad discovery", () => {
    expect(isWorkspaceContextSearchablePath(".env")).toBe(false);
    expect(isWorkspaceContextSearchablePath("config/.env.local")).toBe(false);
    expect(isWorkspaceContextSearchablePath("config/.envrc")).toBe(false);
    expect(isWorkspaceContextSearchablePath("secrets/id_ed25519")).toBe(false);
    expect(isWorkspaceContextSearchablePath("secrets/signing.pem")).toBe(false);
  });
});
