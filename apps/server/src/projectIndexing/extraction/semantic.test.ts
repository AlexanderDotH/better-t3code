// @effect-diagnostics nodeBuiltinImport:off - Compiler tests run against synthetic isolated source workspaces.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { extractFile, resolveProject, scanInventory } from "./index.ts";
import { resolveAnalysisHelper } from "./nativeSemantic.ts";
import { callOwnershipFixtures } from "./fixtures/callOwnership.ts";

const roots: string[] = [];
const executeRuntime = NodeUtil.promisify(NodeChildProcess.execFile);

async function compilerRuntimeAvailable(language: "csharp" | "java"): Promise<boolean> {
  try {
    const output =
      language === "csharp"
        ? await executeRuntime("dotnet", ["--list-runtimes"], { timeout: 10_000 })
        : await executeRuntime("java", ["-version"], { timeout: 10_000 });
    const text = `${output.stdout}\n${output.stderr}`;
    return language === "csharp"
      ? /Microsoft\.NETCore\.App 10\./.test(text)
      : Number(/(?:openjdk|java) (?:version )?"?(\d+)/.exec(text)?.[1] ?? 0) >= 21;
  } catch {
    return false;
  }
}

function requireCompilerAcceptance(language: string): void {
  if (process.env.T3CODE_REQUIRE_COMPILER_TESTS === "1") {
    throw new Error(
      `The ${language} compiler acceptance requires its built helper and supported runtime.`,
    );
  }
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string>) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-semantics-"));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) {
    await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, name)), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, name), source);
  }
  const inventory = await scanInventory(root);
  const extracted = await Promise.all(inventory.files.map((file) => extractFile({ root, file })));
  return {
    root,
    files: extracted.map((result) => result.file),
    entities: extracted.flatMap((result) => result.entities),
    callsites: extracted.flatMap((result) => result.callsites),
  };
}

describe("compiler-backed call resolution", () => {
  it.for(callOwnershipFixtures)(
    "resolves method-to-method calls through local declarations in $language",
    async (sample, { skip }) => {
      if (sample.language === "csharp" || sample.language === "java") {
        if (
          !(await resolveAnalysisHelper(sample.language)) ||
          !(await compilerRuntimeAvailable(sample.language))
        ) {
          requireCompilerAcceptance(sample.language);
          skip(`Requires the built ${sample.language} helper and its supported runtime.`);
          return;
        }
      }
      const input = await fixture({
        "tsconfig.json":
          '{ "compilerOptions": { "strict": true, "allowJs": true, "checkJs": true, "target": "es2022", "module": "nodenext" } }',
        "sample.csproj":
          '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
        ".classpath": '<classpath><classpathentry kind="src" path="."/></classpath>',
        [sample.filePath]: sample.source,
      });
      const run = input.entities.find(
        (entity) => entity.name === "run" && entity.kind === "method",
      )!;
      const helper = input.entities.find(
        (entity) => entity.name === "helper" && entity.kind === "method",
      )!;
      const modes =
        sample.language === "typescript" || sample.language === "javascript"
          ? (["native", "compatible"] as const)
          : (["native"] as const);
      for (const typescriptMode of modes) {
        const result = await resolveProject({ ...input, typescriptMode });
        const calls = result.callsites.filter((callsite) => callsite.expression.endsWith("helper"));
        expect(calls).toHaveLength(4);
        expect(
          calls.every(
            (callsite) =>
              callsite.resolution === "resolved" && callsite.targetEntityIds[0] === helper.id,
          ),
        ).toBe(true);
        expect(calls[1]!.callerEntityId).toBe(run.id);
        const nested = input.entities.find((entity) => entity.id === calls[2]!.callerEntityId)!;
        expect(nested.kind).toBe("lambda");
        expect(calls[2]!.callerEntityId).not.toBe(run.id);
        if (sample.language === "typescript" || sample.language === "javascript") {
          const callback = result.callsites.find((callsite) => callsite.expression === "callback")!;
          const anonymous = result.callsites.find(
            (callsite) => callsite.expression === "anonymous",
          )!;
          expect(callback.callerEntityId).toBe(run.id);
          expect(callback.targetEntityIds).toEqual([nested.id]);
          expect(anonymous.targetEntityIds).toEqual([calls[3]!.callerEntityId]);
        }
      }
    },
  );

  it("keeps chained callsites with the same start offset distinct in the compatibility compiler", async () => {
    const input = await fixture({
      "tsconfig.json": "{}",
      "main.ts": "const returnFunction = () => () => 1; returnFunction()();",
    });
    const result = await resolveProject({ ...input, typescriptMode: "compatible" });
    expect(result.callsites).toHaveLength(2);
    expect(result.callsites[0]!.range.startOffset).toBe(result.callsites[1]!.range.startOffset);
    expect(result.callsites.every((callsite) => callsite.resolution === "resolved")).toBe(true);
    expect(result.callsites[0]!.targetEntityIds).not.toEqual(result.callsites[1]!.targetEntityIds);
  });

  it("matches native compiler names after non-ASCII source and UTF-16 surrogate pairs", async () => {
    const input = await fixture({
      "tsconfig.json": '{ "compilerOptions": { "strict": true } }',
      "unicode.ts": "/* 👋 résumé */ function café(): void { café(); } café();",
    });
    const result = await resolveProject({ ...input, typescriptMode: "native" });
    const target = input.entities.find((entity) => entity.name === "café")!;
    expect(result.callsites).toHaveLength(2);
    expect(
      result.callsites.every(
        (callsite) =>
          callsite.resolution === "resolved" && callsite.targetEntityIds[0] === target.id,
      ),
    ).toBe(true);
  });

  it.each(["native", "compatible"] as const)(
    "uses the %s TypeScript adapter for aliases, overloads, constructors and cycles",
    async (typescriptMode) => {
      const input = await fixture({
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            module: "esnext",
            moduleResolution: "bundler",
            paths: { "@domain/*": ["./src/*"] },
            target: "es2022",
          },
          include: ["src/**/*.ts"],
        }),
        "src/api.ts": `/* 👋 café */\nexport namespace Domain {\n export class Box {\n  constructor(public value: number) {}\n  static make(value: number) { return new Box(value); }\n  apply(value: string): string;\n  apply(value: number): number;\n  apply(value: string | number) { return value; }\n  recurse(n: number): number { return n ? this.recurse(n-1) : 0; }\n }\n}\nexport function first(n: number): number { return n ? second(n-1) : 0; }\nexport function second(n: number): number { return first(n); }`,
        "src/main.ts": `import { Domain as Alias, first as start } from '@domain/api';\nconst box = Alias.Box.make(1);\nbox.apply('hello');\nbox.apply(1);\nstart(2);\nnew Alias.Box(3);\nconst unknown: any = {}; const key = 'run'; unknown[key]();`,
      });
      const result = await resolveProject({ ...input, typescriptMode });
      const names = new Map(input.entities.map((entity) => [entity.id, entity]));
      const start = result.callsites.find((callsite) => callsite.expression === "start")!;
      expect(start.resolution).toBe("resolved");
      expect(start.provenance).toBe("compiler");
      expect(names.get(start.targetEntityIds[0]!)?.name).toBe("first");
      const overloadCalls = result.callsites.filter(
        (callsite) => callsite.expression === "box.apply",
      );
      expect(overloadCalls).toHaveLength(2);
      expect(overloadCalls.every((callsite) => callsite.targetEntityIds.length > 0)).toBe(true);
      expect(
        overloadCalls
          .flatMap((callsite) => callsite.targetEntityIds)
          .every((id) => names.get(id)?.name === "apply"),
      ).toBe(true);
      if (typescriptMode === "compatible") {
        expect(names.get(overloadCalls[0]!.targetEntityIds[0]!)?.signature).toContain("string");
        expect(names.get(overloadCalls[1]!.targetEntityIds[0]!)?.signature).toContain("number");
      }
      const recursive = result.callsites.find(
        (callsite) => callsite.expression === "this.recurse",
      )!;
      expect(recursive.targetEntityIds).toContain(recursive.callerEntityId);
      const first = input.entities.find((entity) => entity.name === "first")!;
      const second = input.entities.find((entity) => entity.name === "second")!;
      expect(
        result.callsites.some(
          (callsite) =>
            callsite.callerEntityId === first.id && callsite.targetEntityIds.includes(second.id),
        ),
      ).toBe(true);
      expect(
        result.callsites.some(
          (callsite) =>
            callsite.callerEntityId === second.id && callsite.targetEntityIds.includes(first.id),
        ),
      ).toBe(true);
      const constructor = result.callsites.find((callsite) => callsite.expression === "Alias.Box")!;
      expect(constructor.targetEntityIds.some((id) => names.get(id)?.kind === "constructor")).toBe(
        true,
      );
      const dynamic = result.callsites.find((callsite) => callsite.expression === "unknown[key]")!;
      expect(dynamic.resolution).toBe("unresolved");
      expect(dynamic.targetEntityIds).toEqual([]);
      expect(result.gaps.some((gap) => gap.kind === "unresolved-call")).toBe(true);
    },
  );

  it.each(["native", "compatible"] as const)(
    "does not call invalid or parameter-dispatched TypeScript calls exact with %s",
    async (typescriptMode) => {
      const input = await fixture({
        "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "es2022" } }),
        "main.ts":
          "function accept(n: number) { return n; } accept('invalid'); class Receiver { constructor(callback: () => void) { callback(); } } function shadow(shadow: () => void) { shadow(); }",
      });
      const result = await resolveProject({ ...input, typescriptMode });
      expect(
        result.callsites.find((callsite) => callsite.expression === "accept")?.resolution,
      ).toBe("candidate");
      expect(
        result.callsites.find((callsite) => callsite.expression === "callback")?.resolution,
      ).toBe("unresolved");
      expect(
        result.callsites.find((callsite) => callsite.expression === "shadow")?.resolution,
      ).toBe("unresolved");
      expect(result.gaps.some((gap) => gap.kind === "incomplete-analysis")).toBe(true);
    },
  );

  it("uses Roslyn for C# overloads, aliases, constructors and self loops without executing the source", async ({
    skip,
  }) => {
    const helper = await resolveAnalysisHelper("csharp");
    if (!helper || !(await compilerRuntimeAvailable("csharp"))) {
      requireCompilerAcceptance("C#");
      skip("Requires the built Roslyn helper and .NET 10 runtime.");
      return;
    }
    const input = await fixture({
      "sample.csproj":
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
      "Main.cs": `using Alias = Demo.Counter;\nnamespace Demo;\nclass Counter {\n public Counter() {}\n public static int Pick(int n) => n;\n public static string Pick(string n) => n;\n public int Recurse(int n) => n > 0 ? Recurse(n-1) : 0;\n public static void NeverExecute() { System.IO.File.WriteAllText("indexer-must-not-execute", "bad"); }\n}\nclass Main { void Run() { var c = new Alias(); Alias.Pick(1); Alias.Pick("one"); c.Recurse(2); } }`,
    });
    const result = await resolveProject({ ...input, helperPaths: { dotnet: helper } });
    const names = new Map(input.entities.map((entity) => [entity.id, entity]));
    const recursive = result.callsites.find((callsite) => callsite.expression === "Recurse")!;
    expect(recursive.resolution).toBe("resolved");
    expect(recursive.targetEntityIds).toContain(recursive.callerEntityId);
    const picks = result.callsites.filter((callsite) => callsite.expression === "Alias.Pick");
    expect(picks).toHaveLength(2);
    expect(names.get(picks[0]!.targetEntityIds[0]!)?.signature).toContain("int n");
    expect(names.get(picks[1]!.targetEntityIds[0]!)?.signature).toContain("string n");
    await expect(
      NodeFSP.access(NodePath.join(input.root, "indexer-must-not-execute")),
    ).rejects.toThrow();
    await expect(NodeFSP.access(NodePath.join(input.root, "obj"))).rejects.toThrow();
    await expect(NodeFSP.access(NodePath.join(input.root, "bin"))).rejects.toThrow();
  });

  it("preserves Java syntax when the semantic helper/runtime is unavailable", async () => {
    const input = await fixture({ "Main.java": "class Main { static void run() { run(); } }" });
    const result = await resolveProject({
      ...input,
      helperPaths: { java: NodePath.join(input.root, "missing-helper.jar") },
    });
    expect(input.entities.some((entity) => entity.name === "run")).toBe(true);
    expect(result.callsites).toHaveLength(1);
    expect(result.callsites[0]!.resolution).toBe("unresolved");
    expect(result.gaps.some((gap) => gap.kind === "incomplete-analysis")).toBe(true);
  });

  it("uses JDT bindings for Java packages, nested classes, overloads and constructor calls", async ({
    skip,
  }) => {
    const helper = await resolveAnalysisHelper("java");
    if (!helper || !(await compilerRuntimeAvailable("java"))) {
      requireCompilerAcceptance("Java");
      skip("Requires the built JDT helper and Java 21 or newer.");
      return;
    }
    const input = await fixture({
      ".classpath": '<classpath><classpathentry kind="src" path="src"/></classpath>',
      "src/demo/Counter.java": `package demo;\npublic class Counter {\n public Counter() {}\n public static int pick(int n) { return n; }\n public static String pick(String n) { return n; }\n public int recurse(int n) { return n > 0 ? recurse(n-1) : 0; }\n public static class Nested { public static void run() { Counter.pick(1); } }\n}`,
      "src/demo/Main.java": `package demo;\nimport static demo.Counter.pick;\nclass Main { void run() { Counter counter = new Counter(); pick(1); pick("one"); counter.recurse(2); Counter.Nested.run(); } }`,
    });
    const result = await resolveProject({ ...input, helperPaths: { java: helper } });
    const names = new Map(input.entities.map((entity) => [entity.id, entity]));
    const picks = result.callsites.filter(
      (callsite) => callsite.filePath.endsWith("Main.java") && callsite.expression === "pick",
    );
    expect(picks).toHaveLength(2);
    expect(picks.every((callsite) => callsite.resolution === "resolved")).toBe(true);
    expect(names.get(picks[0]!.targetEntityIds[0]!)?.signature).toContain("int n");
    expect(names.get(picks[1]!.targetEntityIds[0]!)?.signature).toContain("String n");
    const recursive = result.callsites.find(
      (callsite) => callsite.filePath.endsWith("Counter.java") && callsite.expression === "recurse",
    )!;
    expect(recursive.targetEntityIds).toContain(recursive.callerEntityId);
    expect(
      result.callsites.some((callsite) =>
        callsite.targetEntityIds.some((id) => names.get(id)?.kind === "constructor"),
      ),
    ).toBe(true);
    await expect(NodeFSP.access(NodePath.join(input.root, "target"))).rejects.toThrow();
  });
});
