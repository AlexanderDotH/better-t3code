// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import {
  KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
  type KnowledgeGraphDeterministicPatchV1,
  type KnowledgeGraphEdgeId,
  type KnowledgeGraphEdgeKind,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphEvidenceId,
  type KnowledgeGraphEvidenceKind,
  type KnowledgeGraphEvidenceV1,
  type KnowledgeGraphFileFingerprintV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphScopeV1,
  type KnowledgeGraphTruncationV1,
} from "@t3tools/contracts";

import {
  countKnowledgeGraphCoChanges,
  isKnowledgeGraphArchitecturePath,
  isKnowledgeGraphDocumentationPath,
} from "./KnowledgeGraphDocumentAnalysis.ts";
import {
  fingerprintKnowledgeGraphContent,
  KNOWLEDGE_GRAPH_EXTRACTION_VERSION,
  makeKnowledgeGraphEdgeId,
  makeKnowledgeGraphEvidenceId,
  makeKnowledgeGraphNodeId,
} from "./KnowledgeGraphFingerprint.ts";
import {
  extractKnowledgeGraphManifestDependencies,
  knowledgeGraphManifestKind,
  knowledgeGraphPackageLabel,
} from "./KnowledgeGraphManifestAnalysis.ts";
import {
  extractKnowledgeGraphImports,
  extractKnowledgeGraphSymbols,
  knowledgeGraphDependencyNameFromSpecifier,
  knowledgeGraphLanguageForPath,
  knowledgeGraphTechnologyForPath,
  normalizeKnowledgeGraphRelativePath,
  resolveKnowledgeGraphRelativeImport,
} from "./KnowledgeGraphSourceAnalysis.ts";
import { redactKnowledgeGraphEvidenceExcerpt } from "./KnowledgeGraphSecretRedaction.ts";

export interface KnowledgeGraphInventoryFile {
  readonly path: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
}

export interface KnowledgeGraphDeterministicExtractionInput {
  readonly scope: KnowledgeGraphScopeV1;
  readonly files: readonly KnowledgeGraphInventoryFile[];
  readonly coChangeGroups: readonly (readonly string[])[];
  readonly maxNodes: number;
  readonly omittedFileCount: number;
  readonly seenGeneration: number;
}

export interface KnowledgeGraphDeterministicExtractionResult {
  readonly nodes: readonly KnowledgeGraphNodeV1[];
  readonly edges: readonly KnowledgeGraphEdgeV1[];
  readonly evidence: readonly KnowledgeGraphEvidenceV1[];
  readonly fileFingerprints: readonly KnowledgeGraphFileFingerprintV1[];
  readonly truncation: KnowledgeGraphTruncationV1;
}

interface NodeInput {
  readonly label: string;
  readonly summary?: string;
  readonly path?: string;
  readonly line?: number;
  readonly symbol?: string;
  readonly language?: string;
  readonly evidenceIds?: readonly KnowledgeGraphEvidenceId[];
}

interface EvidenceInput {
  readonly kind: KnowledgeGraphEvidenceKind;
  readonly key: string;
  readonly path?: string;
  readonly line?: number;
  readonly symbol?: string;
  readonly excerpt?: string;
  readonly confidence?: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedExcerpt(content: string): string {
  const redacted = redactKnowledgeGraphEvidenceExcerpt(content);
  return redacted.slice(0, KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH);
}

export function buildDeterministicKnowledgeGraph(
  input: KnowledgeGraphDeterministicExtractionInput,
): KnowledgeGraphDeterministicExtractionResult {
  const nodes: KnowledgeGraphNodeV1[] = [];
  const edges: KnowledgeGraphEdgeV1[] = [];
  const evidence: KnowledgeGraphEvidenceV1[] = [];
  const nodeIdByKey = new Map<string, KnowledgeGraphNodeId | null>();
  const edgeIds = new Set<KnowledgeGraphEdgeId>();
  const evidenceIdByKey = new Map<string, KnowledgeGraphEvidenceId>();
  const fileNodeIdByPath = new Map<string, KnowledgeGraphNodeId>();
  const directoryNodeIdByPath = new Map<string, KnowledgeGraphNodeId>();
  let omittedNodeCount = 0;

  const addEvidence = (entry: EvidenceInput): KnowledgeGraphEvidenceId => {
    const evidenceKey = `${entry.kind}\0${entry.key}`;
    const existing = evidenceIdByKey.get(evidenceKey);
    if (existing !== undefined) return existing;
    const evidenceId = makeKnowledgeGraphEvidenceId(input.scope.scopeId, entry.kind, entry.key);
    const excerpt = entry.excerpt === undefined ? undefined : boundedExcerpt(entry.excerpt);
    evidenceIdByKey.set(evidenceKey, evidenceId);
    evidence.push({
      version: 1,
      evidenceId,
      scopeId: input.scope.scopeId,
      kind: entry.kind,
      fingerprint: fingerprintKnowledgeGraphContent(
        `${entry.kind}\0${entry.key}\0${excerpt ?? ""}`,
      ),
      confidence: entry.confidence ?? 1,
      evidenceRevision: 0,
      ...(entry.path === undefined
        ? {}
        : {
            source: {
              path: entry.path,
              ...(entry.line === undefined ? {} : { startLine: entry.line, endLine: entry.line }),
              ...(entry.symbol === undefined ? {} : { symbol: entry.symbol }),
            },
          }),
      ...(excerpt === undefined ? {} : { excerpt }),
    });
    return evidenceId;
  };

  const addNode = (
    kind: KnowledgeGraphNodeKind,
    key: string,
    entry: NodeInput,
  ): KnowledgeGraphNodeId | null => {
    const nodeKey = `${kind}\0${key}`;
    const existing = nodeIdByKey.get(nodeKey);
    if (existing !== undefined) return existing;
    if (nodes.length >= input.maxNodes) {
      nodeIdByKey.set(nodeKey, null);
      omittedNodeCount += 1;
      return null;
    }
    const nodeId = makeKnowledgeGraphNodeId(input.scope.scopeId, kind, key);
    nodeIdByKey.set(nodeKey, nodeId);
    nodes.push({
      version: 1,
      nodeId,
      scopeId: input.scope.scopeId,
      kind,
      label: entry.label,
      provenance: "deterministic",
      confidence: 1,
      evidenceIds: [...(entry.evidenceIds ?? [])],
      nodeRevision: 0,
      ...(entry.summary === undefined ? {} : { summary: entry.summary }),
      ...(entry.path === undefined
        ? {}
        : {
            source: {
              path: entry.path,
              ...(entry.line === undefined ? {} : { startLine: entry.line, endLine: entry.line }),
              ...(entry.symbol === undefined ? {} : { symbol: entry.symbol }),
            },
          }),
      ...(entry.language === undefined ? {} : { language: entry.language }),
    });
    return nodeId;
  };

  const addEdge = (
    kind: KnowledgeGraphEdgeKind,
    sourceNodeId: KnowledgeGraphNodeId | null,
    targetNodeId: KnowledgeGraphNodeId | null,
    key: string,
    evidenceIds: readonly KnowledgeGraphEvidenceId[] = [],
    summary?: string,
    confidence = 1,
  ): void => {
    if (sourceNodeId === null || targetNodeId === null || sourceNodeId === targetNodeId) return;
    const edgeId = makeKnowledgeGraphEdgeId(input.scope.scopeId, kind, key);
    if (edgeIds.has(edgeId)) return;
    edgeIds.add(edgeId);
    edges.push({
      version: 1,
      edgeId,
      scopeId: input.scope.scopeId,
      kind,
      sourceNodeId,
      targetNodeId,
      provenance: "deterministic",
      confidence,
      evidenceIds: [...evidenceIds],
      edgeRevision: 0,
      ...(summary === undefined ? {} : { summary }),
    });
  };

  const repositoryNodeId = addNode("repository", "repository", {
    label: NodePath.posix.basename(input.scope.effectiveWorkspaceRoot) || "Repository",
    summary: input.scope.effectiveWorkspaceRoot,
  });

  const ensureDirectory = (directoryPath: string): KnowledgeGraphNodeId | null => {
    const normalized = normalizeKnowledgeGraphRelativePath(directoryPath);
    if (normalized.length === 0 || normalized === ".") return repositoryNodeId;
    const existing = directoryNodeIdByPath.get(normalized);
    if (existing !== undefined) return existing;
    const parentPath = NodePath.posix.dirname(normalized);
    const parentNodeId = ensureDirectory(parentPath === "." ? "" : parentPath);
    const directoryNodeId = addNode("directory", normalized, {
      label: NodePath.posix.basename(normalized),
      path: normalized,
    });
    if (directoryNodeId !== null) directoryNodeIdByPath.set(normalized, directoryNodeId);
    addEdge("contains", parentNodeId, directoryNodeId, `directory:${normalized}`);
    return directoryNodeId;
  };

  const files = [...input.files].sort((left, right) => compareText(left.path, right.path));
  const filePaths = new Set(files.map((file) => file.path));
  const fileFingerprints: KnowledgeGraphFileFingerprintV1[] = [];

  for (const file of files) {
    const fingerprint = fingerprintKnowledgeGraphContent(file.content);
    fileFingerprints.push({
      path: file.path,
      fingerprint,
      sizeBytes: file.sizeBytes,
      modifiedAtMs: file.modifiedAtMs,
      extractionVersion: KNOWLEDGE_GRAPH_EXTRACTION_VERSION,
      seenGeneration: input.seenGeneration,
    });
    const parentNodeId = ensureDirectory(NodePath.posix.dirname(file.path));
    const fileLanguage = knowledgeGraphLanguageForPath(file.path);
    if (nodes.length >= input.maxNodes) {
      addNode("file", file.path, {
        label: NodePath.posix.basename(file.path),
        path: file.path,
        ...(fileLanguage === undefined ? {} : { language: fileLanguage }),
      });
      continue;
    }
    const sourceEvidenceId = addEvidence({
      kind: "source",
      key: `${file.path}:${fingerprint}`,
      path: file.path,
      excerpt: file.content,
    });
    const fileNodeId = addNode("file", file.path, {
      label: NodePath.posix.basename(file.path),
      path: file.path,
      evidenceIds: [sourceEvidenceId],
      ...(fileLanguage === undefined ? {} : { language: fileLanguage }),
    });
    if (fileNodeId !== null) fileNodeIdByPath.set(file.path, fileNodeId);
    addEdge("contains", parentNodeId, fileNodeId, `file:${file.path}`, [sourceEvidenceId]);

    const technology = knowledgeGraphTechnologyForPath(file.path);
    if (technology !== undefined) {
      const technologyNodeId = addNode("technology", technology.toLowerCase(), {
        label: technology,
      });
      addEdge("uses", fileNodeId, technologyNodeId, `${file.path}:${technology}`, [
        sourceEvidenceId,
      ]);
    }

    if (isKnowledgeGraphDocumentationPath(file.path)) {
      const documentationNodeId = addNode("documentation", file.path, {
        label: NodePath.posix.basename(file.path),
        path: file.path,
        evidenceIds: [sourceEvidenceId],
      });
      addEdge("documents", repositoryNodeId, documentationNodeId, file.path, [sourceEvidenceId]);
    }
    if (isKnowledgeGraphArchitecturePath(file.path)) {
      const architectureNodeId = addNode("architecture", file.path, {
        label: NodePath.posix.basename(file.path),
        path: file.path,
        evidenceIds: [sourceEvidenceId],
      });
      addEdge("configures", repositoryNodeId, architectureNodeId, file.path, [sourceEvidenceId]);
    }

    const kind = knowledgeGraphManifestKind(file.path);
    if (kind !== null) {
      if (nodes.length >= input.maxNodes) {
        addNode("package", file.path, {
          label: knowledgeGraphPackageLabel(file, kind),
          path: file.path,
        });
        continue;
      }
      const manifestEvidenceId = addEvidence({
        kind: "manifest",
        key: `${file.path}:${fingerprint}`,
        path: file.path,
        excerpt: file.content,
      });
      const packageNodeId = addNode("package", file.path, {
        label: knowledgeGraphPackageLabel(file, kind),
        path: file.path,
        evidenceIds: [manifestEvidenceId],
      });
      if (packageNodeId === null) continue;
      addEdge("contains", parentNodeId, packageNodeId, `package:${file.path}`, [
        manifestEvidenceId,
      ]);
      const manifestTechnology = {
        cargo: "Cargo",
        go: "Go Modules",
        jvm: "JVM",
        node: "Node.js",
        python: "Python Packaging",
      }[kind];
      const manifestTechnologyNodeId = addNode("technology", manifestTechnology.toLowerCase(), {
        label: manifestTechnology,
      });
      addEdge(
        "uses",
        packageNodeId,
        manifestTechnologyNodeId,
        `${file.path}:${manifestTechnology}`,
        [manifestEvidenceId],
      );
      for (const dependency of extractKnowledgeGraphManifestDependencies(file)) {
        const dependencyNodeId = addNode("dependency", dependency, { label: dependency });
        addEdge("depends-on", packageNodeId, dependencyNodeId, `${file.path}:${dependency}`, [
          manifestEvidenceId,
        ]);
      }
    }
  }

  for (const file of files) {
    const fileNodeId = fileNodeIdByPath.get(file.path) ?? null;
    if (fileNodeId === null) continue;
    const symbolLanguage = knowledgeGraphLanguageForPath(file.path);
    for (const symbol of extractKnowledgeGraphSymbols(file)) {
      if (nodes.length >= input.maxNodes) {
        addNode("symbol", `${file.path}:${symbol.name}`, {
          label: symbol.name,
          path: file.path,
          line: symbol.line,
          symbol: symbol.name,
          ...(symbolLanguage === undefined ? {} : { language: symbolLanguage }),
        });
        continue;
      }
      const symbolEvidenceId = addEvidence({
        kind: "symbol",
        key: `${file.path}:${symbol.line}:${symbol.name}`,
        path: file.path,
        line: symbol.line,
        symbol: symbol.name,
        excerpt: file.content.split(/\r?\n/u)[symbol.line - 1] ?? symbol.name,
      });
      const symbolNodeId = addNode("symbol", `${file.path}:${symbol.name}`, {
        label: symbol.name,
        path: file.path,
        line: symbol.line,
        symbol: symbol.name,
        evidenceIds: [symbolEvidenceId],
        ...(symbolLanguage === undefined ? {} : { language: symbolLanguage }),
      });
      addEdge("declares", fileNodeId, symbolNodeId, `${file.path}:${symbol.name}`, [
        symbolEvidenceId,
      ]);
    }

    for (const imported of extractKnowledgeGraphImports(file)) {
      if (imported.specifier.startsWith(".")) {
        const targetPath = resolveKnowledgeGraphRelativeImport(
          file.path,
          imported.specifier,
          filePaths,
        );
        const targetNodeId = targetPath ? (fileNodeIdByPath.get(targetPath) ?? null) : null;
        if (targetNodeId === null) continue;
        const importEvidenceId = addEvidence({
          kind: "import",
          key: `${file.path}:${imported.line}:${imported.specifier}`,
          path: file.path,
          line: imported.line,
          excerpt: file.content.split(/\r?\n/u)[imported.line - 1] ?? imported.specifier,
        });
        addEdge(
          "imports",
          fileNodeId,
          targetNodeId,
          `${file.path}:${imported.specifier}:${targetPath ?? "unresolved"}`,
          [importEvidenceId],
        );
        continue;
      }
      const dependency = knowledgeGraphDependencyNameFromSpecifier(imported.specifier);
      const dependencyNodeId = addNode("dependency", dependency, { label: dependency });
      if (dependencyNodeId === null) continue;
      const importEvidenceId = addEvidence({
        kind: "import",
        key: `${file.path}:${imported.line}:${imported.specifier}`,
        path: file.path,
        line: imported.line,
        excerpt: file.content.split(/\r?\n/u)[imported.line - 1] ?? imported.specifier,
      });
      addEdge("imports", fileNodeId, dependencyNodeId, `${file.path}:${imported.specifier}`, [
        importEvidenceId,
      ]);
    }
  }

  const coChangeCounts = countKnowledgeGraphCoChanges(input.coChangeGroups, filePaths);
  for (const [pair, count] of [...coChangeCounts].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const [leftPath, rightPath] = pair.split("\0") as [string, string];
    const coChangeEvidenceId = addEvidence({
      kind: "co-change",
      key: `${leftPath}:${rightPath}:${count}`,
      path: leftPath,
      excerpt: `${leftPath}\n${rightPath}\ncommits=${count}`,
      confidence: Math.min(0.95, 0.5 + count * 0.05),
    });
    addEdge(
      "co-changes-with",
      fileNodeIdByPath.get(leftPath) ?? null,
      fileNodeIdByPath.get(rightPath) ?? null,
      `${leftPath}:${rightPath}`,
      [coChangeEvidenceId],
      `Changed together in ${count} observed commit${count === 1 ? "" : "s"}.`,
      Math.min(0.95, 0.5 + count * 0.05),
    );
  }

  const retainedNodeIds = new Set(nodes.map((node) => node.nodeId));
  const retainedEvidenceIds = new Set(
    edges.flatMap((edge) => edge.evidenceIds).concat(nodes.flatMap((node) => node.evidenceIds)),
  );
  return {
    nodes: nodes.sort((left, right) => compareText(left.nodeId, right.nodeId)),
    edges: edges
      .filter(
        (edge) => retainedNodeIds.has(edge.sourceNodeId) && retainedNodeIds.has(edge.targetNodeId),
      )
      .sort((left, right) => compareText(left.edgeId, right.edgeId)),
    evidence: evidence
      .filter((entry) => retainedEvidenceIds.has(entry.evidenceId))
      .sort((left, right) => compareText(left.evidenceId, right.evidenceId)),
    fileFingerprints: fileFingerprints.sort((left, right) => compareText(left.path, right.path)),
    truncation: {
      eligibleFiles: input.omittedFileCount > 0,
      nodes: omittedNodeCount > 0,
      visibleNodes: false,
      omittedFileCount: input.omittedFileCount,
      omittedNodeCount,
    },
  } satisfies Omit<
    KnowledgeGraphDeterministicPatchV1,
    "version" | "scope" | "baseRevision" | "removals" | "changedNodeIds" | "committedAt"
  >;
}
