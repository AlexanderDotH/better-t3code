// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";

import {
  buildProjectIndexers,
  pruneProjectIndexerRuntimeAssets,
  resolveProjectIndexerBuildCommand,
  stageProjectIndexerDeclarations,
  type ProjectIndexerBuildCommand,
} from "./build-project-indexers.ts";

import { PROJECT_INDEX_SYNTAX_GRAMMARS } from "@t3tools/shared/projectIndexLanguages";
const grammarNames = PROJECT_INDEX_SYNTAX_GRAMMARS;

async function linkCompilerFixture(root: string, oldPackage: string) {
  const native = NodePath.join(root, "node_modules/typescript");
  const compatible = NodePath.join(root, "node_modules/@typescript/typescript6");
  const dependencies = NodePath.join(compatible, "node_modules/@typescript");
  await NodeFSP.mkdir(native, { recursive: true });
  await NodeFSP.mkdir(dependencies, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(native, "package.json"),
    '{"name":"typescript","optionalDependencies":{"@typescript/typescript-uninstalled":"7"}}',
  );
  await NodeFSP.writeFile(
    NodePath.join(compatible, "package.json"),
    '{"name":"@typescript/typescript6","dependencies":{"@typescript/old":"6"}}',
  );
  await NodeFSP.writeFile(NodePath.join(oldPackage, "package.json"), '{"name":"typescript"}');
  await NodeFSP.symlink(
    NodePath.relative(dependencies, oldPackage),
    NodePath.join(dependencies, "old"),
    "junction",
  );
}

it("materializes compiler libraries from pnpm links without copying implementation or private files", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-libs-"));
  try {
    const packageRoot = NodePath.join(
      root,
      "node_modules/.pnpm/compiler/node_modules/@typescript/old",
    );
    await NodeFSP.mkdir(NodePath.join(packageRoot, "lib"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(packageRoot, ".t3"));
    await NodeFSP.writeFile(
      NodePath.join(packageRoot, "lib/lib.d.ts"),
      "declare const synthetic: number;",
    );
    await NodeFSP.writeFile(
      NodePath.join(packageRoot, "lib/compiler.js"),
      "synthetic implementation",
    );
    await NodeFSP.writeFile(
      NodePath.join(packageRoot, ".t3/private.d.ts"),
      "synthetic private marker",
    );
    await linkCompilerFixture(root, packageRoot);
    const destination = NodePath.join(root, "resources/project-indexer-declarations");
    expect(await stageProjectIndexerDeclarations(root, destination)).toEqual({ copiedFiles: 1 });
    const copied = NodePath.join(destination, "old/lib/lib.d.ts");
    expect(await NodeFSP.readFile(copied, "utf8")).toBe("declare const synthetic: number;");
    expect((await NodeFSP.lstat(copied)).isSymbolicLink()).toBe(false);
    expect(await NodeFSP.readdir(NodePath.dirname(copied))).toEqual(["lib.d.ts"]);
    expect(await NodeFSP.readdir(NodePath.join(destination, "old"))).toEqual(["lib"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("rejects declaration packages linked outside the release stage", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-libs-"));
  const outside = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-outside-"));
  try {
    await NodeFSP.writeFile(NodePath.join(outside, "lib.d.ts"), "outside source");
    await linkCompilerFixture(root, outside);
    await expect(
      stageProjectIndexerDeclarations(root, NodePath.join(root, "declarations")),
    ).rejects.toThrow("outside the release stage");
    expect(await NodeFSP.readFile(NodePath.join(outside, "lib.d.ts"), "utf8")).toBe(
      "outside source",
    );
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
    await NodeFSP.rm(outside, { recursive: true, force: true });
  }
});

it.effect("uses the Windows Maven command shim with escaped checked-in project arguments", () =>
  Effect.gen(function* () {
    const input = {
      command: "mvn",
      args: [
        "--batch-mode",
        "-f",
        "C:\\synthetic checkout & inputs\\native\\project-indexer-java\\pom.xml",
        "-DskipTests",
        "package",
      ],
      cwd: "C:\\synthetic checkout & inputs",
      env: { PATH: "C:\\Build Tools", PATHEXT: ".EXE;.CMD", JAVA_HOME: "C:\\JDK 21" },
    };
    let resolvedEnvironment: NodeJS.ProcessEnv | undefined;
    const resolved = yield* resolveProjectIndexerBuildCommand(input).pipe(
      Effect.provideService(HostProcessPlatform, "win32"),
      Effect.provideService(SpawnExecutableResolution, (command, platform, env) => {
        expect(command).toBe("mvn");
        expect(platform).toBe("win32");
        resolvedEnvironment = env;
        return "C:\\Build Tools\\mvn.cmd";
      }),
    );
    expect(resolved.shell).toBe(true);
    expect(resolved.command).toBe('^"C:\\Build^ Tools\\mvn.cmd^"');
    expect(resolved.args).toEqual([
      '^"--batch-mode^"',
      '^"-f^"',
      '^"C:\\synthetic^ checkout^ ^&^ inputs\\native\\project-indexer-java\\pom.xml^"',
      '^"-DskipTests^"',
      '^"package^"',
    ]);
    expect(resolved.cwd).toBe(input.cwd);
    expect(resolved.env).toBe(input.env);
    expect(resolvedEnvironment).toBe(input.env);
  }),
);

it.effect("runs native Windows and POSIX build tools directly without changing arguments", () =>
  Effect.gen(function* () {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const input = {
        command: platform === "win32" ? "dotnet.exe" : "mvn",
        args:
          platform === "win32"
            ? ["publish", "synthetic checkout/native/project-indexer-dotnet/ProjectIndexer.csproj"]
            : ["-f", "synthetic checkout/native/project-indexer-java/pom.xml", "package"],
        cwd: "synthetic checkout",
        env: { PATH: "", PATHEXT: ".EXE;.CMD" },
      };
      const resolved = yield* resolveProjectIndexerBuildCommand(input).pipe(
        Effect.provideService(HostProcessPlatform, platform),
        Effect.provideService(SpawnExecutableResolution, () => undefined),
      );
      expect(resolved).toEqual({ ...input, shell: false });
    }
  }),
);

async function grammarFixture(root: string) {
  const packageRoot = NodePath.join(
    root,
    "node_modules/.pnpm/tree-sitter-wasms/node_modules/tree-sitter-wasms",
  );
  const output = NodePath.join(packageRoot, "out");
  await NodeFSP.mkdir(output, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, "package.json"), '{"private":true}');
  await NodeFSP.writeFile(
    NodePath.join(packageRoot, "package.json"),
    '{"name":"tree-sitter-wasms"}',
  );
  for (const name of [...grammarNames, "elm", "ql"]) {
    await NodeFSP.writeFile(NodePath.join(output, `tree-sitter-${name}.wasm`), `fixture:${name}`);
  }
  await NodeFSP.writeFile(NodePath.join(output, "README.md"), "package documentation");
  await NodeFSP.symlink(
    NodePath.relative(NodePath.join(root, "node_modules"), packageRoot),
    NodePath.join(root, "node_modules/tree-sitter-wasms"),
    "junction",
  );
  return { packageRoot, output };
}

it("prunes unused grammars only from the staged pnpm dependency tree and is idempotent", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-prune-"));
  try {
    const { output } = await grammarFixture(root);
    const before = await Promise.all(
      grammarNames.map((name) =>
        NodeFSP.readFile(NodePath.join(output, `tree-sitter-${name}.wasm`)),
      ),
    );
    const result = await pruneProjectIndexerRuntimeAssets(root);
    expect(result.removedGrammars).toBe(2);
    expect(result.removedBytes).toBe(Buffer.byteLength("fixture:elmfixture:ql"));
    expect((await NodeFSP.readdir(output)).sort()).toEqual(
      ["README.md", ...grammarNames.map((name) => `tree-sitter-${name}.wasm`)].sort(),
    );
    const after = await Promise.all(
      grammarNames.map((name) =>
        NodeFSP.readFile(NodePath.join(output, `tree-sitter-${name}.wasm`)),
      ),
    );
    expect(after).toEqual(before);
    expect((await pruneProjectIndexerRuntimeAssets(root)).removedGrammars).toBe(0);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("refuses an external package store or a grammar symlink without changing either tree", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-prune-boundary-"));
  const external = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-external-"));
  try {
    const outside = await grammarFixture(external);
    await NodeFSP.mkdir(NodePath.join(root, "node_modules"));
    await NodeFSP.symlink(
      outside.packageRoot,
      NodePath.join(root, "node_modules/tree-sitter-wasms"),
      "junction",
    );
    await expect(pruneProjectIndexerRuntimeAssets(root)).rejects.toThrow(
      "outside the release stage",
    );
    expect(
      await NodeFSP.readFile(NodePath.join(outside.output, "tree-sitter-rust.wasm"), "utf8"),
    ).toBe("fixture:rust");
    await NodeFSP.unlink(NodePath.join(root, "node_modules/tree-sitter-wasms"));
    const inside = await grammarFixture(root);
    await NodeFSP.unlink(NodePath.join(inside.output, "tree-sitter-python.wasm"));
    await NodeFSP.symlink(
      NodePath.join(outside.output, "tree-sitter-python.wasm"),
      NodePath.join(inside.output, "tree-sitter-python.wasm"),
    );
    await expect(pruneProjectIndexerRuntimeAssets(root)).rejects.toThrow(
      "outside the release stage",
    );
    expect(
      await NodeFSP.readFile(NodePath.join(inside.output, "tree-sitter-rust.wasm"), "utf8"),
    ).toBe("fixture:rust");
    expect(
      await NodeFSP.readFile(NodePath.join(outside.output, "tree-sitter-python.wasm"), "utf8"),
    ).toBe("fixture:python");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
    await NodeFSP.rm(external, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-indexer-build-test-"));
  for (const project of [
    "project-indexer-dotnet/ProjectIndexer.csproj",
    "project-indexer-java/pom.xml",
  ]) {
    const filename = NodePath.join(root, "native", project);
    await NodeFSP.mkdir(NodePath.dirname(filename), { recursive: true });
    await NodeFSP.writeFile(filename, "synthetic build input");
  }
  const output = NodePath.join(root, "apps/server/dist/project-indexer");
  await NodeFSP.mkdir(output, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(output, "previous-build"), "complete previous bundle");
  return { root, output };
}

it("stages the complete helper output and replaces the old bundle only after verification", async () => {
  const { root, output } = await fixture();
  const commands: ProjectIndexerBuildCommand[] = [];
  try {
    const result = await buildProjectIndexers(
      {
        repoRoot: root,
        dotnetCommand: "synthetic-dotnet",
        mavenCommand: "synthetic-maven",
        javaHome: "/synthetic-jdk",
        offline: true,
      },
      async (command) => {
        commands.push(command);
        expect(await NodeFSP.readFile(NodePath.join(output, "previous-build"), "utf8")).toBe(
          "complete previous bundle",
        );
        if (command.command === "synthetic-dotnet") {
          const destination = command.args[command.args.indexOf("--output") + 1]!;
          await NodeFSP.mkdir(NodePath.join(destination, "de"), { recursive: true });
          for (const name of [
            "ProjectIndexer.dll",
            "ProjectIndexer.runtimeconfig.json",
            "ProjectIndexer.deps.json",
            "Microsoft.CodeAnalysis.dll",
            "Microsoft.CodeAnalysis.CSharp.dll",
          ]) {
            await NodeFSP.writeFile(
              NodePath.join(destination, name),
              name.endsWith(".dll") ? "MZfixture" : "{}",
            );
          }
          await NodeFSP.writeFile(
            NodePath.join(destination, "de", "compiler.resources.dll"),
            "MZresource",
          );
        } else {
          const target = NodePath.join(root, "native/project-indexer-java/target");
          await NodeFSP.mkdir(target, { recursive: true });
          await NodeFSP.writeFile(NodePath.join(target, "project-indexer-java.jar"), "PKfixture");
        }
      },
    );
    expect(result.outputDirectory).toBe(output);
    expect(await NodeFSP.readFile(NodePath.join(output, "de/compiler.resources.dll"), "utf8")).toBe(
      "MZresource",
    );
    expect(await NodeFSP.readFile(NodePath.join(output, "project-indexer-java.jar"), "utf8")).toBe(
      "PKfixture",
    );
    expect(commands[1]?.args).toContain("--offline");
    expect(commands[1]?.env.JAVA_HOME).toBe("/synthetic-jdk");
    expect(await NodeFSP.readdir(NodePath.dirname(output))).toEqual(["project-indexer"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("leaves the previous bundle intact when the toolchain or required helper output fails", async () => {
  const { root, output } = await fixture();
  try {
    await expect(
      buildProjectIndexers({ repoRoot: root }, async () => {
        throw new Error("toolchain unavailable");
      }),
    ).rejects.toThrow("toolchain unavailable");
    expect(await NodeFSP.readFile(NodePath.join(output, "previous-build"), "utf8")).toBe(
      "complete previous bundle",
    );
    expect(await NodeFSP.readdir(NodePath.dirname(output))).toEqual(["project-indexer"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
