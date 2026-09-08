// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as Predicate from "effect/Predicate";

interface ManifestFile {
  readonly path: string;
  readonly content: string;
}

export type KnowledgeGraphManifestKind = "node" | "cargo" | "go" | "python" | "jvm";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function knowledgeGraphManifestKind(path: string): KnowledgeGraphManifestKind | null {
  const filename = NodePath.posix.basename(path).toLowerCase();
  if (filename === "package.json") return "node";
  if (filename === "cargo.toml") return "cargo";
  if (filename === "go.mod") return "go";
  if (filename === "pyproject.toml" || filename === "requirements.txt") return "python";
  if (filename === "pom.xml" || filename === "build.gradle" || filename === "build.gradle.kts") {
    return "jvm";
  }
  return null;
}

export function knowledgeGraphPackageLabel(
  file: ManifestFile,
  kind: KnowledgeGraphManifestKind,
): string {
  if (kind === "node") {
    try {
      const parsed: unknown = JSON.parse(file.content);
      if (Predicate.isObject(parsed)) {
        const name = Reflect.get(parsed, "name");
        if (typeof name === "string" && name.trim().length > 0) return name.trim();
      }
    } catch {
      // A malformed manifest remains represented by its directory.
    }
  }
  const directory = NodePath.posix.dirname(file.path);
  return directory === "."
    ? NodePath.posix.basename(file.path)
    : NodePath.posix.basename(directory);
}

function recordDependencyNames(value: unknown, names: Set<string>): void {
  if (!Predicate.isObject(value)) return;
  for (const [name, version] of Object.entries(value)) {
    if (name.trim().length > 0 && typeof version === "string") names.add(name.trim());
  }
}

export function extractKnowledgeGraphManifestDependencies(file: ManifestFile): readonly string[] {
  const filename = NodePath.posix.basename(file.path).toLowerCase();
  const names = new Set<string>();
  if (filename === "package.json") {
    try {
      const parsed: unknown = JSON.parse(file.content);
      if (Predicate.isObject(parsed)) {
        for (const field of [
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ]) {
          recordDependencyNames(Reflect.get(parsed, field), names);
        }
      }
    } catch {
      return [];
    }
  } else if (filename === "cargo.toml") {
    const dependencies =
      file.content.match(/\[(?:dev-|build-)?dependencies(?:\.[^\]]+)?\]([\s\S]*?)(?=\n\[|$)/giu) ??
      [];
    for (const section of dependencies) {
      for (const match of section.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gmu)) names.add(match[1]!);
    }
  } else if (filename === "go.mod") {
    for (const match of file.content.matchAll(/^\s*([\w.-]+\.[^\s]+)\s+v\S+/gmu))
      names.add(match[1]!);
  } else if (filename === "requirements.txt") {
    for (const line of file.content.split(/\r?\n/u)) {
      const match = /^\s*([A-Za-z0-9_.-]+)/u.exec(line);
      if (match && !line.trimStart().startsWith("#")) names.add(match[1]!);
    }
  } else if (filename === "pom.xml") {
    for (const match of file.content.matchAll(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/gu)) {
      names.add(match[1]!);
    }
  } else if (filename.startsWith("build.gradle")) {
    for (const match of file.content.matchAll(/["']([\w.-]+:[\w.-]+):[^"']+["']/gu)) {
      names.add(match[1]!);
    }
  } else if (filename === "pyproject.toml") {
    for (const match of file.content.matchAll(/["']([A-Za-z0-9_.-]+)(?:[<>=!~ ]|["'])/gu)) {
      names.add(match[1]!);
    }
  }
  return [...names].sort(compareText);
}
