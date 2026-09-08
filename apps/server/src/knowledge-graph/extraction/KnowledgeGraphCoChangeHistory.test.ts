import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  parseKnowledgeGraphCoChangeHistory,
  readKnowledgeGraphCoChangeGroups,
} from "./KnowledgeGraphCoChangeHistory.ts";

describe("Knowledge Graph co-change history", () => {
  it("turns bounded git commits into deterministic multi-file groups", () => {
    const groups = parseKnowledgeGraphCoChangeHistory(`
__T3_KG_COMMIT__
src/z.ts
src/a.ts
src/a.ts

__T3_KG_COMMIT__
README.md
src/a.ts

__T3_KG_COMMIT__
single.ts
`);

    assert.deepStrictEqual(groups, [
      ["src/a.ts", "src/z.ts"],
      ["README.md", "src/a.ts"],
    ]);
  });

  it("rejects absolute and escaping paths from repository history", () => {
    const groups = parseKnowledgeGraphCoChangeHistory(`
__T3_KG_COMMIT__
/etc/passwd
/etc/shadow
src/a.ts
../outside.ts

__T3_KG_COMMIT__
C:\\Users\\alex\\secret.ts
C:\\Users\\alex\\token.ts
src/b.ts
src/c.ts
`);

    assert.deepStrictEqual(groups, [["src/b.ts", "src/c.ts"]]);
  });

  it.effect("uses a bounded read-only git log request and degrades to no evidence", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = [];
      const groups = yield* readKnowledgeGraphCoChangeGroups("/repo", {
        runGitLog: (cwd, args) => {
          calls.push({ args, cwd });
          return Promise.resolve("__T3_KG_COMMIT__\na.ts\nb.ts\n");
        },
      });
      const unavailable = yield* readKnowledgeGraphCoChangeGroups("/missing", {
        runGitLog: () => Promise.reject(new Error("not a repository")),
      });

      assert.deepStrictEqual(groups, [["a.ts", "b.ts"]]);
      assert.deepStrictEqual(unavailable, []);
      assert.strictEqual(calls[0]?.cwd, "/repo");
      assert.isTrue(calls[0]?.args.includes("--max-count=128"));
      assert.isTrue(calls[0]?.args.includes("--name-only"));
    }),
  );
});
