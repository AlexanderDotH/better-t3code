// @effect-diagnostics nodeBuiltinImport:off - Real compiler streams use isolated source fixtures and explicit toolchain prerequisites.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import type { ProjectCallsiteV1 } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { extractFile, scanInventory } from "./index.ts";
import { resolveAnalysisHelper } from "./nativeSemantic.ts";
import { declarationTarget } from "./semantic.ts";
import { resolveProjectBatches } from "./streaming.ts";
import { SEMANTIC_BATCH_SIZE, type SemanticReader } from "./streamingTypes.ts";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});

async function fixture(contents: Record<string, string>) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-stream-"));
  roots.push(root);
  for (const [file, source] of Object.entries(contents)) {
    await NodeFSP.mkdir(NodePath.dirname(NodePath.join(root, file)), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(root, file), source);
  }
  const inventory = await scanInventory(root);
  const extracted = await Promise.all(inventory.files.map((file) => extractFile({ root, file })));
  const files = extracted.map((value) => value.file);
  const entities = extracted.flatMap((value) => value.entities);
  const calls = extracted.flatMap((value) => value.callsites);
  const requests = { filePages: 0, callPages: 0, largestLookup: 0, lookups: 0, targets: 0 };
  const reader: SemanticReader = {
    async files(languages, cursor, limit) {
      expect(limit).toBe(SEMANTIC_BATCH_SIZE);
      requests.filePages++;
      const remaining = files
        .filter((file) => languages.includes(file.language) && (!cursor || file.path > cursor))
        .sort((left, right) => left.path.localeCompare(right.path));
      const items = remaining.slice(0, Math.min(limit, 1));
      return { items, nextCursor: remaining.length > items.length ? items.at(-1)!.path : null };
    },
    async callsites(filePath, cursor, limit) {
      expect(limit).toBe(SEMANTIC_BATCH_SIZE);
      requests.callPages++;
      const remaining = calls
        .filter((call) => call.filePath === filePath && (!cursor || call.id > cursor))
        .sort((left, right) => left.id.localeCompare(right.id));
      const items = remaining.slice(0, limit);
      return { items, nextCursor: remaining.length > items.length ? items.at(-1)!.id : null };
    },
    async file(filePath) {
      return files.find((file) => file.path === filePath);
    },
    async callsitesAt(locations) {
      requests.lookups++;
      expect(locations.length).toBeLessThanOrEqual(SEMANTIC_BATCH_SIZE);
      requests.largestLookup = Math.max(requests.largestLookup, locations.length);
      return calls.filter((call) =>
        locations.some(
          (location) =>
            location.filePath === call.filePath &&
            location.startOffset === call.range.startOffset &&
            location.endOffset === call.range.endOffset,
        ),
      );
    },
    async target(location) {
      requests.targets++;
      return declarationTarget(
        entities.filter((entity) => entity.filePath === location.filePath),
        location.startOffset,
        location.endOffset,
        location.name,
      );
    },
  };
  return { root, reader, files, entities, calls, requests };
}

const configs = {
  "tsconfig.json":
    '{ "compilerOptions": { "target": "es2022", "module": "nodenext", "strict": true } }',
  "package.json": '{ "type": "module" }',
  "App.csproj":
    '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>',
  ".classpath": '<classpath><classpathentry kind="src" path="src"/></classpath>',
};

describe("bounded semantic resolution", () => {
  it.for(["native", "compatible", "csharp", "java"] as const)(
    "resolves cross-file methods, constructors and lambda ownership with %s",
    async (mode, { skip }) => {
      if (mode === "csharp" || mode === "java") {
        try {
          if (!(await resolveAnalysisHelper(mode))) throw new Error("Helper missing");
          await execute(
            mode === "csharp" ? "dotnet" : "java",
            mode === "csharp" ? ["--list-runtimes"] : ["-version"],
            { timeout: 10_000 },
          );
        } catch {
          if (process.env.T3CODE_REQUIRE_COMPILER_TESTS === "1")
            throw new Error(`Required ${mode} runtime/helper unavailable.`);
          skip(`Requires the built ${mode} helper and supported runtime.`);
          return;
        }
      }
      const source =
        mode === "csharp"
          ? {
              "Api.cs":
                "namespace Domain; public class Api { public Api() {} public static int helper() => 1; }",
              "Main.cs":
                "using Alias = Domain.Api; class Main { int run() { var instance = new Alias(); var result = Alias.helper(); System.Func<int> callback = () => Alias.helper(); return result; } }",
            }
          : mode === "java"
            ? {
                "src/domain/Api.java":
                  "package domain; public class Api { public Api() {} public static int helper() { return 1; } }",
                "src/app/Main.java":
                  "package app; import domain.Api; class Main { int run() { Api instance = new Api(); int result = Api.helper(); java.util.function.IntSupplier callback = () -> Api.helper(); return result; } }",
              }
            : {
                "api.ts": "export class Api { constructor() {} static helper() { return 1; } }",
                "main.ts":
                  "import { Api as Alias } from './api.js'; class Main { run() { const instance = new Alias(); const result = Alias.helper(); const callback = () => Alias.helper(); return result; } }",
              };
      const input = await fixture({ ...configs, ...source });
      const output: ProjectCallsiteV1[] = [];
      const gaps = [];
      for await (const batch of resolveProjectBatches({
        root: input.root,
        reader: input.reader,
        typescriptMode: mode === "compatible" ? "compatible" : "native",
      })) {
        expect(batch.callsites.length).toBeLessThanOrEqual(SEMANTIC_BATCH_SIZE);
        expect(batch.gaps.length).toBeLessThanOrEqual(SEMANTIC_BATCH_SIZE);
        output.push(...batch.callsites);
        gaps.push(...batch.gaps);
      }
      const helper = input.entities.find(
        (entity) => entity.name === "helper" && entity.kind === "method",
      )!;
      const run = input.entities.find(
        (entity) => entity.name === "run" && entity.kind === "method",
      )!;
      const constructor = input.entities.find((entity) => entity.kind === "constructor")!;
      const calls = output.filter((call) => call.expression.endsWith("helper"));
      expect(calls).toHaveLength(2);
      expect(
        calls.every(
          (call) => call.resolution === "resolved" && call.targetEntityIds[0] === helper.id,
        ),
      ).toBe(true);
      expect(calls.some((call) => call.callerEntityId === run.id)).toBe(true);
      expect(
        calls.some(
          (call) =>
            input.entities.find((entity) => entity.id === call.callerEntityId)?.kind === "lambda",
        ),
      ).toBe(true);
      expect(
        output.some(
          (call) => call.resolution === "resolved" && call.targetEntityIds[0] === constructor.id,
        ),
      ).toBe(true);
      expect(gaps).toEqual([]);
      expect(input.requests.filePages).toBeGreaterThanOrEqual(2);
    },
  );

  it.for(["native", "compatible"] as const)(
    "streams more than one call page and reuses lazy targets with %s",
    async (typescriptMode) => {
      const input = await fixture({
        ...configs,
        "api.ts": "export class Api { static helper() { return 1; } }",
        "main.ts": `import { Api } from './api.js'; class Main { run() { ${Array.from({ length: 385 }, (_, index) => `const v${index} = Api.helper();`).join(" ")} } }`,
      });
      let count = 0;
      let batches = 0;
      const run = input.entities.find((entity) => entity.name === "run")!;
      for await (const batch of resolveProjectBatches({
        root: input.root,
        reader: input.reader,
        typescriptMode,
      })) {
        if (batch.callsites.length > 0) batches++;
        count += batch.callsites.length;
        expect(
          batch.callsites.every(
            (call) => call.callerEntityId === run.id && call.resolution === "resolved",
          ),
        ).toBe(true);
        expect(batch.callsites.length).toBeLessThanOrEqual(SEMANTIC_BATCH_SIZE);
        expect(batch.gaps).toEqual([]);
      }
      expect(count).toBe(385);
      expect(batches).toBe(4);
      expect(input.requests.largestLookup).toBe(128);
      expect(input.requests.targets).toBeLessThanOrEqual(2);
    },
  );

  it("rejects changed source bytes in the compatibility worker", async () => {
    const input = await fixture({ ...configs, "main.ts": "function run() { run(); }" });
    await NodeFSP.writeFile(NodePath.join(input.root, "main.ts"), "function run() { return; }");
    const gaps = [];
    for await (const batch of resolveProjectBatches({
      root: input.root,
      reader: input.reader,
      typescriptMode: "compatible",
    })) {
      expect(batch.callsites).toEqual([]);
      gaps.push(...batch.gaps);
    }
    expect(gaps.some((gap) => gap.message.includes("Source changed"))).toBe(true);
  });

  it.for(["native", "compatible"] as const)(
    "stops paginated resolution when cancelled with %s",
    async (typescriptMode) => {
      const input = await fixture({
        ...configs,
        "main.ts": `class Main { static helper() {} run() { ${Array.from({ length: 300 }, () => "Main.helper();").join(" ")} } }`,
      });
      const abort = new AbortController();
      const stream = resolveProjectBatches({
        root: input.root,
        reader: input.reader,
        typescriptMode,
        signal: abort.signal,
      });
      let batch = await stream.next();
      while (!batch.done && batch.value.callsites.length === 0) batch = await stream.next();
      expect(batch.done).toBe(false);
      expect(batch.value?.callsites).toHaveLength(SEMANTIC_BATCH_SIZE);
      const lookups = input.requests.lookups;
      abort.abort(new Error("Stop indexing fixture."));
      await expect(stream.next()).rejects.toThrow("Stop indexing fixture");
      expect(input.requests.lookups).toBe(lookups);
      await stream.return(undefined);
    },
  );
});
