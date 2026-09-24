import type { ProjectEvidenceV1, ProjectModuleV1, ProjectSourceFileV1 } from "@t3tools/contracts";

import { rangeFromOffsets, stableId } from "./source.ts";

const PACKAGE_MANIFESTS = new Set([
  "package.json",
  "cargo.toml",
  "go.mod",
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);
const MANIFEST_EVIDENCE_CHARACTERS = 2_000;

function packageName(filePath: string, source: string): string {
  const filename = filePath.split("/").at(-1)!;
  if (filename === "package.json") {
    try {
      const manifest: unknown = JSON.parse(source);
      if (manifest !== null && typeof manifest === "object" && "name" in manifest) {
        const name = manifest.name;
        if (typeof name === "string" && name.trim() && name.trim().length <= 1_024)
          return name.trim();
      }
    } catch {
      // The manifest path still identifies its package scope when JSON is malformed.
    }
  }
  return filePath.length <= 1_024 ? filePath : filename;
}

/** A manifest establishes a package scope; dependency edges need a workspace-wide name map. */
export function extractManifestModule(
  file: ProjectSourceFileV1,
  source: string,
): { modules: ProjectModuleV1[]; evidence: ProjectEvidenceV1[] } {
  const basename = file.path.split("/").at(-1)!.toLowerCase();
  if (
    file.classification !== "manifest" ||
    (!PACKAGE_MANIFESTS.has(basename) && !basename.endsWith(".csproj"))
  )
    return { modules: [], evidence: [] };
  const evidenceId = stableId("manifest-evidence", file.path, file.contentHash);
  return {
    modules: [
      {
        id: stableId("module", file.path),
        name: packageName(file.path, source),
        summary: `Package manifest at ${file.path}`,
        entityIds: [],
        filePaths: [file.path],
        dependsOnModuleIds: [],
        provenance: "parser",
        freshness: "current",
        evidenceIds: [evidenceId],
      },
    ],
    evidence: [
      {
        id: evidenceId,
        filePath: file.path,
        sourceHash: file.contentHash,
        range: rangeFromOffsets(source, 0, Math.min(source.length, MANIFEST_EVIDENCE_CHARACTERS)),
        provenance: "parser",
      },
    ],
  };
}
