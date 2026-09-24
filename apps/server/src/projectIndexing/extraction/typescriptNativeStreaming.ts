// @effect-diagnostics nodeBuiltinImport:off - Stable LSP file identities refer to the canonical workspace.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import type { ProjectSourceFileV1 } from "@t3tools/contracts";

import { createSourceLocator, isWithinRoot, portablePath, readSourceUnit } from "./source.ts";
import {
  SEMANTIC_BATCH_SIZE,
  type CompilerMessage,
  type SemanticDeclaration,
  type StreamingSemanticInput,
} from "./streamingTypes.ts";
import {
  decodeTypeScriptDefinition,
  decodeTypeScriptDiagnostics,
  openTypeScriptLanguageService,
} from "./typescriptNative.ts";

type Position = { readonly line: number; readonly character: number };
type Range = { readonly start: Position; readonly end: Position };
const comparePosition = (left: Position, right: Position) =>
  left.line - right.line || left.character - right.character;
const sameRange = (left: Range, right: Range) =>
  comparePosition(left.start, right.start) === 0 && comparePosition(left.end, right.end) === 0;

export async function* typescriptNativeMessages(
  input: StreamingSemanticInput,
  files: AsyncIterable<ProjectSourceFileV1>,
): AsyncGenerator<CompilerMessage> {
  const client = await openTypeScriptLanguageService(input.root, input.signal);
  const sources = new Map<
    string,
    { source: string; locator: ReturnType<typeof createSourceLocator> }
  >();
  const loadSource = async (filePath: string, known?: ProjectSourceFileV1) => {
    const cached = sources.get(filePath);
    if (cached) {
      sources.delete(filePath);
      sources.set(filePath, cached);
      return cached;
    }
    const file = known ?? (await input.reader.file(filePath));
    if (!file || file.status === "skipped" || file.status === "deleted") return undefined;
    const source = await readSourceUnit({
      root: input.root,
      filePath,
      expectedHash: file.contentHash,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const value = { source, locator: createSourceLocator(source) };
    sources.set(filePath, value);
    if (sources.size > 4) sources.delete(sources.keys().next().value!);
    return value;
  };
  let anchor: { scope: string; uri: string } | undefined;
  try {
    for await (const file of files) {
      input.signal?.throwIfAborted();
      const loaded = await loadSource(file.path, file);
      if (!loaded) continue;
      const uri = NodeURL.pathToFileURL(NodePath.join(input.root, file.path)).href;
      const scope =
        file.configDependencies
          .filter((path) => /(?:^|\/)(?:ts|js)config[^/]*\.json$/.test(path))
          .sort((left, right) => right.length - left.length)[0] ?? "<inferred>";
      if (anchor && anchor.scope !== scope) {
        client.notify("textDocument/didClose", { textDocument: { uri: anchor.uri } });
        anchor = undefined;
      }
      client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: file.language, version: 1, text: loaded.source },
      });
      anchor ??= { scope, uri };
      if (scope === "<inferred>")
        yield {
          type: "gap",
          gap: {
            filePath: file.path,
            message:
              "TypeScript uses inferred compiler options; no project configuration was inventoried.",
          },
        };
      let errors: { start: number; end: number }[] | undefined;
      try {
        const diagnostics = decodeTypeScriptDiagnostics(
          await client.request("textDocument/diagnostic", { textDocument: { uri } }),
        );
        errors = diagnostics.items
          .filter((item) => item.severity === 1)
          .map((item) => ({
            start: loaded.locator.offsetAt(item.range.start),
            end: loaded.locator.offsetAt(item.range.end),
          }));
        if (errors.length > 0)
          yield {
            type: "gap",
            gap: {
              filePath: file.path,
              message: `TypeScript reported ${errors.length} diagnostics; invalid calls remain candidates or unresolved.`,
            },
          };
      } catch (error) {
        input.signal?.throwIfAborted();
        yield {
          type: "gap",
          gap: {
            filePath: file.path,
            message: `Native diagnostics unavailable; target definitions remain candidates: ${String(error)}`,
          },
        };
      }
      let cursor: string | undefined;
      while (true) {
        const page = await input.reader.callsites(file.path, cursor, SEMANTIC_BATCH_SIZE);
        if (page.items.length > SEMANTIC_BATCH_SIZE)
          throw new Error("Semantic call reader exceeded its page budget.");
        for (const callsite of page.items) {
          input.signal?.throwIfAborted();
          const startOffset = callsite.range.startOffset;
          const endOffset = callsite.range.endOffset;
          if (startOffset === undefined || endOffset === undefined) {
            yield {
              type: "gap",
              gap: {
                filePath: file.path,
                message: "A stored callsite lacks precise offsets and must be re-extracted.",
              },
            };
            continue;
          }
          const targets: SemanticDeclaration[] = [];
          let external = false;
          const callText = loaded.source.slice(startOffset, endOffset);
          const expressionOffset = callText.indexOf(callsite.expression);
          if (
            expressionOffset >= 0 &&
            callsite.dispatch !== "dynamic" &&
            callsite.dispatch !== "import"
          ) {
            const definition = decodeTypeScriptDefinition(
              await client.request("textDocument/definition", {
                textDocument: { uri },
                position: loaded.locator.positionAt(
                  startOffset + expressionOffset + callsite.expression.length - 1,
                ),
              }),
            );
            let locations =
              definition === null ? [] : Array.isArray(definition) ? definition : [definition];
            if (/^new\b/.test(callText) || callsite.expression === "super") {
              const nested = locations.filter(
                (location) =>
                  "targetRange" in location &&
                  locations.some(
                    (outer) =>
                      "targetRange" in outer &&
                      outer.targetUri === location.targetUri &&
                      !sameRange(outer.targetRange, location.targetRange) &&
                      comparePosition(outer.targetRange.start, location.targetRange.start) <= 0 &&
                      comparePosition(outer.targetRange.end, location.targetRange.end) >= 0,
                  ),
              );
              if (nested.length > 0) locations = nested;
            }
            for (const location of locations) {
              const targetUri = "targetUri" in location ? location.targetUri : location.uri;
              if (!targetUri.startsWith("file:")) {
                external = true;
                continue;
              }
              const absolute = NodeURL.fileURLToPath(targetUri);
              if (!isWithinRoot(input.root, absolute)) {
                external = true;
                continue;
              }
              const filePath = portablePath(NodePath.relative(input.root, absolute));
              const targetSource = await loadSource(filePath);
              if (!targetSource) {
                external = true;
                continue;
              }
              const range =
                "targetSelectionRange" in location ? location.targetSelectionRange : location.range;
              const start = targetSource.locator.offsetAt(range.start);
              const end = targetSource.locator.offsetAt(range.end);
              const wholeDeclaration =
                "targetRange" in location && sameRange(location.targetRange, range);
              targets.push({
                filePath,
                startOffset: start,
                endOffset: end,
                ...(wholeDeclaration ? {} : { name: targetSource.source.slice(start, end) }),
              });
            }
          }
          const hasError =
            errors === undefined ||
            errors.some((error) => error.start < endOffset && error.end > startOffset);
          yield {
            type: "call",
            call: {
              filePath: file.path,
              startOffset,
              endOffset,
              targets,
              exact: !hasError && !external,
            },
          };
        }
        if (page.nextCursor === null) break;
        if (page.nextCursor === cursor)
          throw new Error("Semantic call reader did not advance its cursor.");
        cursor = page.nextCursor;
      }
      if (anchor.uri !== uri) client.notify("textDocument/didClose", { textDocument: { uri } });
    }
  } finally {
    client.close();
  }
}
