// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";
import { PROJECT_INDEX_SYNTAX_GRAMMARS } from "@t3tools/shared/projectIndexLanguages";

import { scanInventory, type InventoryCursor } from "../extraction/inventory.ts";
import { readSourceUnit, sourceHash } from "../extraction/source.ts";
import { extractSyntax, probeSyntaxGrammars } from "../extraction/syntax.ts";

describe("project indexing scale acceptance", () => {
  it("enumerates every source beyond 25,000 files through persisted inventory cursors", async () => {
    const root = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-index-inventory-acceptance-"),
    );
    const sourceCount = 25_137;
    const writeBatchSize = 128;
    try {
      await NodeFSP.mkdir(NodePath.join(root, "src"));
      await NodeFSP.mkdir(NodePath.join(root, ".t3", "knowledge"), { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(root, ".t3", "knowledge", "private.ts"),
        "private fixture",
      );
      for (let start = 0; start < sourceCount; start += writeBatchSize) {
        await Promise.all(
          Array.from({ length: Math.min(writeBatchSize, sourceCount - start) }, (_, offset) =>
            NodeFSP.writeFile(
              NodePath.join(root, "src", `unit-${String(start + offset).padStart(5, "0")}.ts`),
              "",
            ),
          ),
        );
      }
      const seen = new Set<string>();
      let cursor: InventoryCursor | undefined;
      let pages = 0;
      do {
        const page = await scanInventory(root, { ...(cursor ? { cursor } : {}), batchSize: 997 });
        for (const file of page.files) {
          expect(seen.has(file.path)).toBe(false);
          seen.add(file.path);
          if (file.path.startsWith("src/")) expect(file.status).toBe("pending");
        }
        cursor = page.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(30);
        if (page.done) expect(cursor).toBeUndefined();
      } while (cursor);
      expect([...seen].filter((filePath) => filePath.startsWith("src/"))).toHaveLength(sourceCount);
      expect(seen.has("src/unit-25136.ts")).toBe(true);
      expect(seen.has(".t3/knowledge/private.ts")).toBe(false);
      expect(pages).toBeGreaterThan(25);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves 97 methods and their unresolved calls through grammar extraction", async () => {
    const source = [
      "export class ManyMethods {",
      ...Array.from(
        { length: 97 },
        (_, index) => `  method${index}(value: number) { return this.shared(value + ${index}); }`,
      ),
      "  shared(value: number) { return value; }",
      "  text = 'this.nonexistent()';",
      "}",
    ].join("\n");
    const extracted = await extractSyntax({ filePath: "src/many-methods.ts", source });
    expect(extracted.gaps).toEqual([]);
    const methods = extracted.entities.filter((entity) => entity.kind === "method");
    expect(methods).toHaveLength(98);
    expect(methods.some((entity) => entity.name === "method96")).toBe(true);
    expect(extracted.callsites).toHaveLength(97);
    expect(extracted.callsites.every((callsite) => callsite.resolution === "unresolved")).toBe(
      true,
    );
  });

  it("rejects stale source before supplying an original excerpt", async () => {
    const root = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-index-source-acceptance-"),
    );
    try {
      const source = "export function initial() { return 1; }\n";
      await NodeFSP.writeFile(NodePath.join(root, "source.ts"), source);
      expect(
        await readSourceUnit({ root, filePath: "source.ts", expectedHash: sourceHash(source) }),
      ).toBe(source);
      await NodeFSP.writeFile(
        NodePath.join(root, "source.ts"),
        "export function changed() { return 2; }\n",
      );
      await expect(
        readSourceUnit({ root, filePath: "source.ts", expectedHash: sourceHash(source) }),
      ).rejects.toThrow("Source changed");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("loads all shipped syntax grammars from their actual runtime assets", async () => {
    expect((await probeSyntaxGrammars()).map((entry) => entry.grammar)).toEqual(
      PROJECT_INDEX_SYNTAX_GRAMMARS,
    );
  });
});
