import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as TypeScript from "typescript";

const HERMES_UNSUPPORTED_ARRAY_METHODS = new Set(["toReversed", "toSorted", "toSpliced"]);
const SOURCE_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const TEST_FILE_PATTERN = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const REPOSITORY_ROOT = NodePath.resolve(import.meta.dirname, "../../../..");
const MOBILE_RUNTIME_ROOTS = [
  "apps/mobile/src",
  "apps/mobile/modules",
  "packages/client-runtime/src",
  "packages/contracts/src",
  "packages/shared/src",
].map((relativePath) => NodePath.join(REPOSITORY_ROOT, relativePath));
const MOBILE_RUNTIME_ENTRY_FILES = ["apps/mobile/index.ts"].map((relativePath) =>
  NodePath.join(REPOSITORY_ROOT, relativePath),
);

interface UnsupportedMethodReference {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly method: string;
}

function collectRuntimeSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRuntimeSourceFiles(path));
      continue;
    }
    if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(NodePath.extname(entry.name)) &&
      !entry.name.endsWith(".d.ts") &&
      !TEST_FILE_PATTERN.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}

function scriptKind(file: string): TypeScript.ScriptKind {
  if (file.endsWith(".tsx")) return TypeScript.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return TypeScript.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return TypeScript.ScriptKind.JS;
  }
  return TypeScript.ScriptKind.TS;
}

function referencedMethod(node: TypeScript.Node): string | null {
  if (TypeScript.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (
    TypeScript.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    TypeScript.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function findUnsupportedMethodReferences(
  file: string,
  source: string,
): UnsupportedMethodReference[] {
  const sourceFile = TypeScript.createSourceFile(
    file,
    source,
    TypeScript.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const references: UnsupportedMethodReference[] = [];

  function visit(node: TypeScript.Node): void {
    const method = referencedMethod(node);
    if (method !== null && HERMES_UNSUPPORTED_ARRAY_METHODS.has(method)) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      references.push({
        file,
        line: location.line + 1,
        column: location.character + 1,
        method,
      });
    }
    TypeScript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

describe("mobile Hermes runtime compatibility", () => {
  it("detects unsupported method references without matching comments or strings", () => {
    const references = findUnsupportedMethodReferences(
      "fixture.ts",
      `
        const sorted = values.toSorted()
        const reversed = values?.toReversed()
        const spliced = values["toSpliced"](0, 1)
        const documentation = ".toSorted()"
        // values.toReversed()
      `,
    );

    expect(references.map(({ method }) => method)).toEqual(["toSorted", "toReversed", "toSpliced"]);
  });

  it("keeps the mobile runtime dependency cone free of unsupported array methods", () => {
    const sourceFiles = [
      ...MOBILE_RUNTIME_ENTRY_FILES,
      ...MOBILE_RUNTIME_ROOTS.flatMap(collectRuntimeSourceFiles),
    ];
    const references = sourceFiles.flatMap((file) =>
      findUnsupportedMethodReferences(file, NodeFS.readFileSync(file, "utf8")),
    );
    const diagnostics = references.map((reference) => ({
      ...reference,
      file: NodePath.relative(REPOSITORY_ROOT, reference.file),
    }));

    expect(diagnostics).toEqual([]);
  });
});
