import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { FetchHttpClient } from "effect/unstable/http";
import { previewRegistrySkill, validateRegistrySkillFiles } from "../extensionCatalog.ts";
import { skillArchive } from "../testUtils/skillArchive.ts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { SkillEngine } from "../Services/SkillEngine.ts";
import { SkillEngineLive } from "./SkillEngine.ts";

const makeSkillEngineLayer = () =>
  SkillEngineLive.pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-skills-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("SkillEngineLive", (it) => {
  it.effect("installs an author's renamed skill under its current name in isolated state", () => {
    const repository = "renamed-install/skills";
    const archive = skillArchive([
      {
        path: "skills/hunt-a-handle/SKILL.md",
        contents:
          "---\nname: hunt-a-handle\ndescription: Follow usernames\n---\nRead reference/checks.md",
      },
      { path: "skills/hunt-a-handle/reference/checks.md", contents: "Confirm identity." },
    ]);
    return Effect.gen(function* () {
      const engine = yield* SkillEngine;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const preview = yield* previewRegistrySkill({
        source: repository + "/username-osint",
      }).pipe(Effect.provide(FetchHttpClient.layer));
      assert.equal(preview.source, repository + "/hunt-a-handle");
      const result = yield* engine.installRegistry({
        source: preview.source,
        contentHash: preview.contentHash,
        scope: "global",
      });
      assert.equal(result.skill.name, "hunt-a-handle");
      assert.equal(
        yield* fs.readFileString(path.join(path.dirname(result.skill.path), "reference/checks.md")),
        "Confirm identity.",
      );
      const duplicate = yield* engine
        .installRegistry({
          source: repository + "/username-osint",
          contentHash: preview.contentHash,
          scope: "global",
        })
        .pipe(Effect.flip);
      assert.include(duplicate.message, "already exists");
      yield* engine.delete({ target: { scope: "global", name: result.skill.name } });
    }).pipe(
      Effect.provide(makeSkillEngineLayer()),
      Effect.provideService(
        FetchHttpClient.Fetch,
        Object.assign(
          async (request: Parameters<typeof fetch>[0]) => {
            const url = new URL(String(request));
            if (url.host === "api.github.com")
              return Response.json([
                {
                  body: "| Old | New |\n|---|---|\n| username-osint | hunt-a-handle |",
                },
              ]);
            assert.equal(url.href, "https://codeload.github.com/" + repository + "/zip/HEAD");
            return new Response(new Uint8Array(archive));
          },
          { preconnect: () => {} },
        ),
      ),
    );
  });

  it.effect(
    "installs complete registry skills, rejects replacements, and removes supporting files",
    () => {
      const files = [
        {
          path: "SKILL.md",
          contents:
            "---\nname: registry-review\ndescription: Review changes\n---\nRead references/checks.md",
        },
        { path: "references/checks.md", contents: "Check edge cases." },
        { path: "assets/icon.png", contents: "iVBOR/8A", encoding: "base64" as const },
        { path: "scripts/check.sh", contents: "#!/bin/sh\necho checked\n", executable: true },
      ];
      return Effect.gen(function* () {
        const engine = yield* SkillEngine;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const input = {
          source: "example/skills/registry-review",
          contentHash: validateRegistrySkillFiles(files).contentHash,
          scope: "global" as const,
        };
        const changed = yield* engine
          .installRegistry({ ...input, contentHash: "0".repeat(64) })
          .pipe(Effect.flip);
        assert.include(changed.message, "changed after the preview");
        const result = yield* engine.installRegistry(input);
        const directory = path.dirname(result.skill.path);
        assert.equal(
          yield* fs.readFileString(path.join(directory, "references/checks.md")),
          "Check edge cases.",
        );
        assert.equal(yield* fs.readFileString(result.skill.path), files[0]!.contents);
        assert.deepEqual(
          [...(yield* fs.readFile(path.join(directory, "assets/icon.png")))],
          [137, 80, 78, 71, 255, 0],
        );
        assert.equal(
          (yield* fs.stat(path.join(directory, "scripts/check.sh"))).mode & 0o111,
          0o111,
        );
        const prompt = yield* engine.rewritePromptForProvider({
          providerInstanceId: "codex",
          prompt: "/registry-review changes",
        });
        assert.include(prompt, result.skill.path);
        assert.include(prompt, "references/checks.md");
        const duplicate = yield* engine.installRegistry(input).pipe(Effect.flip);
        assert.include(duplicate.message, "already exists");
        assert.equal(yield* fs.readFileString(result.skill.path), files[0]!.contents);
        yield* engine.delete({ target: { scope: "global", name: result.skill.name } });
        assert.isFalse(yield* fs.exists(directory));
      }).pipe(
        Effect.provide(makeSkillEngineLayer()),
        Effect.provideService(
          FetchHttpClient.Fetch,
          Object.assign(
            async () =>
              new Response(
                new Uint8Array(
                  skillArchive(
                    files.map((file) => ({
                      path: "skills/registry-review/" + file.path,
                      contents: file.encoding
                        ? Buffer.from(file.contents, file.encoding)
                        : file.contents,
                      mode: file.executable ? 0o100755 : 0o100644,
                    })),
                  ),
                ),
              ),
            { preconnect: () => {} },
          ),
        ),
      );
    },
  );
  it.effect("creates, lists, enables, disables, and expands T3-owned skills", () =>
    Effect.gen(function* () {
      const skillEngine = yield* SkillEngine;

      const created = yield* skillEngine.create({
        scope: "global",
        name: "review",
        description: "Review changed code.",
        body: "# Guidance\n\nReview code carefully.",
        enabled: false,
      });

      assert.equal(created.skill.enabled, false);
      assert.equal(created.skill.providerInstanceId, undefined);

      const disabledRewrite = yield* skillEngine.rewritePromptForProvider({
        providerInstanceId: "claudeAgent",
        prompt: "/review this diff",
      });
      assert.equal(disabledRewrite, "/review this diff");

      const enabled = yield* skillEngine.setEnabled({
        target: {
          scope: "global",
          path: created.skill.path,
        },
        enabled: true,
      });
      assert.equal(enabled.skill.enabled, true);

      const listed = yield* skillEngine.list({ includeBody: true });
      assert.deepEqual(
        listed.skills.map((skill) => ({
          name: skill.name,
          enabled: skill.enabled,
          body: skill.body,
        })),
        [
          {
            name: "review",
            enabled: true,
            body: "# Guidance\n\nReview code carefully.",
          },
        ],
      );

      const rewritten = yield* skillEngine.rewritePromptForProvider({
        providerInstanceId: "opencode",
        prompt: "/review this diff",
      });
      assert.include(rewritten, '<t3-skill name="review">');
      assert.include(rewritten, "Review code carefully.");
      assert.notMatch(rewritten, /(^|\s)\/review(?=\s|$)/);
    }).pipe(Effect.provide(makeSkillEngineLayer())),
  );

  it.effect("lists project skills for the matching project cwd", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const skillEngine = yield* SkillEngine;
      const projectCwd = yield* fs.makeTempDirectoryScoped({
        prefix: "t3code-skill-project-",
      });

      yield* skillEngine.create({
        scope: "global",
        name: "global-review",
        description: "Review any code.",
        body: "# Guidance\n\nReview all code.",
      });
      yield* skillEngine.create({
        scope: "project",
        name: "project-review",
        description: "Review this project.",
        body: "# Guidance\n\nReview project conventions.",
        projectId: ProjectId.make("project_1"),
        projectCwd,
      });

      const listed = yield* skillEngine.list({
        projectId: ProjectId.make("project_1"),
        projectCwd,
      });

      assert.deepEqual(
        listed.skills.map((skill) => ({
          name: skill.name,
          scope: skill.scope,
          path: path.relative(projectCwd, skill.path),
        })),
        [
          {
            name: "project-review",
            scope: "project",
            path: ".t3code/skills/project-review/SKILL.md",
          },
          {
            name: "global-review",
            scope: "global",
            path: path.relative(projectCwd, listed.skills[1]!.path),
          },
        ],
      );
    }).pipe(Effect.provide(makeSkillEngineLayer())),
  );

  it.effect("expands the project skill when a global skill has the same name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const skillEngine = yield* SkillEngine;
      const projectCwd = yield* fs.makeTempDirectoryScoped({
        prefix: "t3code-skill-precedence-",
      });

      yield* skillEngine.create({
        scope: "global",
        name: "review",
        description: "Global review.",
        body: "Use the global review instructions.",
      });
      yield* skillEngine.create({
        scope: "project",
        name: "review",
        description: "Project review.",
        body: "Use the project-specific review instructions.",
        projectId: ProjectId.make("project_1"),
        projectCwd,
      });

      const rewritten = yield* skillEngine.rewritePromptForProvider({
        providerInstanceId: "claudeAgent",
        projectCwd,
        prompt: "/review this diff",
      });

      assert.include(rewritten, "Use the project-specific review instructions.");
      assert.notInclude(rewritten, "Use the global review instructions.");
    }).pipe(Effect.provide(makeSkillEngineLayer())),
  );

  it.effect(
    "updates, renames, disables, and deletes project skills while rejecting system edits",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const skillEngine = yield* SkillEngine;
        const projectCwd = yield* fs.makeTempDirectoryScoped({
          prefix: "t3code-skill-lifecycle-",
        });
        const projectId = ProjectId.make("project_lifecycle");

        const created = yield* skillEngine.create({
          scope: "project",
          name: "draft",
          description: "Initial description.",
          body: "Initial body.",
          projectId,
          projectCwd,
        });
        const updated = yield* skillEngine.update({
          target: {
            scope: "project",
            path: created.skill.path,
            projectId,
            projectCwd,
          },
          description: "Updated description.",
          body: "Updated body.",
        });
        assert.equal(updated.skill.description, "Updated description.");
        assert.equal(updated.skill.body, "Updated body.");

        const disabled = yield* skillEngine.setEnabled({
          target: {
            scope: "project",
            path: updated.skill.path,
            projectId,
            projectCwd,
          },
          enabled: false,
        });
        const renamed = yield* skillEngine.rename({
          target: {
            scope: "project",
            path: disabled.skill.path,
            projectId,
            projectCwd,
          },
          newName: "final",
        });
        assert.equal(renamed.skill.name, "final");
        assert.equal(renamed.skill.enabled, false);

        const afterDelete = yield* skillEngine.delete({
          target: {
            scope: "project",
            path: renamed.skill.path,
            projectId,
            projectCwd,
          },
        });
        assert.deepEqual(afterDelete.skills, []);

        const systemError = yield* skillEngine
          .update({
            target: {
              scope: "system",
              path: "/external/skills/system/SKILL.md",
            },
            body: "This must not be written.",
          })
          .pipe(Effect.flip);
        assert.include(systemError.message, "read-only");
      }).pipe(Effect.provide(makeSkillEngineLayer())),
  );
});
