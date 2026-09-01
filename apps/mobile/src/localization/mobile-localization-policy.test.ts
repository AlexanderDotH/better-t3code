import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as TypeScript from "typescript";

const REPOSITORY_ROOT = NodePath.resolve(import.meta.dirname, "../../../..");
const MOBILE_SOURCE_ROOT = NodePath.join(REPOSITORY_ROOT, "apps/mobile/src");
const SOURCE_EXTENSION = /\.tsx?$/u;
const TEST_FILE = /\.(?:spec|test)\.tsx?$/u;
const USER_FACING_PROPERTIES = new Set([
  "accessibilityHint",
  "accessibilityLabel",
  "actionLabel",
  "detail",
  "headerTitle",
  "label",
  "message",
  "placeholder",
  "subtitle",
  "text",
  "title",
]);
const INTENTIONAL_LITERAL_FILES = new Set([
  "apps/mobile/src/features/settings/appearance/components/AppearancePreviews.tsx",
]);
const INTENTIONAL_LITERAL_VALUES = new Set([
  "Code",
  "Ctrl-C",
  "T3",
  "T3 Code",
  "T3 Connect",
  "T3 Code, Threads",
  "alt",
  "abc-123-xyz",
  "cloud account activation",
  "cloud account cleanup",
  "clear",
  "cmd",
  "connect onboarding opt-out",
  "ctrl",
  "esc",
  "feature/mobile-polish",
  "feature/mobile-thread",
  "git:(",
  "main",
  "notification permission refresh",
  "live activity disable",
  "live activity disable token lookup",
  "live activity preference load",
  "skill:",
  "t3",
  "t3code",
  "tab",
  "vpr dev",
  "~/projects/my-app",
]);

interface HardcodedMobileCopy {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly value: string;
}

function mobileSourceFiles(directory: string): readonly string[] {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry): string[] => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return [...mobileSourceFiles(path)];
    if (!entry.isFile() || !SOURCE_EXTENSION.test(entry.name) || TEST_FILE.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

function normalizedLiteral(value: string): string | null {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!/\p{L}/u.test(normalized)) return null;
  return normalized;
}

function propertyName(node: TypeScript.PropertyName): string | null {
  if (TypeScript.isIdentifier(node) || TypeScript.isStringLiteralLike(node)) return node.text;
  return null;
}

function isIntentionalLiteral(file: string, value: string): boolean {
  const relativeFile = NodePath.relative(REPOSITORY_ROOT, file);
  return (
    INTENTIONAL_LITERAL_FILES.has(relativeFile) ||
    INTENTIONAL_LITERAL_VALUES.has(value) ||
    /^[a-z][\w-]*(?:\.[\w-]+)+$/u.test(value) ||
    /^https?:\/\//u.test(value)
  );
}

function hardcodedCopyInFile(file: string): readonly HardcodedMobileCopy[] {
  const source = NodeFS.readFileSync(file, "utf8");
  const sourceFile = TypeScript.createSourceFile(
    file,
    source,
    TypeScript.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? TypeScript.ScriptKind.TSX : TypeScript.ScriptKind.TS,
  );
  const findings: HardcodedMobileCopy[] = [];
  const report = (node: TypeScript.Node, kind: string, rawValue: string) => {
    const value = normalizedLiteral(rawValue);
    if (value === null || isIntentionalLiteral(file, value)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      file: NodePath.relative(REPOSITORY_ROOT, file),
      line: position.line + 1,
      kind,
      value,
    });
  };

  const visit = (node: TypeScript.Node): void => {
    if (TypeScript.isJsxText(node)) report(node, "jsx-text", node.text);
    if (
      TypeScript.isJsxAttribute(node) &&
      TypeScript.isIdentifier(node.name) &&
      USER_FACING_PROPERTIES.has(node.name.text) &&
      node.initializer !== undefined &&
      TypeScript.isStringLiteral(node.initializer)
    ) {
      report(node, `jsx-${node.name.text}`, node.initializer.text);
    }
    if (file.endsWith(".tsx") && TypeScript.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (
        name !== null &&
        USER_FACING_PROPERTIES.has(name) &&
        TypeScript.isStringLiteralLike(node.initializer)
      ) {
        report(node, `property-${name}`, node.initializer.text);
      }
    }
    TypeScript.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

describe("mobile localization policy", () => {
  it("keeps app-owned visible copy behind typed message IDs", () => {
    const findings = mobileSourceFiles(MOBILE_SOURCE_ROOT).flatMap(hardcodedCopyInFile);
    expect(findings).toEqual([]);
  });
});
