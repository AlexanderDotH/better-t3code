// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeFS from "node:fs";

import {
  KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
  KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
  type KnowledgeGraphScopeV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  buildDeterministicKnowledgeGraph,
  type KnowledgeGraphDeterministicExtractionResult,
  type KnowledgeGraphInventoryFile,
} from "./KnowledgeGraphDeterministicExtractor.ts";
import { readKnowledgeGraphCoChangeGroups } from "./KnowledgeGraphCoChangeHistory.ts";
import {
  isEligibleKnowledgeGraphFile,
  isIgnoredKnowledgeGraphDirectory,
  isSecretKnowledgeGraphPath,
} from "./KnowledgeGraphPathPolicy.ts";

const MAX_SOURCE_FILE_BYTES = 1_048_576;

export interface ExtractKnowledgeGraphInventoryInput {
  readonly scope: KnowledgeGraphScopeV1;
  readonly workspaceRoot: string;
  readonly coChangeGroups?: readonly (readonly string[])[];
  readonly maxEligibleFiles?: number;
  readonly maxNodes?: number;
  readonly seenGeneration?: number;
}

export class KnowledgeGraphInventoryError extends Schema.TaggedErrorClass<KnowledgeGraphInventoryError>()(
  "KnowledgeGraphInventoryError",
  {
    operation: Schema.Literals(["validate-root", "scan", "read"]),
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const target = this.relativePath.length === 0 ? this.workspaceRoot : this.relativePath;
    return `Knowledge Graph inventory ${this.operation} failed at '${target}'.`;
  }
}

interface PendingDirectory {
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface ScanResult {
  readonly selectedPaths: readonly string[];
  readonly omittedFileCount: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

export function resolveKnowledgeGraphInventoryBounds(
  input: Pick<ExtractKnowledgeGraphInventoryInput, "maxEligibleFiles" | "maxNodes">,
): {
  readonly maxEligibleFiles: number;
  readonly maxNodes: number;
} {
  return {
    maxEligibleFiles: boundedPositiveInteger(
      input.maxEligibleFiles,
      KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
      KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
    ),
    maxNodes: boundedPositiveInteger(
      input.maxNodes,
      KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
      KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
    ),
  };
}

async function scanEligiblePaths(
  workspaceRoot: string,
  maxEligibleFiles: number,
): Promise<ScanResult> {
  const pendingDirectories: PendingDirectory[] = [
    { absolutePath: workspaceRoot, relativePath: "" },
  ];
  const selectedPaths: string[] = [];
  let eligibleFileCount = 0;

  for (let index = 0; index < pendingDirectories.length; index += 1) {
    const directory = pendingDirectories[index];
    if (directory === undefined) break;
    let entries: NodeFS.Dirent<string>[];
    try {
      entries = await NodeFSP.readdir(directory.absolutePath, { withFileTypes: true });
    } catch (cause) {
      if (directory.relativePath.length === 0) throw cause;
      continue;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = (
        directory.relativePath.length === 0
          ? entry.name
          : NodePath.posix.join(directory.relativePath, entry.name)
      ).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (
          isIgnoredKnowledgeGraphDirectory(entry.name) ||
          isSecretKnowledgeGraphPath(relativePath)
        ) {
          continue;
        }
        pendingDirectories.push({
          absolutePath: NodePath.join(directory.absolutePath, entry.name),
          relativePath,
        });
        continue;
      }
      if (!entry.isFile() || !isEligibleKnowledgeGraphFile(relativePath)) continue;
      eligibleFileCount += 1;
      if (selectedPaths.length < maxEligibleFiles) selectedPaths.push(relativePath);
    }
  }

  return {
    selectedPaths,
    omittedFileCount: Math.max(0, eligibleFileCount - selectedPaths.length),
  };
}

function readInventoryFile(
  workspaceRoot: string,
  relativePath: string,
): Effect.Effect<KnowledgeGraphInventoryFile | null, never> {
  return Effect.tryPromise({
    try: async () => {
      const absolutePath = NodePath.resolve(workspaceRoot, relativePath);
      const pathFromRoot = NodePath.relative(workspaceRoot, absolutePath);
      if (
        pathFromRoot === ".." ||
        pathFromRoot.startsWith(`..${NodePath.sep}`) ||
        NodePath.isAbsolute(pathFromRoot)
      ) {
        return null;
      }
      const linkMetadata = await NodeFSP.lstat(absolutePath);
      if (!linkMetadata.isFile() || linkMetadata.isSymbolicLink()) return null;
      const canonicalPath = await NodeFSP.realpath(absolutePath);
      if (canonicalPath !== absolutePath) return null;
      const file = await NodeFSP.open(
        absolutePath,
        NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
      );
      try {
        const beforeRead = await file.stat();
        if (!beforeRead.isFile() || beforeRead.size > MAX_SOURCE_FILE_BYTES) return null;
        const buffer = await file.readFile();
        const afterRead = await file.stat();
        if (
          beforeRead.size !== afterRead.size ||
          beforeRead.mtimeMs !== afterRead.mtimeMs ||
          buffer.byteLength !== afterRead.size ||
          buffer.includes(0)
        ) {
          return null;
        }
        return {
          path: relativePath,
          content: buffer.toString("utf8"),
          sizeBytes: afterRead.size,
          modifiedAtMs: Math.max(0, Math.round(afterRead.mtimeMs)),
        } satisfies KnowledgeGraphInventoryFile;
      } finally {
        await file.close();
      }
    },
    catch: (cause) =>
      new KnowledgeGraphInventoryError({
        operation: "read",
        workspaceRoot,
        relativePath,
        cause,
      }),
  }).pipe(Effect.orElseSucceed(() => null));
}

export const extractKnowledgeGraphInventory = Effect.fn("extractKnowledgeGraphInventory")(
  function* (
    input: ExtractKnowledgeGraphInventoryInput,
  ): Effect.fn.Return<KnowledgeGraphDeterministicExtractionResult, KnowledgeGraphInventoryError> {
    const workspaceRoot = NodePath.resolve(input.workspaceRoot);
    if (
      !NodePath.isAbsolute(input.workspaceRoot) ||
      workspaceRoot !== NodePath.resolve(input.scope.effectiveWorkspaceRoot)
    ) {
      return yield* new KnowledgeGraphInventoryError({
        operation: "validate-root",
        workspaceRoot,
        relativePath: "",
        cause: new Error("The inventory root does not match the canonical scope root."),
      });
    }
    const canonicalWorkspaceRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(workspaceRoot),
      catch: (cause) =>
        new KnowledgeGraphInventoryError({
          operation: "validate-root",
          workspaceRoot,
          relativePath: "",
          cause,
        }),
    });
    if (canonicalWorkspaceRoot !== workspaceRoot) {
      return yield* new KnowledgeGraphInventoryError({
        operation: "validate-root",
        workspaceRoot,
        relativePath: "",
        cause: new Error("The inventory root is not the canonical scope root."),
      });
    }
    const { maxEligibleFiles, maxNodes } = resolveKnowledgeGraphInventoryBounds(input);
    const scanResult = yield* Effect.tryPromise({
      try: () => scanEligiblePaths(canonicalWorkspaceRoot, maxEligibleFiles),
      catch: (cause) =>
        new KnowledgeGraphInventoryError({
          operation: "scan",
          workspaceRoot,
          relativePath: "",
          cause,
        }),
    });
    const selectedFiles = yield* Effect.forEach(
      scanResult.selectedPaths,
      (relativePath) => readInventoryFile(canonicalWorkspaceRoot, relativePath),
      { concurrency: 16 },
    );
    const files = selectedFiles.filter(
      (file): file is KnowledgeGraphInventoryFile => file !== null,
    );
    const coChangeGroups =
      input.coChangeGroups ?? (yield* readKnowledgeGraphCoChangeGroups(canonicalWorkspaceRoot));
    return buildDeterministicKnowledgeGraph({
      scope: input.scope,
      files,
      coChangeGroups,
      maxNodes,
      omittedFileCount:
        scanResult.omittedFileCount + scanResult.selectedPaths.length - files.length,
      seenGeneration: Math.max(0, Math.floor(input.seenGeneration ?? 0)),
    });
  },
);
