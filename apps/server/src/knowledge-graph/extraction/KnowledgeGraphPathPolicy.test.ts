import { describe, expect, it } from "vite-plus/test";

import {
  isEligibleKnowledgeGraphFile,
  isIgnoredKnowledgeGraphDirectory,
  isIgnoredKnowledgeGraphWatchPath,
  isSecretKnowledgeGraphPath,
} from "./KnowledgeGraphPathPolicy.ts";

describe("knowledge graph path policy", () => {
  it("rejects generated dependency and VCS directories", () => {
    for (const name of [".git", ".cache", "node_modules", "dist", "build", "target"]) {
      expect(isIgnoredKnowledgeGraphDirectory(name)).toBe(true);
    }
    expect(isIgnoredKnowledgeGraphDirectory("src")).toBe(false);
    expect(isIgnoredKnowledgeGraphDirectory("docs")).toBe(false);
  });

  it("rejects credentials and secret-bearing paths before reading their contents", () => {
    for (const path of [
      ".env",
      ".env.production",
      "config/secrets.json",
      "config/credentials-prod.json",
      "config/credentials-prod/aws.json",
      "config/oauth.json",
      "config/service-account.production.json",
      "config/service-account.production.properties",
      "config/firebase-adminsdk-production.json",
      "credentials/aws.json",
      "certs/private.pem",
      "keys/id_ecdsa",
      "keys/id_rsa",
      "kubeconfig",
      "terraform.tfstate",
      ".netrc",
      ".npmrc",
    ]) {
      expect(isSecretKnowledgeGraphPath(path)).toBe(true);
    }
    expect(isSecretKnowledgeGraphPath("src/secretary.ts")).toBe(false);
    expect(isSecretKnowledgeGraphPath("docs/authentication.md")).toBe(false);
  });

  it("accepts source, manifests, and documentation while rejecting binaries and maps", () => {
    for (const path of ["src/index.ts", "README.md", "package.json", "Cargo.toml", "go.mod"]) {
      expect(isEligibleKnowledgeGraphFile(path)).toBe(true);
    }
    for (const path of [
      "logo.png",
      "bundle.js.map",
      "archive.zip",
      "generated.min.js",
      "node_modules/react/index.ts",
      "dist/index.ts",
    ]) {
      expect(isEligibleKnowledgeGraphFile(path)).toBe(false);
    }
  });

  it("drops watcher events below ignored and secret-bearing path segments", () => {
    for (const path of [
      "/repo/.git/index",
      "/repo/node_modules/react/index.js",
      "/repo/packages/api/.env.local",
      "/repo/config/secrets/provider.json",
      "dist/client.js",
    ]) {
      expect(isIgnoredKnowledgeGraphWatchPath(path)).toBe(true);
    }
    for (const path of [
      "/repo/src/index.ts",
      "/repo/docs/architecture.md",
      "/repo/.github/workflows/ci.yml",
      "packages/client-runtime",
    ]) {
      expect(isIgnoredKnowledgeGraphWatchPath(path)).toBe(false);
    }
  });
});
