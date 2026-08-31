// @effect-diagnostics nodeBuiltinImport:off - Repository policy coverage reads source files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

const REPOSITORY_ROOT = NodePath.resolve(import.meta.dirname, "../../..");
const DESKTOP_SOURCE_ROOT = NodePath.join(REPOSITORY_ROOT, "apps/desktop/src");
const SOURCE_EXTENSION = /\.tsx?$/u;
const NON_PRODUCTION_SOURCE = /(?:\.generated|\.spec|\.test)\.tsx?$/u;
const USER_FACING_PROPERTIES = new Set([
  "accessibilityHint",
  "accessibilityLabel",
  "aria-label",
  "description",
  "detail",
  "label",
  "message",
  "placeholder",
  "prompt",
  "subtitle",
  "text",
  "title",
]);
const USER_FACING_PROPERTY_PATTERN = new RegExp(
  `\\b(${[...USER_FACING_PROPERTIES].join("|")})\\s*:\\s*(["'\x60])([^"'\x60\\n]+)\\2`,
  "gu",
);
const DOM_VISIBLE_PROPERTY_PATTERN =
  /\.(ariaLabel|innerText|placeholder|textContent|title)\s*=\s*(["'`])([^"'`\n]+)\2/gu;
const SHOW_ERROR_BOX_LITERAL_PATTERN = /showErrorBox\s*\(\s*(["'`])([^"'`\n]+)\1/gu;
const INTENTIONAL_LITERAL_VALUES = new Map([
  ["Desktop", "advertised endpoint provider brand"],
  ["JSON", "file format name"],
  ["T3 Code", "product name"],
  ["T3 Code Desktop", "authentication client name"],
  ["Tailscale", "product name"],
  ["Tailscale HTTPS", "product and protocol name"],
  ["Tailscale IP", "product and protocol name"],
  ["Windows", "operating system name"],
  ["\\r", "keyboard protocol control character"],
  ["normal / 1.4", "CSS line-height syntax example"],
  [
    "backend child process failure output start",
    "structured observability event name, never rendered as interface copy",
  ],
  [
    "backend child process output",
    "structured observability event name, never rendered as interface copy",
  ],
  [
    "backend child process failure output end",
    "structured observability event name, never rendered as interface copy",
  ],
  [
    "No loopback port available for WSL backend between ${startPort} and ${MAX_TCP_PORT}.",
    "internal allocation diagnostic logged before the localized fallback dialog",
  ],
  [
    "html[data-t3code-annotation-tool] body, html[data-t3code-annotation-tool] body * { cursor: crosshair !important; } [${OVERLAY_ATTRIBUTE}], [${OVERLAY_ATTRIBUTE}] * { cursor: default !important; } [${OVERLAY_ATTRIBUTE}] input[type=number]::-webkit-inner-spin-button, [${OVERLAY_ATTRIBUTE}] input[type=number]::-webkit-outer-spin-button { appearance:none; margin:0; }",
    "injected CSS source, not visible language copy",
  ],
] as const);

interface HardcodedDesktopCopy {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly value: string;
}

function desktopSourceFiles(directory: string): readonly string[] {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry): string[] => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return [...desktopSourceFiles(path)];
    if (
      !entry.isFile() ||
      !SOURCE_EXTENSION.test(entry.name) ||
      NON_PRODUCTION_SOURCE.test(entry.name)
    ) {
      return [];
    }
    return [path];
  });
}

function normalizedLiteral(value: string): string | null {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.replace(/\$\{[^}]+\}/gu, "").trim().length === 0) return null;
  if (!/\p{L}/u.test(normalized)) return null;
  return normalized;
}

function isIntentionalLiteral(value: string): boolean {
  return (
    INTENTIONAL_LITERAL_VALUES.has(value as never) ||
    /^https?:\/\//u.test(value) ||
    /^[a-z][\w-]*(?:\.[\w-]+)+$/u.test(value)
  );
}

function hardcodedCopyInFile(file: string): readonly HardcodedDesktopCopy[] {
  const source = NodeFS.readFileSync(file, "utf8");
  const findings: HardcodedDesktopCopy[] = [];
  const report = (index: number, kind: string, rawValue: string) => {
    const value = normalizedLiteral(rawValue);
    if (value === null || isIntentionalLiteral(value)) return;
    findings.push({
      file: NodePath.relative(REPOSITORY_ROOT, file),
      line: source.slice(0, index).split("\n").length,
      kind,
      value,
    });
  };

  for (const match of source.matchAll(USER_FACING_PROPERTY_PATTERN)) {
    report(match.index, `property-${match[1]}`, match[3] ?? "");
  }
  for (const match of source.matchAll(DOM_VISIBLE_PROPERTY_PATTERN)) {
    report(match.index, `dom-${match[1]}`, match[3] ?? "");
  }
  for (const match of source.matchAll(SHOW_ERROR_BOX_LITERAL_PATTERN)) {
    report(match.index, "showErrorBox-title", match[2] ?? "");
  }
  return findings;
}

describe("desktop localization policy", () => {
  it("keeps app-owned visible menus, dialogs, labels, and accessibility copy behind typed IDs", () => {
    const findings = desktopSourceFiles(DESKTOP_SOURCE_ROOT).flatMap(hardcodedCopyInFile);
    expect(findings).toEqual([]);
  });
});
