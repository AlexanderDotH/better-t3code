// @effect-diagnostics nodeBuiltinImport:off - Compiler orchestration is an abortable Promise boundary.
import * as NodeFSP from "node:fs/promises";

import type { ProjectEvidenceV1, ProjectModuleV1, ProjectSourceFileV1 } from "@t3tools/contracts";

import { coverageGap } from "./inventory.ts";
import { resolveImports } from "./imports.ts";
import { extractManifestModule } from "./manifests.ts";
import { resolveNativeLanguage } from "./nativeSemantic.ts";
import { type SemanticInput, type SemanticResult, unresolvedCallGaps } from "./semantic.ts";
import { readSourceUnit } from "./source.ts";
import { extractSyntax, type SyntaxExtraction } from "./syntax.ts";
import { resolveTypeScriptCompatible } from "./typescriptCompatible.ts";
import { resolveTypeScriptNative } from "./typescriptNative.ts";
import { preferredTypeScriptMode } from "./typescriptVersion.ts";

export { scanInventory, type InventoryCursor, type ExtractionGap } from "./inventory.ts";
export { readSourceUnit } from "./source.ts";
export type { SemanticInput, SemanticResult } from "./semantic.ts";

export interface FileExtraction extends SyntaxExtraction {
  file: ProjectSourceFileV1;
  modules: ProjectModuleV1[];
  evidence: ProjectEvidenceV1[];
}

export async function extractFile(input: {
  root: string;
  file: ProjectSourceFileV1;
  signal?: AbortSignal;
}): Promise<FileExtraction> {
  if (input.file.status === "skipped" || input.file.status === "deleted")
    return {
      file: input.file,
      entities: [],
      callsites: [],
      gaps: [],
      imports: [],
      modules: [],
      evidence: [],
    };
  try {
    const source = await readSourceUnit({
      root: input.root,
      filePath: input.file.path,
      expectedHash: input.file.contentHash,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const extraction = await extractSyntax({
      filePath: input.file.path,
      source,
      language: input.file.language,
      sourceHash: input.file.contentHash,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const gaps =
      input.file.classification === "source" || input.file.classification === "test"
        ? extraction.gaps
        : extraction.gaps.filter((gap) => gap.kind !== "unsupported-language");
    const imports = await resolveImports({
      root: input.root,
      file: input.file,
      imports: extraction.imports,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const packageFacts = extractManifestModule(input.file, source);
    return {
      ...extraction,
      imports,
      ...packageFacts,
      gaps,
      file: { ...input.file, status: "indexed" },
    };
  } catch (error) {
    input.signal?.throwIfAborted();
    return {
      file: { ...input.file, status: "stale" },
      entities: [],
      callsites: [],
      imports: [],
      modules: [],
      evidence: [],
      gaps: [coverageGap("stale-source", String(error), input.file.path, true)],
    };
  }
}

/** Re-resolve an invalidated semantic project after persisting the changed-file syntax batches. */
export async function resolveProject(
  input: SemanticInput & {
    typescriptMode?: "native" | "compatible";
    helperPaths?: { dotnet?: string; java?: string };
  },
): Promise<SemanticResult> {
  const updates = new Map(input.callsites.map((callsite) => [callsite.id, callsite]));
  const root = await NodeFSP.realpath(input.root);
  const gaps: SemanticResult["gaps"] = [];
  for (const language of ["typescript", "csharp", "java"] as const) {
    input.signal?.throwIfAborted();
    const files = input.files.filter(
      (file) =>
        file.status !== "skipped" &&
        file.status !== "deleted" &&
        (file.language === language ||
          (language === "typescript" && file.language === "javascript")),
    );
    if (files.length === 0) continue;
    const filePaths = new Set(files.map((file) => file.path));
    const adapterInput = {
      ...input,
      root,
      files,
      callsites: input.callsites.filter((callsite) => filePaths.has(callsite.filePath)),
    };
    try {
      const result =
        language === "typescript"
          ? (input.typescriptMode ?? (await preferredTypeScriptMode(input.root))) === "native"
            ? await resolveTypeScriptNative(adapterInput)
            : await resolveTypeScriptCompatible(adapterInput)
          : await resolveNativeLanguage(
              adapterInput,
              language,
              input.helperPaths?.[language === "csharp" ? "dotnet" : "java"],
            );
      for (const callsite of result.callsites) updates.set(callsite.id, callsite);
      gaps.push(...result.gaps);
    } catch (error) {
      input.signal?.throwIfAborted();
      gaps.push(
        coverageGap(
          "incomplete-analysis",
          `${language} compiler resolution failed: ${String(error)}`,
          undefined,
          true,
        ),
      );
    }
  }
  const callsites = [...updates.values()];
  gaps.push(...unresolvedCallGaps(callsites));
  return { callsites, gaps };
}

export function filesAffectedByChange(
  files: readonly ProjectSourceFileV1[],
  changedPaths: readonly string[],
): string[] {
  const changed = new Set(changedPaths);
  return files
    .filter(
      (file) =>
        changed.has(file.path) ||
        file.configDependencies.some((dependency) => changed.has(dependency)),
    )
    .map((file) => file.path);
}

export { resolveProjectBatches } from "./streaming.ts";
export type {
  SemanticReader,
  SemanticBatch,
  StreamingSemanticInput,
  SemanticLocation,
  SemanticDeclaration,
} from "./streamingTypes.ts";
