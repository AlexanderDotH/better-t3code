// @effect-diagnostics nodeBuiltinImport:off - Isolated filesystem fixtures verify module resolution boundaries.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

import { ProjectEvidenceV1, ProjectImportV1, ProjectModuleV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { extractFile, scanInventory } from "./index.ts";
import { extractSyntax } from "./syntax.ts";

const roots: string[] = [];
const decodeImport = Schema.decodeUnknownSync(ProjectImportV1);
const decodeModule = Schema.decodeUnknownSync(ProjectModuleV1);
const decodeEvidence = Schema.decodeUnknownSync(ProjectEvidenceV1);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-imports-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, path), content);
  }
  return root;
}

async function extract(root: string, path: string) {
  const inventory = await scanInventory(root);
  const file = inventory.files.find((item) => item.path === path);
  expect(file).toBeDefined();
  return extractFile({ root, file: file! });
}

describe("static import facts", () => {
  it.each([
    [
      "app.py",
      "import os, lib.helpers as h\nfrom .helpers import run\n",
      ["os", "lib.helpers", ".helpers"],
    ],
    [
      "app.go",
      'package app\nimport "fmt"\nimport ( h "demo/helpers"\n "demo/other" )\n',
      ["fmt", "demo/helpers", "demo/other"],
    ],
    ["app.rs", "use crate::helpers::run;\nmod helpers;", ["crate::helpers::run", "helpers"]],
    ["app.c", '#include "helpers.h"\n#include <stdio.h>\n', ["helpers.h", "stdio.h"]],
    ["app.cpp", '#include "helpers.hpp"\n', ["helpers.hpp"]],
    ["app.m", '#include "helpers.h"\n', ["helpers.h"]],
    ["app.kt", "import demo.helpers.run\n", ["demo.helpers.run"]],
    ["app.scala", "import demo.helpers.run\n", ["demo.helpers.run"]],
    ["app.dart", "import 'helpers.dart';\nexport 'other.dart';", ["helpers.dart", "other.dart"]],
    ["app.zig", 'const h = @import("helpers.zig");', ["helpers.zig"]],
    ["app.rb", 'require "json"\nrequire_relative "helpers"\n', ["json", "helpers"]],
    ["app.php", '<?php include "helpers.php";', ["helpers.php"]],
    ["app.ex", "alias Demo.Helpers\nimport Demo.Other\n", ["Demo.Helpers", "Demo.Other"]],
    ["app.ml", "open Helpers\n", ["Helpers"]],
    ["app.sol", 'import "./Helpers.sol";\n', ["./Helpers.sol"]],
  ])(
    "captures module references in %s with exact source ranges",
    async (filePath, source, specifiers) => {
      const result = await extractSyntax({ filePath, source });
      expect(result.gaps).toEqual([]);
      expect(result.imports.map((record) => record.specifier)).toEqual(specifiers);
      for (const record of result.imports) {
        expect(source.slice(record.range.startOffset, record.range.endOffset)).toBe(
          record.importText,
        );
        expect(decodeImport(record)).toEqual(record);
        expect(record.resolution).toBe("unresolved");
      }
    },
  );

  it.each([
    ["src/app.py", "from .helpers import run\n", "src/helpers.py", "def run(): pass\n"],
    ["src/app.cpp", '#include "helpers.hpp"\n', "src/helpers.hpp", "void run();\n"],
    ["src/app.dart", "import 'helpers.dart';\n", "src/helpers.dart", "void run() {}\n"],
    [
      "src/app.zig",
      'const h = @import("helpers.zig");\n',
      "src/helpers.zig",
      "pub fn run() void {}\n",
    ],
  ])("connects explicit local modules from %s", async (path, source, targetPath, target) => {
    const root = await workspace({ [path]: source, [targetPath]: target });
    const result = await extract(root, path);
    expect(result.imports).toMatchObject([{ resolution: "workspace", targetPath }]);
  });

  it("keeps ambiguous, dynamic, ignored, and external language references unresolved", async () => {
    const root = await workspace({
      ".gitignore": "src/hidden.py\n",
      "src/app.py": "from .helpers import run\nfrom .hidden import secret\nimport external\n",
      "src/helpers.py": "def run(): pass\n",
      "src/helpers/__init__.py": "def run(): pass\n",
      "src/hidden.py": "secret = 1\n",
      "src/app.dart": "import '../linked.dart';\n",
    });
    NodeChildProcess.execFileSync("git", ["init", "-q", "--template="], { cwd: root });
    const outside = await workspace({ "private.dart": "void private() {}\n" });
    await NodeFSP.symlink(
      NodePath.join(outside, "private.dart"),
      NodePath.join(root, "linked.dart"),
    );
    for (const path of ["src/app.py", "src/app.dart"]) {
      const result = await extract(root, path);
      expect(result.imports.length).toBeGreaterThan(0);
      expect(
        result.imports.every((record) => record.resolution === "unresolved" && !record.targetPath),
      ).toBe(true);
    }
    const dynamic = await extractSyntax({
      filePath: "app.rb",
      source: 'require "helpers/#{name}"\n',
    });
    expect(dynamic.imports).toEqual([]);
  });

  it("keeps precise source ranges and stable IDs for imports, re-exports, and literal dynamic imports", async () => {
    const source = [
      '/* 👋 */ import type { A } from "./model";',
      'export { B } from "./model";',
      'const next = import("./lazy");',
      'const cjs = require("pkg/subpath");',
      'import compat = require("legacy");',
      "const unknown = import(runtimePath);",
    ].join("\n");
    const result = await extractSyntax({ filePath: "src/index.ts", source });
    expect(result.imports.map((record) => record.specifier)).toEqual([
      "./model",
      "./model",
      "./lazy",
      "pkg/subpath",
      "legacy",
    ]);
    for (const record of result.imports) {
      expect(source.slice(record.range.startOffset, record.range.endOffset)).toBe(
        record.importText,
      );
      expect(record.resolution).toBe("unresolved");
      expect(decodeImport(record)).toEqual(record);
    }
    expect(result.gaps.some((gap) => gap.message.includes("dynamic or malformed module"))).toBe(
      true,
    );
    const shifted = await extractSyntax({ filePath: "src/index.ts", source: `\n\n${source}` });
    expect(shifted.imports.map((record) => record.id)).toEqual(
      result.imports.map((record) => record.id),
    );
  });

  it("keeps a shadowable require call unresolved", async () => {
    const root = await workspace({
      "src/index.ts":
        'function load(require: (name: string) => unknown) { return require("./local"); }',
      "src/local.ts": "export const local = true;",
    });
    const result = await extract(root, "src/index.ts");
    expect(result.imports).toMatchObject([{ specifier: "./local", resolution: "unresolved" }]);
  });

  it("resolves relative paths and configured TypeScript aliases, and identifies external packages", async () => {
    const root = await workspace({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
      "src/index.ts": [
        'import { helper } from "@/helper";',
        'export { local } from "./local.js";',
        'import type { Thing } from "@scope/package/types";',
        'import { gone } from "./missing";',
      ].join("\n"),
      "src/helper.ts": "export function helper() {}",
      "src/local.ts": "export const local = 1;",
    });
    const result = await extract(root, "src/index.ts");
    expect(result.file.status).toBe("indexed");
    expect(
      result.imports.map(({ specifier, resolution, targetPath, packageName }) => ({
        specifier,
        resolution,
        targetPath,
        packageName,
      })),
    ).toEqual([
      {
        specifier: "@/helper",
        resolution: "workspace",
        targetPath: "src/helper.ts",
        packageName: undefined,
      },
      {
        specifier: "./local.js",
        resolution: "workspace",
        targetPath: "src/local.ts",
        packageName: undefined,
      },
      {
        specifier: "@scope/package/types",
        resolution: "external",
        targetPath: undefined,
        packageName: "@scope/package",
      },
      {
        specifier: "./missing",
        resolution: "unresolved",
        targetPath: undefined,
        packageName: undefined,
      },
    ]);
    for (const record of result.imports) expect(decodeImport(record)).toEqual(record);
  });

  it("does not turn Java or C# namespace declarations into file edges", async () => {
    const cases = [
      { filePath: "src/App.cs", source: "using Foo.Bar; namespace App;", specifier: "Foo.Bar" },
      {
        filePath: "src/App.java",
        source: "import java.util.List; package app;",
        specifier: "java.util.List",
      },
    ];
    for (const input of cases) {
      const result = await extractSyntax(input);
      expect(result.imports).toHaveLength(1);
      expect(result.imports[0]).toMatchObject({
        specifier: input.specifier,
        resolution: "unresolved",
      });
      expect(result.imports[0]).not.toHaveProperty("targetPath");
      expect(result.imports[0]).not.toHaveProperty("packageName");
    }
  });

  it("uses an admitted inherited config for aliases and keeps missing aliases unresolved", async () => {
    const root = await workspace({
      "tsconfig.json": '{ "extends": "./config/base.json" }',
      "config/base.json": JSON.stringify({
        compilerOptions: { baseUrl: "..", paths: { "@domain/*": ["src/*"] } },
      }),
      "src/index.ts": 'import "@domain/known"; import "@domain/missing";',
      "src/known.ts": "export const known = true;",
    });
    const result = await extract(root, "src/index.ts");
    expect(
      result.imports.map(({ resolution, targetPath, packageName }) => ({
        resolution,
        targetPath,
        packageName,
      })),
    ).toEqual([
      { resolution: "workspace", targetPath: "src/known.ts", packageName: undefined },
      { resolution: "unresolved", targetPath: undefined, packageName: undefined },
    ]);
  });

  it("does not create a workspace edge into a Git-ignored source", async () => {
    const root = await workspace({
      ".gitignore": "src/ignored.ts\n",
      "src/index.ts": 'import "./ignored";',
      "src/ignored.ts": "export const ignored = true;",
    });
    NodeChildProcess.execFileSync("git", ["init", "-q", "--template="], { cwd: root });
    const result = await extract(root, "src/index.ts");
    expect(result.imports).toMatchObject([{ specifier: "./ignored", resolution: "unresolved" }]);
  });

  it("does not resolve a symlink outside the workspace", async () => {
    const root = await workspace({ "src/index.ts": 'import "./linked";' });
    const outside = await workspace({ "private.ts": "export const secret = true;" });
    await NodeFSP.symlink(
      NodePath.join(outside, "private.ts"),
      NodePath.join(root, "src/linked.ts"),
    );
    const result = await extract(root, "src/index.ts");
    expect(result.imports).toMatchObject([{ specifier: "./linked", resolution: "unresolved" }]);
  });

  it("creates a package scope only from a recognized manifest and links source evidence", async () => {
    const root = await workspace({
      "apps/web/package.json": JSON.stringify({
        name: "@example/web",
        dependencies: { react: "*" },
      }),
      "apps/web/package-lock.json": "{}",
    });
    const manifest = await extract(root, "apps/web/package.json");
    expect(manifest.modules).toMatchObject([
      {
        name: "@example/web",
        filePaths: ["apps/web/package.json"],
        dependsOnModuleIds: [],
        provenance: "parser",
      },
    ]);
    expect(manifest.modules[0]?.evidenceIds).toEqual([manifest.evidence[0]?.id]);
    expect(manifest.evidence[0]).toMatchObject({ filePath: "apps/web/package.json" });
    expect(manifest.evidence[0]).not.toHaveProperty("excerpt");
    expect(decodeModule(manifest.modules[0])).toEqual(manifest.modules[0]);
    expect(decodeEvidence(manifest.evidence[0])).toEqual(manifest.evidence[0]);
    const lock = await extract(root, "apps/web/package-lock.json");
    expect(lock.modules).toEqual([]);
  });
});
