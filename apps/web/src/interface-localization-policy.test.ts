// @effect-diagnostics nodeBuiltinImport:off - Repository policy coverage reads source files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";
import * as TypeScript from "typescript";

const REPOSITORY_ROOT = NodePath.resolve(import.meta.dirname, "../../..");
const WEB_SOURCE_ROOT = NodePath.join(REPOSITORY_ROOT, "apps/web/src");
const SOURCE_EXTENSION = /\.tsx?$/u;
const TEST_FILE = /(?:\.browser|\.source|\.spec|\.test)\.tsx?$/u;
const USER_FACING_PROPERTIES = new Set([
  "accessibilityHint",
  "accessibilityLabel",
  "actionLabel",
  "aria-label",
  "description",
  "detail",
  "label",
  "message",
  "placeholder",
  "subtitle",
  "text",
  "title",
]);
const INTENTIONAL_LITERAL_VALUES = new Set([
  "Better",
  "Code",
  "MCP",
  "T3",
  "T3 Code",
  "T3 Connect",
  "chat visual mode settings sync",
  "cloud account activation",
  "cloud account cleanup",
  "interface language settings sync",
  "main",
  "project thread preview settings sync",
  "skill:",
  "t3code",
  "text-error-foreground/80", // CSS token stored in a message-style descriptor.
  "text-warning-foreground/80", // CSS token stored in a message-style descriptor.
  "Σ", // Mathematical token-summary symbol.
]);
const INTENTIONAL_LITERAL_VALUES_BY_FILE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "apps/web/src/components/CommandPalette.tsx",
    new Set(["Enter", "(Enter)"]), // Physical keycaps.
  ],
  [
    "apps/web/src/components/CommandPaletteContent.tsx",
    new Set(["Enter", "Backspace", "Esc"]), // Physical keycaps.
  ],
  [
    "apps/web/src/components/GitActionsControl.tsx",
    new Set([
      "GitHub",
      "github.com",
      "GitLab",
      "gitlab.com",
      "Bitbucket",
      "bitbucket.org",
      "Azure DevOps",
      "dev.azure.com",
      "origin",
    ]), // Product, host, and Git remote identifiers.
  ],
  [
    "apps/web/src/components/git-workbench/GitBranchesPanel.tsx",
    new Set(["feature/my-change"]), // Example branch slug.
  ],
  [
    "apps/web/src/components/settings/AddProviderInstanceDialog.tsx",
    new Set(["Github Copilot", "ACP Registry", "Pi Agent"]), // Provider product names.
  ],
  [
    "apps/web/src/components/settings/SkillsSettings.tsx",
    new Set(["review-follow-up"]), // Example skill slug.
  ],
  [
    "apps/web/src/components/settings/SourceControlWritingSettings.tsx",
    new Set([
      "settings.sourceControlWriting.repoConventions",
      "settings.sourceControlWriting.repoConventionsDescription",
      "settings.sourceControlWriting.conventionalCommits",
      "settings.sourceControlWriting.conventionalCommitsDescription",
      "settings.sourceControlWriting.custom",
      "settings.sourceControlWriting.customDescription",
    ]),
  ], // Typed message IDs stored in writing-mode descriptors.
  [
    "apps/web/src/components/cloud/ConnectCliAuthSurface.tsx",
    new Set(["connectCli.incomplete.title", "connectCli.incomplete.description"]),
  ], // Typed message IDs stored in a presentation descriptor.
  [
    "apps/web/src/components/cloud/RelayClientInstallDialog.tsx",
    new Set([
      "relayInstall.stage.checking",
      "relayInstall.stage.waitingForLock",
      "relayInstall.stage.downloading",
      "relayInstall.stage.verifying",
      "relayInstall.stage.installing",
      "relayInstall.stage.validating",
      "relayInstall.stage.activating",
    ]),
  ], // Typed message IDs stored in stage descriptors.
]);

interface HardcodedWebCopy {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly value: string;
}

function webSourceFiles(directory: string): readonly string[] {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry): string[] => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return [...webSourceFiles(path)];
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
    INTENTIONAL_LITERAL_VALUES.has(value) ||
    INTENTIONAL_LITERAL_VALUES_BY_FILE.get(relativeFile)?.has(value) === true ||
    /^https?:\/\//u.test(value)
  );
}

function hardcodedCopyInFile(file: string): readonly HardcodedWebCopy[] {
  const source = NodeFS.readFileSync(file, "utf8");
  const sourceFile = TypeScript.createSourceFile(
    file,
    source,
    TypeScript.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? TypeScript.ScriptKind.TSX : TypeScript.ScriptKind.TS,
  );
  const findings: HardcodedWebCopy[] = [];
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

describe("web localization policy", () => {
  it("keeps app-owned visible copy behind typed message IDs", () => {
    const findings = webSourceFiles(WEB_SOURCE_ROOT).flatMap(hardcodedCopyInFile);
    expect(findings).toEqual([]);
  });
});
