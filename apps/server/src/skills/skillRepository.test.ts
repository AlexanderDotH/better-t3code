import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  downloadRegistrySkill,
  previewRegistrySkill,
  searchExtensionCatalog,
} from "./extensionCatalog.ts";
import { skillArchive } from "./testUtils/skillArchive.ts";

const main =
  "---\nname: frontend-review\ndescription: Review interfaces\n---\nRead references/checks.md";
const archive = skillArchive([
  { path: "skills/review/SKILL.md", contents: main },
  { path: "skills/review/references/checks.md", contents: "Check accessibility." },
  { path: "skills/review/assets/icon.png", contents: new Uint8Array([137, 80, 78, 71, 255, 0]) },
  { path: "skills/review/scripts/check.sh", contents: "#!/bin/sh\necho checked\n", mode: 0o100755 },
  {
    path: "skills/unrelated/SKILL.md",
    contents: "---\nname: unrelated\ndescription: Other skill\n---\nOther instructions",
  },
  { path: "README.md", contents: "Repository documentation" },
]);

const fromArchive = (buffer = archive) =>
  Effect.provideService(
    FetchHttpClient.Fetch,
    Object.assign(
      async (request: Parameters<typeof fetch>[0]) => {
        if (String(request).startsWith("https://api.github.com/repos/example/skills/releases?")) {
          return Response.json([]);
        }
        expect(String(request)).toBe("https://codeload.github.com/example/skills/zip/HEAD");
        return new Response(new Uint8Array(buffer));
      },
      { preconnect: () => {} },
    ),
  );

describe("public GitHub skill installation", () => {
  it.effect(
    "previews a skill by frontmatter name and downloads all supporting files without credentials",
    () =>
      Effect.gen(function* () {
        const preview = yield* previewRegistrySkill({ source: "example/skills/frontend-review" });
        expect(preview.name).toBe("frontend-review");
        expect(preview.fileCount).toBe(4);
        expect(preview.body).toContain("references/checks.md");
        const downloaded = yield* downloadRegistrySkill({
          source: "example/skills/frontend-review",
        });
        expect(downloaded.files.map((file) => file.path).toSorted()).toEqual([
          "SKILL.md",
          "assets/icon.png",
          "references/checks.md",
          "scripts/check.sh",
        ]);
        expect(downloaded.files.find((file) => file.path === "assets/icon.png")).toMatchObject({
          contents: "iVBOR/8A",
          encoding: "base64",
        });
        expect(downloaded.files.find((file) => file.path === "scripts/check.sh")).toMatchObject({
          executable: true,
        });
      }).pipe(Effect.provide(FetchHttpClient.layer), fromArchive()),
  );

  it.effect(
    "finds current skills in a public repository even when they are absent from a registry",
    () =>
      Effect.gen(function* () {
        for (const query of [
          "example/skills",
          "https://github.com/example/skills",
          "HTTPS://GITHUB.COM/EXAMPLE/SKILLS",
        ]) {
          const result = yield* searchExtensionCatalog({ kind: "skill", query });
          expect(result.entries.map((entry) => entry.id).toSorted()).toEqual([
            "example/skills/frontend-review",
            "example/skills/unrelated",
          ]);
          expect(result.entries[0]?.sourceUrl).toContain(
            "https://github.com/example/skills/tree/HEAD/skills/",
          );
        }
      }).pipe(Effect.provide(FetchHttpClient.layer), fromArchive()),
  );

  it.effect("opens a skill source regardless of the entered name's letter case", () =>
    Effect.gen(function* () {
      const preview = yield* previewRegistrySkill({ source: "example/skills/FRONTEND-REVIEW" });
      expect(preview.source).toBe("example/skills/frontend-review");
    }).pipe(Effect.provide(FetchHttpClient.layer), fromArchive()),
  );

  it.effect("explains a stale registry entry and points to current repository skills", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(previewRegistrySkill({ source: "example/skills/old-name" }));
      expect(error.message).toContain("renamed or removed");
      expect(error.message).toContain("example/skills");
    }).pipe(Effect.provide(FetchHttpClient.layer), fromArchive()),
  );

  for (const file of [
    { path: "skills/review/link", contents: "../../outside", mode: 0o120777 },
    { path: "skills/review/.git/config", contents: "unsafe" },
  ]) {
    it.effect(`rejects an unsafe selected skill entry: ${file.path}`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          previewRegistrySkill({ source: "example/skills/frontend-review" }),
        );
        expect(error.message).toMatch(/unsafe|symbolic/i);
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        fromArchive(skillArchive([{ path: "skills/review/SKILL.md", contents: main }, file])),
      ),
    );
  }

  it.effect("refuses corrupt archives instead of publishing an incomplete skill", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        previewRegistrySkill({ source: "example/skills/frontend-review" }),
      );
      expect(error.message).toContain("archive");
    }).pipe(Effect.provide(FetchHttpClient.layer), fromArchive(Buffer.from("not a zip"))),
  );
});
