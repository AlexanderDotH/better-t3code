// @effect-diagnostics nodeBuiltinImport:off - Stable LSP uses compiler paths and file URIs at the adapter boundary.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Schema from "effect/Schema";

import { resolveFilesystemAsset, resolveIndexerPackage } from "./assets.ts";
import { coverageGap } from "./inventory.ts";
import { IndexerLspClient } from "./lspClient.ts";
import {
  declarationTarget,
  groupByFile,
  resolvedCallsite,
  type SemanticInput,
  type SemanticResult,
} from "./semantic.ts";
import { createSourceLocator, isWithinRoot, portablePath, readSourceUnit } from "./source.ts";

const Position = Schema.Struct({ line: Schema.Int, character: Schema.Int });
const Range = Schema.Struct({ start: Position, end: Position });
const Location = Schema.Struct({ uri: Schema.String, range: Range });
const LocationLink = Schema.Struct({
  targetUri: Schema.String,
  targetRange: Range,
  targetSelectionRange: Range,
});
const Definition = Schema.Union([
  Schema.Null,
  Location,
  Schema.Array(Schema.Union([Location, LocationLink])),
]);
export const decodeTypeScriptDefinition = Schema.decodeUnknownSync(Definition);
const DiagnosticReport = Schema.Struct({
  kind: Schema.String,
  items: Schema.Array(Schema.Struct({ range: Range, severity: Schema.optionalKey(Schema.Int) })),
});
export const decodeTypeScriptDiagnostics = Schema.decodeUnknownSync(DiagnosticReport);

export async function openTypeScriptLanguageService(
  root: string,
  signal?: AbortSignal,
  moduleUrl = import.meta.url,
) {
  const client = new IndexerLspClient(
    typescriptNativeExecutable(undefined, undefined, moduleUrl),
    root,
    signal,
  );
  try {
    await client.request("initialize", {
      processId: process.pid,
      rootUri: NodeURL.pathToFileURL(root).href,
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
        textDocument: { definition: { linkSupport: true } },
      },
      initializationOptions: {
        runExternalCode: false,
        disablePushDiagnostics: true,
        enableTelemetry: false,
        userPreferences: {
          disableAutomaticTypeAcquisition: true,
          tsserver: { automaticTypeAcquisition: { enabled: false } },
        },
      },
    });
    client.notify("initialized", {});
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export function typescriptNativeExecutable(
  platform = HostProcessPlatform.defaultValue(),
  architecture = HostProcessArchitecture.defaultValue(),
  moduleUrl = import.meta.url,
): string {
  const compilerPackage = resolveIndexerPackage(moduleUrl, "typescript");
  const platformPackage = resolveIndexerPackage(
    NodeURL.pathToFileURL(compilerPackage).href,
    `@typescript/typescript-${platform}-${architecture}`,
  );
  return resolveFilesystemAsset(
    NodePath.join(
      NodePath.dirname(platformPackage),
      "lib",
      platform === "win32" ? "tsc.exe" : "tsc",
    ),
  );
}

export async function resolveTypeScriptNative(
  input: SemanticInput,
  moduleUrl = import.meta.url,
): Promise<SemanticResult> {
  const callsites = [...input.callsites];
  const gaps: SemanticResult["gaps"] = [];
  let client: IndexerLspClient | undefined;
  try {
    client = await openTypeScriptLanguageService(input.root, input.signal, moduleUrl);
    const sources = new Map<string, string>();
    const locators = new Map<string, ReturnType<typeof createSourceLocator>>();
    const errorsByFile = new Map<string, { start: number; end: number }[] | undefined>();
    const entitiesByFile = groupByFile(input.entities);
    for (const file of input.files) {
      if (file.language !== "typescript" && file.language !== "javascript") continue;
      input.signal?.throwIfAborted();
      const source = await readSourceUnit({
        root: input.root,
        filePath: file.path,
        expectedHash: file.contentHash,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      sources.set(file.path, source);
      locators.set(file.path, createSourceLocator(source));
      client.notify("textDocument/didOpen", {
        textDocument: {
          uri: NodeURL.pathToFileURL(NodePath.join(input.root, file.path)).href,
          languageId: file.language,
          version: 1,
          text: source,
        },
      });
      if (
        !file.configDependencies.some((dependency) =>
          /(?:^|\/)(?:ts|js)config[^/]*\.json$/.test(dependency),
        )
      ) {
        gaps.push(
          coverageGap(
            "missing-config",
            "TypeScript language service uses an inferred project because no project configuration was inventoried.",
            file.path,
          ),
        );
      }
    }
    for (const [filePath] of sources) {
      try {
        const diagnostics = decodeTypeScriptDiagnostics(
          await client.request("textDocument/diagnostic", {
            textDocument: { uri: NodeURL.pathToFileURL(NodePath.join(input.root, filePath)).href },
          }),
        );
        const locator = locators.get(filePath)!;
        const errors = diagnostics.items
          .filter((diagnostic) => diagnostic.severity === 1)
          .map((diagnostic) => ({
            start: locator.offsetAt(diagnostic.range.start),
            end: locator.offsetAt(diagnostic.range.end),
          }));
        errorsByFile.set(filePath, errors);
        if (errors.length > 0)
          gaps.push(
            coverageGap(
              "incomplete-analysis",
              `TypeScript reported ${errors.length} diagnostics; call sites with errors remain candidates or unresolved.`,
              filePath,
            ),
          );
      } catch (error) {
        input.signal?.throwIfAborted();
        errorsByFile.set(filePath, undefined);
        gaps.push(
          coverageGap(
            "incomplete-analysis",
            `Native compiler diagnostics unavailable; definition targets remain candidates: ${String(error)}`,
            filePath,
            true,
          ),
        );
      }
    }
    for (const [index, callsite] of callsites.entries()) {
      const source = sources.get(callsite.filePath);
      if (
        source === undefined ||
        callsite.range.startOffset === undefined ||
        callsite.range.endOffset === undefined
      )
        continue;
      input.signal?.throwIfAborted();
      if (callsite.dispatch === "dynamic" || callsite.dispatch === "import") continue;
      const callText = source.slice(callsite.range.startOffset, callsite.range.endOffset);
      const expressionStart = callText.indexOf(callsite.expression);
      if (expressionStart < 0) continue;
      const offset = callsite.range.startOffset + expressionStart + callsite.expression.length - 1;
      const position = locators.get(callsite.filePath)!.positionAt(offset);
      const definition = decodeTypeScriptDefinition(
        await client.request("textDocument/definition", {
          textDocument: {
            uri: NodeURL.pathToFileURL(NodePath.join(input.root, callsite.filePath)).href,
          },
          position,
        }),
      );
      const locations =
        definition === null ? [] : Array.isArray(definition) ? definition : [definition];
      const targets = [];
      let externalTarget = false;
      for (const location of locations) {
        const uri = "targetUri" in location ? location.targetUri : location.uri;
        if (!uri.startsWith("file:")) {
          externalTarget = true;
          continue;
        }
        const absolute = NodeURL.fileURLToPath(uri);
        if (!isWithinRoot(input.root, absolute)) {
          externalTarget = true;
          continue;
        }
        const filePath = portablePath(NodePath.relative(input.root, absolute));
        const targetSource = sources.get(filePath);
        if (targetSource === undefined) {
          externalTarget = true;
          continue;
        }
        const range =
          "targetSelectionRange" in location ? location.targetSelectionRange : location.range;
        const start = locators.get(filePath)!.offsetAt(range.start);
        const end = locators.get(filePath)!.offsetAt(range.end);
        const targetName = targetSource.slice(start, end);
        const target = declarationTarget(
          entitiesByFile.get(filePath) ?? [],
          start,
          end,
          targetName,
        );
        if (!target) continue;
        if (
          (/^new\b/.test(callText) || callsite.expression === "super") &&
          target.kind === "class"
        ) {
          const constructors = (entitiesByFile.get(filePath) ?? []).filter(
            (entity) => entity.containerId === target.id && entity.kind === "constructor",
          );
          targets.push(...(constructors.length > 0 ? constructors : [target]));
        } else targets.push(target);
      }
      const errors = errorsByFile.get(callsite.filePath);
      const hasError =
        errors === undefined ||
        errors.some(
          (error) =>
            error.start < callsite.range.endOffset! && error.end > callsite.range.startOffset!,
        );
      callsites[index] = resolvedCallsite(
        callsite,
        targets,
        "TypeScript 7 native language service",
        !externalTarget && !hasError,
      );
    }
  } catch (error) {
    input.signal?.throwIfAborted();
    gaps.push(
      coverageGap(
        "incomplete-analysis",
        `TypeScript 7 semantic analysis unavailable or interrupted: ${String(error)}`,
        undefined,
        true,
      ),
    );
  } finally {
    client?.close();
  }
  return { callsites, gaps };
}
