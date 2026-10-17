// @effect-diagnostics nodeBuiltinImport:off
import * as NodeBuffer from "node:buffer";

import { KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH } from "@t3tools/contracts";

import {
  fingerprintKnowledgeGraphContent,
  KNOWLEDGE_GRAPH_EXTRACTION_VERSION,
} from "./KnowledgeGraphFingerprint.ts";
import {
  extractKnowledgeGraphManifestDependencies,
  knowledgeGraphManifestKind,
  knowledgeGraphPackageLabel,
  type KnowledgeGraphManifestKind,
} from "./KnowledgeGraphManifestAnalysis.ts";
import {
  extractKnowledgeGraphImports,
  extractKnowledgeGraphSymbols,
} from "./KnowledgeGraphSourceAnalysis.ts";
import { redactKnowledgeGraphEvidenceExcerpt } from "./KnowledgeGraphSecretRedaction.ts";

export const KNOWLEDGE_GRAPH_ANALYSIS_CACHE_BYTES = 64 * 1_024 * 1_024;
const CACHE_ENTRY_OVERHEAD_BYTES = 512;

interface AnalysisFile {
  readonly path: string;
  readonly content: string;
}

export interface KnowledgeGraphFileAnalysis {
  readonly fingerprint: string;
  readonly symbols: readonly {
    readonly name: string;
    readonly line: number;
    readonly excerpt: string;
  }[];
  readonly imports: readonly {
    readonly specifier: string;
    readonly line: number;
    readonly excerpt: string;
  }[];
  readonly manifest: {
    readonly kind: KnowledgeGraphManifestKind;
    readonly label: string;
    readonly dependencies: readonly string[];
  } | null;
}

export interface KnowledgeGraphAnalysisCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly sizeBytes: number;
  readonly entries: number;
}

function excerpt(content: string): string {
  return redactKnowledgeGraphEvidenceExcerpt(content).slice(
    0,
    KNOWLEDGE_GRAPH_MAX_EVIDENCE_EXCERPT_LENGTH,
  );
}

function analyzeFile(file: AnalysisFile, fingerprint: string): KnowledgeGraphFileAnalysis {
  const lines = file.content.split(/\r?\n/u);
  const manifestKind = knowledgeGraphManifestKind(file.path);
  return {
    fingerprint,
    symbols: extractKnowledgeGraphSymbols(file).map((symbol) => ({
      ...symbol,
      excerpt: excerpt(lines[symbol.line - 1] ?? symbol.name),
    })),
    imports: extractKnowledgeGraphImports(file).map((imported) => ({
      ...imported,
      excerpt: excerpt(lines[imported.line - 1] ?? imported.specifier),
    })),
    manifest:
      manifestKind === null
        ? null
        : {
            kind: manifestKind,
            label: knowledgeGraphPackageLabel(file, manifestKind),
            dependencies: extractKnowledgeGraphManifestDependencies(file),
          },
  };
}

/** Only file-local analysis is cached; imports are resolved against each job's current inventory. */
export class KnowledgeGraphAnalysisCache {
  readonly #maximumBytes: number;
  readonly #entries = new Map<
    string,
    { readonly analysis: KnowledgeGraphFileAnalysis; readonly sizeBytes: number }
  >();
  #sizeBytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;

  constructor(maximumBytes = KNOWLEDGE_GRAPH_ANALYSIS_CACHE_BYTES) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
      throw new Error("The analysis cache byte limit must be a non-negative integer.");
    }
    this.#maximumBytes = maximumBytes;
  }

  analyze(file: AnalysisFile): KnowledgeGraphFileAnalysis {
    const fingerprint = fingerprintKnowledgeGraphContent(file.content);
    // Paths affect language selection, manifest names, and fallback package labels.
    const key = `${KNOWLEDGE_GRAPH_EXTRACTION_VERSION}\0${fingerprint}\0${file.path}`;
    const cached = this.#entries.get(key);
    if (cached !== undefined) {
      this.#hits += 1;
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached.analysis;
    }

    this.#misses += 1;
    const analysis = analyzeFile(file, fingerprint);
    // Account conservatively for UTF-16 strings and entry/object overhead.
    const sizeBytes =
      2 * NodeBuffer.Buffer.byteLength(JSON.stringify(analysis), "utf8") +
      2 * NodeBuffer.Buffer.byteLength(key, "utf8") +
      CACHE_ENTRY_OVERHEAD_BYTES;
    if (sizeBytes > this.#maximumBytes) return analysis;

    for (const [oldestKey, oldest] of this.#entries) {
      if (this.#sizeBytes + sizeBytes <= this.#maximumBytes) break;
      this.#entries.delete(oldestKey);
      this.#sizeBytes -= oldest.sizeBytes;
      this.#evictions += 1;
    }
    this.#entries.set(key, { analysis, sizeBytes });
    this.#sizeBytes += sizeBytes;
    return analysis;
  }

  get stats(): KnowledgeGraphAnalysisCacheStats {
    return {
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      sizeBytes: this.#sizeBytes,
      entries: this.#entries.size,
    };
  }
}
