// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { createPackage } from "@electron/asar";
import { describe, expect, it } from "vite-plus/test";

import {
  assertNoPrivateProjectIndexEntries,
  collectProjectIndexArtifactEntries,
  verifyProjectIndexerHelpers,
  verifyPackagedProjectIndexerRuntime,
} from "./verify-project-indexing-artifacts.ts";

describe("project index artifact privacy", () => {
  it("does not launch the packaged app or use development assets to mask missing unpacked dependencies", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-package-probe-"));
    try {
      const source = NodePath.join(root, "archive-source");
      const relativeModule = "apps/server/dist/bin.mjs";
      const marker = NodePath.join(root, "app-was-started");
      await NodeFSP.mkdir(NodePath.join(source, NodePath.dirname(relativeModule)), {
        recursive: true,
      });
      await NodeFSP.writeFile(
        NodePath.join(source, relativeModule),
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "started");`,
      );
      const archive = NodePath.join(root, "app.asar");
      await createPackage(source, archive);
      const moduleUrl = NodeURL.pathToFileURL(NodePath.join(archive, relativeModule)).href;
      await expect(verifyPackagedProjectIndexerRuntime(moduleUrl)).rejects.toThrow(
        "app.asar.unpacked",
      );
      const unpackedModule = NodePath.join(`${archive}.unpacked`, relativeModule);
      await NodeFSP.mkdir(NodePath.dirname(unpackedModule), { recursive: true });
      await NodeFSP.copyFile(NodePath.join(source, relativeModule), unpackedModule);
      await expect(verifyPackagedProjectIndexerRuntime(moduleUrl)).rejects.toThrow();
      expect(
        await NodeFSP.access(marker).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects private index paths on either platform and accepts shipped assets", () => {
    expect(() => assertNoPrivateProjectIndexEntries(["server/.t3/knowledge/index.sqlite"])).toThrow(
      "private .t3",
    );
    expect(() =>
      assertNoPrivateProjectIndexEntries(["server\\.T3\\knowledge\\snapshot.json"]),
    ).toThrow("private .t3");
    expect(() =>
      assertNoPrivateProjectIndexEntries([
        "node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm",
        "apps/server/dist/project-indexer/ProjectIndexer.dll",
        "docs/user/project-indexing.md",
      ]),
    ).not.toThrow();
  });

  it("detects private index contents inside an actual release asar", async () => {
    const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-artifact-"));
    try {
      const source = NodePath.join(temporary, "source");
      const artifact = NodePath.join(temporary, "artifact");
      await NodeFSP.mkdir(NodePath.join(source, ".t3", "knowledge"), { recursive: true });
      await NodeFSP.mkdir(artifact);
      await NodeFSP.writeFile(NodePath.join(source, ".t3", "knowledge", "snapshot.json"), "{}");
      await createPackage(source, NodePath.join(artifact, "app.asar"));
      const entries = await collectProjectIndexArtifactEntries(artifact);
      expect(entries).toContain("app.asar/.t3/knowledge/snapshot.json");
      expect(() => assertNoPrivateProjectIndexEntries(entries)).toThrow("private .t3");
    } finally {
      await NodeFSP.rm(temporary, { recursive: true, force: true });
    }
  });

  it("does not call helper packaging complete when compiler dependencies are missing", async () => {
    const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-helper-"));
    try {
      await NodeFSP.writeFile(NodePath.join(temporary, "ProjectIndexer.dll"), "MZ");
      await expect(verifyProjectIndexerHelpers(temporary)).rejects.toThrow();
    } finally {
      await NodeFSP.rm(temporary, { recursive: true, force: true });
    }
  });
});
