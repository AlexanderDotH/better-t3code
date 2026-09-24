import { describe, expect, it } from "vite-plus/test";
import { PROJECT_INDEX_SYNTAX_GRAMMARS } from "@t3tools/shared/projectIndexLanguages";

import { projectIndexGrammarFixtures } from "../../../../../scripts/project-indexing-grammar-fixtures.ts";
import { extractSyntax } from "./syntax.ts";
import { sourceLanguage, supportsSyntax } from "./inventory.ts";

describe("bundled language declarations", () => {
  it("has a parse fixture for every shipped grammar", () => {
    expect(projectIndexGrammarFixtures.map((fixture) => fixture.grammar).sort()).toEqual(
      [...PROJECT_INDEX_SYNTAX_GRAMMARS].sort(),
    );
  });
  it.each(projectIndexGrammarFixtures)(
    "extracts named declarations and exact name ranges in $grammar",
    async (fixture) => {
      expect(supportsSyntax(sourceLanguage(fixture.filePath))).toBe(true);
      const result = await extractSyntax(fixture);
      expect(result.gaps).toEqual([]);
      for (const name of fixture.names) {
        const declaration = result.entities.find(
          (entity) => entity.name === name && entity.kind !== "file",
        );
        expect(declaration, `${fixture.grammar}: ${name}`).toBeDefined();
        expect(declaration?.nameRange).toBeDefined();
        expect(
          fixture.source.slice(
            declaration!.nameRange!.startOffset,
            declaration!.nameRange!.endOffset,
          ),
        ).toBe(name);
        expect(declaration?.provenance).toBe("parser");
      }
      expect(
        result.callsites.every(
          (call) => call.resolution === "unresolved" && call.targetEntityIds.length === 0,
        ),
      ).toBe(true);
    },
  );
});
