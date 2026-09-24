// @effect-diagnostics nodeBuiltinImport:off - The synchronous compiler host runs only in the bounded compatibility worker.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import ts from "@typescript/typescript6";
import type { ProjectSourceFileV1 } from "@t3tools/contracts";

import { coverageGap } from "./inventory.ts";
import {
  declarationTarget,
  groupByFile,
  resolvedCallsite,
  type SemanticInput,
  type SemanticResult,
} from "./semantic.ts";
import { isWithinRoot, portablePath, sourceHash } from "./source.ts";
import type { CompilerCall, CompilerGap, SemanticDeclaration } from "./streamingTypes.ts";

export async function analyzeTypeScriptDeclarations(
  input: { root: string; files: readonly ProjectSourceFileV1[]; signal?: AbortSignal },
  emit: { call: (call: CompilerCall) => Promise<void>; gap: (gap: CompilerGap) => Promise<void> },
) {
  const files = new Map(input.files.map((file) => [NodePath.resolve(input.root, file.path), file]));
  const groups = new Map<string, string[]>();
  for (const file of input.files) {
    if (file.language !== "typescript" && file.language !== "javascript") continue;
    const config =
      file.configDependencies
        .filter((dependency) => /(?:^|\/)(?:ts|js)config\.json$/.test(dependency))
        .sort((left, right) => right.length - left.length)[0] ?? "";
    const group = groups.get(config) ?? [];
    group.push(file.path);
    groups.set(config, group);
  }
  for (const [configPath, filePaths] of groups) {
    input.signal?.throwIfAborted();
    const configGaps: CompilerGap[] = [];
    const parsed = configPath
      ? ts.getParsedCommandLineOfConfigFile(
          NodePath.join(input.root, configPath),
          {},
          {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
              configGaps.push({
                message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
                filePath: configPath,
              }),
          },
        )
      : undefined;
    if (!configPath)
      configGaps.push({
        message: "TypeScript compatibility analysis uses inferred compiler options.",
      });
    for (const diagnostic of parsed?.errors ?? [])
      configGaps.push({
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        filePath: configPath,
      });
    for (const gap of configGaps) await emit.gap(gap);
    const options: ts.CompilerOptions = {
      ...(parsed?.options ?? {
        allowJs: true,
        checkJs: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      }),
      noEmit: true,
      incremental: false,
      composite: false,
      plugins: [],
    };
    const host = ts.createCompilerHost(options);
    const ordinaryRead = host.readFile.bind(host);
    const contents = new Map<string, string>();
    host.readFile = (filePath) => {
      const absolute = NodePath.resolve(filePath);
      const record = files.get(absolute);
      if (!record) return ordinaryRead(filePath);
      const cached = contents.get(absolute);
      if (cached !== undefined) return cached;
      const bytes = NodeFS.readFileSync(absolute);
      if (sourceHash(bytes) !== record.contentHash)
        throw new Error(`Source changed before compiler analysis: ${record.path}`);
      const text = bytes.toString("utf8");
      contents.set(absolute, text);
      return text;
    };
    host.writeFile = () => {
      throw new Error("Indexing cannot emit compiler output.");
    };
    // createCompilerHost captures its original readFile; override the source loader as well to enforce snapshot hashes.
    host.getSourceFile = (fileName, languageVersion) => {
      const text = host.readFile(fileName);
      return text === undefined
        ? undefined
        : ts.createSourceFile(fileName, text, languageVersion, true);
    };
    const program = ts.createProgram({
      rootNames: filePaths.map((path) => NodePath.join(input.root, path)),
      options,
      host,
      ...(parsed?.projectReferences ? { projectReferences: parsed.projectReferences } : {}),
    });
    const checker = program.getTypeChecker();
    for (const filePath of filePaths) {
      const source = program.getSourceFile(NodePath.join(input.root, filePath));
      if (!source) continue;
      const errors = program
        .getSemanticDiagnostics(source)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      const parseErrors = program
        .getSyntacticDiagnostics(source)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      if (errors.length + parseErrors.length > 0)
        await emit.gap({
          filePath,
          message: `TypeScript reported ${errors.length + parseErrors.length} diagnostics; invalid calls remain candidates or unresolved.`,
        });
      const stack: ts.Node[] = [source];
      while (stack.length > 0) {
        input.signal?.throwIfAborted();
        const node = stack.pop()!;
        node.forEachChild((child) => {
          stack.push(child);
        });
        if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) continue;
        const startOffset = node.getStart(source);
        const declaration = checker.getResolvedSignature(node)?.declaration;
        const targets: SemanticDeclaration[] = [];
        if (
          declaration &&
          (ts.isFunctionDeclaration(declaration) ||
            ts.isMethodDeclaration(declaration) ||
            ts.isConstructorDeclaration(declaration) ||
            ts.isFunctionExpression(declaration) ||
            ts.isArrowFunction(declaration) ||
            ts.isGetAccessor(declaration) ||
            ts.isSetAccessor(declaration))
        ) {
          const targetSource = declaration.getSourceFile();
          if (isWithinRoot(input.root, targetSource.fileName)) {
            const name =
              ts.isConstructorDeclaration(declaration) || ts.isArrowFunction(declaration)
                ? undefined
                : declaration.name;
            targets.push({
              filePath: portablePath(NodePath.relative(input.root, targetSource.fileName)),
              startOffset: name?.getStart(targetSource) ?? declaration.getStart(targetSource),
              endOffset: name?.end ?? declaration.end,
              ...(name ? { name: name.getText(targetSource) } : {}),
            });
          }
        }
        const hasError = errors.some(
          (error) =>
            error.start !== undefined &&
            error.start < node.end &&
            error.start + (error.length ?? 1) > startOffset,
        );
        await emit.call({
          filePath,
          startOffset,
          endOffset: node.end,
          targets,
          exact: targets.length > 0 && !hasError,
        });
      }
    }
  }
}

/** Small-array compatibility API retained for callers and fixtures; the live pipeline consumes the raw declaration stream. */
export async function resolveTypeScriptCompatibleAnalysis(
  input: SemanticInput,
): Promise<SemanticResult> {
  const gaps: SemanticResult["gaps"] = [];
  const entities = groupByFile(input.entities);
  const calls = new Map(
    input.callsites.map((call) => [
      `${call.filePath}:${call.range.startOffset}:${call.range.endOffset}`,
      call,
    ]),
  );
  const updates = new Map<string, (typeof input.callsites)[number]>();
  await analyzeTypeScriptDeclarations(input, {
    gap: async (gap) => {
      gaps.push(coverageGap("incomplete-analysis", gap.message, gap.filePath ?? undefined));
    },
    call: async (raw) => {
      const call = calls.get(`${raw.filePath}:${raw.startOffset}:${raw.endOffset}`);
      if (!call || call.dispatch === "dynamic" || call.dispatch === "import") return;
      const targets = raw.targets.flatMap((target) => {
        const entity = declarationTarget(
          entities.get(target.filePath) ?? [],
          target.startOffset,
          target.endOffset,
          target.name,
        );
        return entity ? [entity] : [];
      });
      updates.set(
        call.id,
        resolvedCallsite(call, targets, "TypeScript 6 compatibility compiler", raw.exact),
      );
    },
  });
  return { callsites: input.callsites.map((call) => updates.get(call.id) ?? call), gaps };
}
