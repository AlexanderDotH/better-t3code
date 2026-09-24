import { describe, expect, it } from "vite-plus/test";

import { extractSyntax } from "./syntax.ts";
import { callOwnershipFixtures } from "./fixtures/callOwnership.ts";

describe("project syntax inventory", () => {
  it.each(callOwnershipFixtures)(
    "attributes local declaration calls to the enclosing method in $language",
    async (fixture) => {
      const result = await extractSyntax(fixture);
      expect(result.gaps).toEqual([]);
      const entities = new Map(result.entities.map((entity) => [entity.id, entity]));
      const run = result.entities.find(
        (entity) => entity.name === "run" && entity.kind === "method",
      )!;
      const localVariable = result.entities.find(
        (entity) => entity.name === "result" && entity.kind === "variable",
      )!;
      expect(localVariable.containerId).toBe(run.id);
      const calls = result.callsites.filter((callsite) => callsite.expression.endsWith("helper"));
      expect(calls).toHaveLength(4);
      expect(["property", "initializer"]).toContain(entities.get(calls[0]!.callerEntityId!)?.kind);
      expect(calls[1]!.callerEntityId).toBe(run.id);
      const nestedLambda = entities.get(calls[2]!.callerEntityId!)!;
      expect(nestedLambda.kind).toBe("lambda");
      expect(calls[2]!.callerEntityId).not.toBe(run.id);
      expect(entities.get(calls[3]!.callerEntityId!)?.kind).toBe(fixture.anonymousKind);
      expect(
        result.callsites.every(
          (callsite) => entities.get(callsite.callerEntityId!)?.kind !== "variable",
        ),
      ).toBe(true);
      expect(
        result.callsites
          .filter((callsite) => !callsite.expression.endsWith("helper"))
          .every((callsite) => callsite.callerEntityId === run.id),
      ).toBe(true);
    },
  );

  it.each([
    {
      filePath: "unicode.ts",
      source: "/* 👋 café */ function entrée() { entrée(); }",
      call: "entrée()",
    },
    {
      filePath: "unicode.cs",
      source: "/* 👋 café */ class Café { static void Entrée() { Entrée(); } }",
      call: "Entrée()",
    },
    {
      filePath: "unicode.java",
      source: "/* 👋 café */ class Café { static void entrée() { entrée(); } }",
      call: "entrée()",
    },
  ])("uses UTF-16 offsets and columns for $filePath", async ({ filePath, source, call }) => {
    const result = await extractSyntax({ filePath, source });
    expect(result.gaps).toEqual([]);
    const callsite = result.callsites[0]!;
    const offset = source.lastIndexOf(call);
    expect(callsite.range.startOffset).toBe(offset);
    expect(callsite.range.startColumn).toBe(offset + 1);
    expect(source.slice(callsite.range.startOffset, callsite.range.endOffset)).toBe(call);
  });

  it("preserves Unicode UTF-16 ranges, overload signatures, namespaces and recursive calls", async () => {
    const source = `/* 👋 café */\nnamespace Café {\n export class Box {\n  constructor() {}\n  static run(value: string): string;\n  static run(value: number): number;\n  static run(value: string | number) { return Box.run(value as number); }\n }\n}\nnew Café.Box();`;
    const extracted = await extractSyntax({ filePath: "src/example.ts", source });
    expect(extracted.gaps).toEqual([]);
    const methods = extracted.entities.filter((entity) => entity.name === "run");
    expect(methods).toHaveLength(3);
    expect(new Set(methods.map((entity) => entity.id)).size).toBe(3);
    expect(methods.every((entity) => entity.qualifiedName.includes("Café::Box::run"))).toBe(true);
    expect(source.slice(methods[0]!.range.startOffset, methods[0]!.range.endOffset)).toBe(
      "static run(value: string): string",
    );
    expect(methods[0]!.range.startLine).toBe(5);
    expect(methods[0]!.range.startColumn).toBe(3);
    const recursive = extracted.callsites.find((callsite) => callsite.expression === "Box.run")!;
    expect(recursive.callerEntityId).toBe(methods[2]!.id);
    expect(source.slice(recursive.range.startOffset, recursive.range.endOffset)).toBe(
      "Box.run(value as number)",
    );
    expect(recursive.resolution).toBe("unresolved");
    const shifted = await extractSyntax({ filePath: "src/example.ts", source: "\n\n" + source });
    expect(shifted.entities.map((entity) => entity.id)).toEqual(
      extracted.entities.map((entity) => entity.id),
    );
  });

  it("represents every method in large classes, including methods after the old 64-symbol boundary", async () => {
    const source = `export class Large {\n${Array.from({ length: 137 }, (_, index) => `method${index}() { return this.method${(index + 1) % 137}(); }`).join("\n")}\n}`;
    const result = await extractSyntax({ filePath: "large.ts", source });
    expect(result.entities.filter((entity) => entity.kind === "method")).toHaveLength(137);
    expect(result.callsites).toHaveLength(137);
    expect(result.entities.find((entity) => entity.name === "method136")).toBeDefined();
    expect(result.gaps).toEqual([]);
  });

  it.each(["index.js", "index.mjs", "index.cjs", "index.jsx"])(
    "parses executable JavaScript in %s",
    async (filePath) => {
      const result = await extractSyntax({
        filePath,
        source:
          "const factory = function create() { return () => factory(); }; class View { render() { return <span />; } }",
      });
      expect(result.entities.some((entity) => entity.kind === "class")).toBe(true);
      expect(result.entities.some((entity) => entity.kind === "lambda")).toBe(true);
      expect(result.callsites.map((callsite) => callsite.expression)).toContain("factory");
      expect(result.gaps).toEqual([]);
    },
  );

  it("covers TSX, arrow callbacks, static blocks and dynamic calls without invented exact edges", async () => {
    const result = await extractSyntax({
      filePath: "View.tsx",
      source:
        "class View { static { boot(); } render = () => <div>{items.map(item => lookup[item]())}</div>; }",
    });
    expect(result.entities.filter((entity) => entity.kind === "lambda")).toHaveLength(2);
    expect(result.entities.filter((entity) => entity.kind === "initializer")).toHaveLength(1);
    expect(
      result.callsites.find((callsite) => callsite.expression === "lookup[item]")?.dispatch,
    ).toBe("dynamic");
    expect(result.callsites.every((callsite) => callsite.targetEntityIds.length === 0)).toBe(true);
  });

  it("covers C# nested types, accessors, expression bodies, constructors and file-scoped namespaces", async () => {
    const source =
      "namespace Demo; class Outer { public Outer() { Run(); } static void Run() {} int Value { get => 1; set { Run(); } } class Inner { public int Read(int value) => value; } }";
    const result = await extractSyntax({ filePath: "Outer.cs", source });
    expect(result.gaps.some((gap) => gap.kind === "parse-error")).toBe(false);
    expect(result.gaps.some((gap) => gap.message.includes("Implicit accessor dispatch"))).toBe(
      true,
    );
    expect(
      result.entities.filter((entity) => entity.kind === "class").map((entity) => entity.name),
    ).toEqual(["Outer", "Inner"]);
    expect(
      result.entities.some((entity) => entity.qualifiedName.includes("Demo::Outer::Inner::Read")),
    ).toBe(true);
    expect(result.entities.filter((entity) => entity.kind === "constructor")).toHaveLength(1);
    expect(
      result.entities.filter((entity) => entity.name === "get" || entity.name === "set"),
    ).toHaveLength(2);
    expect(result.callsites).toHaveLength(2);
  });

  it("retains C# operator, conversion, accessor and local-function bodies with explicit visibility", async () => {
    const source = `public class Counter {
      private int Value { get { return Helper(); } set { Helper(); } }
      protected internal static Counter Merge(Counter a, Counter b) => a;
      public static Counter operator +(Counter a, Counter b) => Merge(a,b);
      public static implicit operator int(Counter value) => Helper();
      public void Run() { int local() { return Helper(); } local(); }
      private static int Helper() => 1;
    }`;
    const result = await extractSyntax({ filePath: "Counter.cs", source });
    expect(result.gaps.some((gap) => gap.kind === "parse-error")).toBe(false);
    const operators = result.entities.filter(
      (entity) => entity.kind === "method" && entity.name.startsWith("operator "),
    );
    expect(operators).toHaveLength(2);
    expect(
      operators.every(
        (entity) =>
          entity.visibility === "public" &&
          source.slice(entity.range.startOffset, entity.range.endOffset).includes("operator"),
      ),
    ).toBe(true);
    expect(result.entities.find((entity) => entity.name === "Merge")?.visibility).toBe(
      "protected-internal",
    );
    expect(result.entities.find((entity) => entity.name === "Helper")?.visibility).toBe("private");
    const local = result.entities.find(
      (entity) => entity.name === "local" && entity.kind === "function",
    )!;
    expect(local.visibility).toBe("local");
    expect(
      result.callsites.some(
        (call) => call.callerEntityId === local.id && call.expression === "Helper",
      ),
    ).toBe(true);
    expect(result.gaps.some((gap) => gap.message.includes("Implicit operator dispatch"))).toBe(
      true,
    );
  });

  it("retains Java records, compact constructors and initializer ranges", async () => {
    const source =
      "public record Point(int x) { Point { if (x < 0) throw new IllegalArgumentException(); } static { warmup(); } static void warmup() {} int doubled() { return x * 2; } }";
    const result = await extractSyntax({ filePath: "Point.java", source });
    expect(result.gaps).toEqual([]);
    expect(
      result.entities.find((entity) => entity.name === "Point" && entity.kind === "class")
        ?.visibility,
    ).toBe("public");
    expect(result.entities.filter((entity) => entity.kind === "constructor")).toHaveLength(1);
    expect(result.entities.filter((entity) => entity.kind === "initializer")).toHaveLength(1);
    expect(
      result.entities.some((entity) => entity.name === "doubled" && entity.kind === "method"),
    ).toBe(true);
  });

  it("records explicit TypeScript and private-name JavaScript visibility without inventing public defaults", async () => {
    const javascript = await extractSyntax({
      filePath: "Service.js",
      source: "class Service { #hidden() {} visible() {} }",
    });
    expect(javascript.entities.find((entity) => entity.name === "#hidden")?.visibility).toBe(
      "private",
    );
    expect(javascript.entities.find((entity) => entity.name === "visible")?.visibility).toBe(
      "unknown",
    );
    const typescript = await extractSyntax({
      filePath: "Service.ts",
      source:
        "export class Service { protected hidden() {} public exposed() {} private secret = 1; }",
    });
    expect(typescript.entities.find((entity) => entity.name === "Service")?.visibility).toBe(
      "public",
    );
    expect(typescript.entities.find((entity) => entity.name === "hidden")?.visibility).toBe(
      "protected",
    );
    expect(typescript.entities.find((entity) => entity.name === "exposed")?.visibility).toBe(
      "public",
    );
    expect(typescript.entities.find((entity) => entity.name === "secret")?.visibility).toBe(
      "private",
    );
  });

  it("covers Java packages, nested classes, constructor calls and static/instance initializers", async () => {
    const source =
      "package demo.app; class Outer { static { start(); } { start(); } Outer() {} static void start() { new Outer(); } class Inner { void recurse() { recurse(); } } }";
    const result = await extractSyntax({ filePath: "Outer.java", source });
    expect(result.gaps).toEqual([]);
    expect(
      result.entities.some((entity) =>
        entity.qualifiedName.includes("demo.app::Outer::Inner::recurse"),
      ),
    ).toBe(true);
    expect(result.entities.filter((entity) => entity.kind === "initializer")).toHaveLength(2);
    expect(result.callsites).toHaveLength(4);
  });

  it("preserves recovered syntax and marks parse gaps instead of calling malformed files complete", async () => {
    const source = "class Broken { first() {} broken( { } last() { unknown(); } }";
    const result = await extractSyntax({ filePath: "broken.ts", source });
    expect(result.entities[0]!.range.endOffset).toBe(source.length);
    expect(result.entities.some((entity) => entity.name === "first")).toBe(true);
    expect(result.gaps.some((gap) => gap.kind === "parse-error")).toBe(true);
  });
});
