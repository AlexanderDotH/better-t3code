// @effect-diagnostics nodeBuiltinImport:off - Compiler adapters share the canonical filesystem workspace.
import * as NodeFSP from "node:fs/promises";
import type { ProjectCallsiteV1, ProjectEntityV1, ProjectSourceFileV1 } from "@t3tools/contracts";

import { coverageGap } from "./inventory.ts";
import { nativeCompilerMessages } from "./nativeStreaming.ts";
import { resolvedCallsite, unresolvedCallGaps } from "./semantic.ts";
import {
  SEMANTIC_BATCH_SIZE,
  semanticFiles,
  type CompilerCall,
  type CompilerMessage,
  type SemanticBatch,
  type SemanticDeclaration,
  type StreamingSemanticInput,
} from "./streamingTypes.ts";
import { typescriptNativeMessages } from "./typescriptNativeStreaming.ts";
import { typescriptCompatibleMessages } from "./typescriptCompatibleStreaming.ts";
import { preferredTypeScriptMode } from "./typescriptVersion.ts";

const locationKey = (location: {
  filePath: string;
  startOffset: number | undefined;
  endOffset: number | undefined;
}) => `${location.filePath}:${location.startOffset}:${location.endOffset}`;

async function* mappedCompilerBatches(
  input: StreamingSemanticInput,
  messages: AsyncIterable<CompilerMessage>,
  adapter: string,
): AsyncGenerator<SemanticBatch> {
  let pending: CompilerCall[] = [];
  const targets = new Map<string, ProjectEntityV1 | undefined>();
  const files = new Map<string, ProjectSourceFileV1 | undefined>();
  const fileSnapshot = async (filePath: string) => {
    if (files.has(filePath)) return files.get(filePath);
    const file = await input.reader.file(filePath);
    files.set(filePath, file);
    if (files.size > 32) files.delete(files.keys().next().value!);
    return file;
  };
  const target = async (location: SemanticDeclaration) => {
    const key = `${locationKey(location)}:${location.name ?? ""}`;
    if (targets.has(key)) {
      const cached = targets.get(key);
      targets.delete(key);
      targets.set(key, cached);
      return cached;
    }
    const candidate = await input.reader.target(location);
    const file = candidate ? await fileSnapshot(candidate.filePath) : undefined;
    const entity =
      candidate?.freshness === "current" &&
      file?.status === "indexed" &&
      candidate.sourceHash === file.contentHash
        ? candidate
        : undefined;
    targets.set(key, entity);
    if (targets.size > SEMANTIC_BATCH_SIZE * 2) targets.delete(targets.keys().next().value!);
    return entity;
  };
  const resolveBatch = async (calls: readonly CompilerCall[]) => {
    input.signal?.throwIfAborted();
    const stored = await input.reader.callsitesAt(
      calls.map(({ filePath, startOffset, endOffset }) => ({ filePath, startOffset, endOffset })),
    );
    if (stored.length > 600)
      throw new Error("Semantic callsite lookup exceeded its response budget.");
    const byLocation = new Map<string, ProjectCallsiteV1[]>();
    for (const callsite of stored) {
      const key = locationKey({
        filePath: callsite.filePath,
        startOffset: callsite.range.startOffset,
        endOffset: callsite.range.endOffset,
      });
      const matches = byLocation.get(key) ?? [];
      matches.push(callsite);
      byLocation.set(key, matches);
    }
    const output: ProjectCallsiteV1[] = [];
    const gaps = [];
    for (const call of calls) {
      input.signal?.throwIfAborted();
      const matches = byLocation.get(locationKey(call)) ?? [];
      if (matches.length === 0) {
        gaps.push(
          coverageGap(
            "incomplete-analysis",
            "A compiler call has no matching syntax callsite; recovered syntax remains incomplete.",
            call.filePath,
          ),
        );
        continue;
      }
      const declarations: ProjectEntityV1[] = [];
      for (const location of call.targets) {
        const entity = await target(location);
        if (entity) declarations.push(entity);
      }
      for (const callsite of matches) {
        const source = await fileSnapshot(callsite.filePath);
        if (
          callsite.freshness !== "current" ||
          source?.status !== "indexed" ||
          source.contentHash !== callsite.sourceHash
        ) {
          gaps.push(
            coverageGap(
              "stale-source",
              "The compiler call no longer matches the indexed source snapshot.",
              callsite.filePath,
              true,
            ),
          );
          continue;
        }
        if (callsite.dispatch === "dynamic" || callsite.dispatch === "import") {
          output.push({
            ...callsite,
            resolution: "unresolved",
            targetEntityIds: [],
            reason:
              "This dynamic or import invocation has no statically established project executable target.",
          });
          continue;
        }
        const resolved = resolvedCallsite(
          callsite,
          declarations,
          adapter,
          call.exact && declarations.length === call.targets.length,
        );
        output.push(
          call.reason ? { ...resolved, reason: `${resolved.reason} ${call.reason}` } : resolved,
        );
      }
    }
    return { output, gaps };
  };
  for await (const message of messages) {
    input.signal?.throwIfAborted();
    if (message.type === "gap") {
      yield {
        callsites: [],
        gaps: [
          coverageGap(
            "incomplete-analysis",
            message.gap.message,
            message.gap.filePath ?? undefined,
          ),
        ],
      };
      continue;
    }
    pending.push(message.call);
    if (pending.length < SEMANTIC_BATCH_SIZE) continue;
    const { output, gaps } = await resolveBatch(pending);
    pending = [];
    for (let offset = 0; offset < output.length; offset += SEMANTIC_BATCH_SIZE) {
      const callsites = output.slice(offset, offset + SEMANTIC_BATCH_SIZE);
      yield { callsites, gaps: unresolvedCallGaps(callsites) };
    }
    for (let offset = 0; offset < gaps.length; offset += SEMANTIC_BATCH_SIZE)
      yield { callsites: [], gaps: gaps.slice(offset, offset + SEMANTIC_BATCH_SIZE) };
  }
  if (pending.length > 0) {
    const { output, gaps } = await resolveBatch(pending);
    for (let offset = 0; offset < output.length; offset += SEMANTIC_BATCH_SIZE) {
      const callsites = output.slice(offset, offset + SEMANTIC_BATCH_SIZE);
      yield { callsites, gaps: unresolvedCallGaps(callsites) };
    }
    for (let offset = 0; offset < gaps.length; offset += SEMANTIC_BATCH_SIZE)
      yield { callsites: [], gaps: gaps.slice(offset, offset + SEMANTIC_BATCH_SIZE) };
  }
}

/** The service retains only pages and a small declaration cache; compiler programs stay in bounded owned workers. */
export async function* resolveProjectBatches(
  input: StreamingSemanticInput,
): AsyncGenerator<SemanticBatch> {
  const canonical = { ...input, root: await NodeFSP.realpath(input.root) };
  for (const language of ["typescript", "csharp", "java"] as const) {
    canonical.signal?.throwIfAborted();
    const source = semanticFiles(
      canonical,
      language === "typescript" ? ["typescript", "javascript"] : [language],
    );
    const first = await source.next();
    if (first.done) continue;
    const files = (async function* () {
      yield first.value;
      yield* source;
    })();
    try {
      const compatible =
        language === "typescript" &&
        (input.typescriptMode ?? (await preferredTypeScriptMode(canonical.root))) === "compatible";
      const messages =
        language === "typescript"
          ? compatible
            ? typescriptCompatibleMessages(canonical, files)
            : typescriptNativeMessages(canonical, files)
          : nativeCompilerMessages(canonical, language, files);
      yield* mappedCompilerBatches(
        canonical,
        messages,
        language === "typescript"
          ? compatible
            ? "TypeScript 6 compatibility compiler"
            : "TypeScript 7 native language service"
          : language === "csharp"
            ? "Roslyn semantic model"
            : "Eclipse JDT bindings",
      );
    } catch (error) {
      canonical.signal?.throwIfAborted();
      yield {
        callsites: [],
        gaps: [
          coverageGap(
            "incomplete-analysis",
            `${language} semantic stream interrupted: ${String(error)}`,
            undefined,
            true,
          ),
        ],
      };
    } finally {
      await source.return(undefined);
    }
  }
}
