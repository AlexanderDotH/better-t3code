import { assert, it } from "@effect/vitest";
import { ProjectId, type ProjectSpeechProfile } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration033 from "../persistence/Migrations/033_ProjectSpeechProfiles.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import * as ProjectSpeechProfileStore from "./ProjectSpeechProfileStore.ts";

const migratedSqlite = Layer.effectDiscard(Migration033).pipe(
  Layer.provideMerge(NodeSqliteClient.layerMemory()),
);

const layer = it.layer(ProjectSpeechProfileStore.layer.pipe(Layer.provideMerge(migratedSqlite)));

function makeProfile(
  projectId: string,
  overrides: Partial<ProjectSpeechProfile> = {},
): ProjectSpeechProfile {
  return {
    projectId: ProjectId.make(projectId),
    projectTitle: `Title ${projectId}`,
    workspaceRoot: `/workspace/${projectId}`,
    repositoryKey: `github.com/acme/${projectId}`,
    source: "basic",
    contextPrompt: `Software-development dictation for ${projectId}.`,
    keyterms: [projectId, "TypeScript"],
    technologies: ["TypeScript"],
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    warning: null,
    ...overrides,
  };
}

layer("ProjectSpeechProfileStore", (it) => {
  it.effect(
    "round-trips profiles, preserves createdAt on update, and lists deterministically",
    () =>
      Effect.gen(function* () {
        const store = yield* ProjectSpeechProfileStore.ProjectSpeechProfileStore;
        const projectB = makeProfile("project-b");
        const projectA = makeProfile("project-a", {
          repositoryKey: null,
          warning: "Basic profile warning.",
        });

        yield* store.upsert(projectB);
        yield* store.upsert(projectA);
        const updatedB = yield* store.upsert({
          ...projectB,
          source: "indexed",
          contextPrompt: "Indexed software-development context.",
          keyterms: ["ProjectSpeechProfiles", "AssemblyAI"],
          technologies: ["Effect", "SQLite"],
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-22T00:00:00.000Z",
        });

        assert.strictEqual(updatedB.createdAt, projectB.createdAt);
        assert.strictEqual(updatedB.updatedAt, "2026-07-22T00:00:00.000Z");
        assert.deepStrictEqual(updatedB.keyterms, ["ProjectSpeechProfiles", "AssemblyAI"]);
        assert.deepStrictEqual(updatedB.technologies, ["Effect", "SQLite"]);

        const persistedB = yield* store.get(projectB.projectId);
        assert.deepStrictEqual(Option.getOrThrow(persistedB), updatedB);

        const profiles = yield* store.list();
        assert.deepStrictEqual(
          profiles.map(({ projectId }) => projectId),
          [ProjectId.make("project-a"), ProjectId.make("project-b")],
        );
        assert.strictEqual(profiles[0]?.repositoryKey, null);
        assert.strictEqual(profiles[0]?.warning, "Basic profile warning.");
      }),
  );

  it.effect("maps SQL failures to ProjectSpeechProfileError", () =>
    Effect.gen(function* () {
      const store = yield* ProjectSpeechProfileStore.ProjectSpeechProfileStore;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TABLE project_speech_profiles`;

      const error = yield* store.get(ProjectId.make("missing-storage")).pipe(Effect.flip);

      assert.strictEqual(error._tag, "ProjectSpeechProfileError");
      assert.strictEqual(error.operation, "get");
      assert.strictEqual(error.projectId, ProjectId.make("missing-storage"));
    }),
  );
});
