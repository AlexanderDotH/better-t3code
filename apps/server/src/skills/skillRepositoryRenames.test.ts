import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  downloadRegistrySkill,
  previewRegistrySkill,
  searchExtensionCatalog,
} from "./extensionCatalog.ts";
import { skillArchive } from "./testUtils/skillArchive.ts";

const renamedArchive = skillArchive([
  {
    path: "skills/hunt-a-handle/SKILL.md",
    contents:
      "---\nname: hunt-a-handle\ndescription: Follow public usernames\n---\nRead reference/platforms.md",
  },
  { path: "skills/hunt-a-handle/reference/platforms.md", contents: "Verify matching accounts." },
  {
    path: "skills/investigate-anything/SKILL.md",
    contents:
      "---\nname: investigate-anything\ndescription: Plan investigations\n---\nStart with scope.",
  },
]);
const releases = [
  {
    body: [
      "## Breaking: skills renamed",
      "",
      "| Old | New |",
      "|---|---|",
      "| `username-osint` | `hunt-a-handle` |",
      "| `osint-investigation` | `investigate-anything` |",
    ].join("\n"),
  },
];

function fromRepository(repository: string, published = releases) {
  const requests: string[] = [];
  return {
    requests,
    provide: Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        async (request: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = new URL(String(request));
          requests.push(url.href);
          expect(new Headers(init?.headers).has("Authorization")).toBe(false);
          if (url.host === "codeload.github.com") {
            expect(url.pathname).toBe("/" + repository + "/zip/HEAD");
            return new Response(new Uint8Array(renamedArchive));
          }
          if (url.host === "api.github.com") {
            expect(url.pathname).toBe("/repos/" + repository + "/releases");
            return Response.json(published);
          }
          expect(url.host).toBe("skills.sh");
          return Response.json({
            skills: [
              {
                id: repository + "/username-osint",
                name: "username-osint",
                source: repository,
                skillId: "username-osint",
              },
            ],
          });
        },
        { preconnect: () => {} },
      ),
    ),
  };
}

describe("published skill renames", () => {
  it.effect(
    "resolves the screenshot's old name, previews current instructions, and installs by its canonical source",
    () => {
      const repository = "rename-preview/skills";
      const remote = fromRepository(repository);
      return Effect.gen(function* () {
        const preview = yield* previewRegistrySkill({ source: repository + "/username-osint" });
        expect(preview.source).toBe(repository + "/hunt-a-handle");
        expect(preview.name).toBe("hunt-a-handle");
        expect(preview.fileCount).toBe(2);
        expect(preview.body).toContain("reference/platforms.md");
        const installation = yield* downloadRegistrySkill({ source: preview.source });
        expect(installation.name).toBe("hunt-a-handle");
        expect(installation.contentHash).toBe(preview.contentHash);
        expect(remote.requests.filter((url) => url.includes("api.github.com"))).toHaveLength(1);
      }).pipe(Effect.provide(FetchHttpClient.layer), remote.provide);
    },
  );

  it.effect(
    "reuses one published rename table for other stale results and normalizes subsequent searches",
    () => {
      const repository = "rename-catalog/skills";
      const remote = fromRepository(repository);
      return Effect.gen(function* () {
        yield* previewRegistrySkill({ source: repository + "/username-osint" });
        const other = yield* previewRegistrySkill({ source: repository + "/osint-investigation" });
        expect(other.source).toBe(repository + "/investigate-anything");
        const result = yield* searchExtensionCatalog({ kind: "skill", query: "username" });
        expect(result.entries).toMatchObject([
          {
            id: repository + "/hunt-a-handle",
            name: "hunt-a-handle",
          },
        ]);
        expect(remote.requests.filter((url) => url.includes("api.github.com"))).toHaveLength(1);
      }).pipe(Effect.provide(FetchHttpClient.layer), remote.provide);
    },
  );

  it.effect("does not guess a replacement when a release has no explicit rename table", () => {
    const repository = "rename-unconfirmed/skills";
    const remote = fromRepository(repository, [
      { body: "username-osint is similar to hunt-a-handle." },
    ]);
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        previewRegistrySkill({ source: repository + "/username-osint" }),
      );
      expect(error.message).toContain("renamed or removed");
    }).pipe(Effect.provide(FetchHttpClient.layer), remote.provide);
  });

  it.effect("refuses a rename whose target is absent from the current repository", () => {
    const repository = "rename-removed/skills";
    const remote = fromRepository(repository, [
      {
        body: "| Old | New |\n|---|---|\n| username-osint | no-longer-present |",
      },
    ]);
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        previewRegistrySkill({ source: repository + "/username-osint" }),
      );
      expect(error.message).toContain("renamed or removed");
    }).pipe(Effect.provide(FetchHttpClient.layer), remote.provide);
  });

  it.effect("follows an explicit rename chain through multiple releases", () => {
    const repository = "rename-chain/skills";
    const remote = fromRepository(repository, [
      { body: "| Old | New |\n|---|---|\n| middle-name | hunt-a-handle |" },
      { body: "| Old | New |\n|---|---|\n| username-osint | middle-name |" },
    ]);
    return Effect.gen(function* () {
      const preview = yield* previewRegistrySkill({ source: repository + "/username-osint" });
      expect(preview.source).toBe(repository + "/hunt-a-handle");
    }).pipe(Effect.provide(FetchHttpClient.layer), remote.provide);
  });

  it.effect("rejects cyclic rename metadata", () => {
    const repository = "rename-cycle/skills";
    const remote = fromRepository(repository, [
      {
        body: "| Old | New |\n|---|---|\n| username-osint | middle-name |\n| middle-name | username-osint |",
      },
    ]);
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        previewRegistrySkill({ source: repository + "/username-osint" }),
      );
      expect(error.message).toContain("renamed or removed");
    }).pipe(Effect.provide(FetchHttpClient.layer), remote.provide);
  });
});
