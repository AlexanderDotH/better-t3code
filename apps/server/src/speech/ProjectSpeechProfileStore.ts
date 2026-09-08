import {
  ProjectId,
  ProjectSpeechProfile,
  ProjectSpeechProfileError,
  type ProjectSpeechProfile as ProjectSpeechProfileContract,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

const ProjectSpeechProfileDbRow = ProjectSpeechProfile.mapFields(
  Struct.assign({
    keyterms: Schema.fromJsonString(ProjectSpeechProfile.fields.keyterms),
    technologies: Schema.fromJsonString(ProjectSpeechProfile.fields.technologies),
  }),
);

export class ProjectSpeechProfileStore extends Context.Service<
  ProjectSpeechProfileStore,
  {
    readonly get: (
      projectId: ProjectId,
    ) => Effect.Effect<Option.Option<ProjectSpeechProfileContract>, ProjectSpeechProfileError>;
    readonly list: () => Effect.Effect<
      ReadonlyArray<ProjectSpeechProfileContract>,
      ProjectSpeechProfileError
    >;
    readonly upsert: (
      profile: ProjectSpeechProfileContract,
    ) => Effect.Effect<ProjectSpeechProfileContract, ProjectSpeechProfileError>;
  }
>()("t3/speech/ProjectSpeechProfileStore") {}

function storageError(operation: ProjectSpeechProfileError["operation"], projectId?: ProjectId) {
  return (cause: unknown): ProjectSpeechProfileError =>
    new ProjectSpeechProfileError({
      operation,
      ...(projectId === undefined ? {} : { projectId }),
      reason: "The project speech profile storage operation failed.",
      cause,
    });
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getProfileRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ projectId: ProjectId }),
    Result: ProjectSpeechProfileDbRow,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          project_title AS "projectTitle",
          workspace_root AS "workspaceRoot",
          repository_key AS "repositoryKey",
          source,
          context_prompt AS "contextPrompt",
          keyterms_json AS "keyterms",
          technologies_json AS "technologies",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          warning
        FROM project_speech_profiles
        WHERE project_id = ${projectId}
      `,
  });

  const listProfileRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectSpeechProfileDbRow,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          project_title AS "projectTitle",
          workspace_root AS "workspaceRoot",
          repository_key AS "repositoryKey",
          source,
          context_prompt AS "contextPrompt",
          keyterms_json AS "keyterms",
          technologies_json AS "technologies",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          warning
        FROM project_speech_profiles
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const upsertProfileRow = SqlSchema.findOne({
    Request: ProjectSpeechProfile,
    Result: ProjectSpeechProfileDbRow,
    execute: (profile) =>
      sql`
        INSERT INTO project_speech_profiles (
          project_id,
          project_title,
          workspace_root,
          repository_key,
          source,
          context_prompt,
          keyterms_json,
          technologies_json,
          created_at,
          updated_at,
          warning
        )
        VALUES (
          ${profile.projectId},
          ${profile.projectTitle},
          ${profile.workspaceRoot},
          ${profile.repositoryKey},
          ${profile.source},
          ${profile.contextPrompt},
          ${JSON.stringify(profile.keyterms)},
          ${JSON.stringify(profile.technologies)},
          ${profile.createdAt},
          ${profile.updatedAt},
          ${profile.warning}
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          project_title = excluded.project_title,
          workspace_root = excluded.workspace_root,
          repository_key = excluded.repository_key,
          source = excluded.source,
          context_prompt = excluded.context_prompt,
          keyterms_json = excluded.keyterms_json,
          technologies_json = excluded.technologies_json,
          updated_at = excluded.updated_at,
          warning = excluded.warning
        RETURNING
          project_id AS "projectId",
          project_title AS "projectTitle",
          workspace_root AS "workspaceRoot",
          repository_key AS "repositoryKey",
          source,
          context_prompt AS "contextPrompt",
          keyterms_json AS "keyterms",
          technologies_json AS "technologies",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          warning
      `,
  });

  const get: ProjectSpeechProfileStore["Service"]["get"] = Effect.fn(
    "ProjectSpeechProfileStore.get",
  )(function* (projectId) {
    return yield* getProfileRow({ projectId }).pipe(
      Effect.mapError(storageError("get", projectId)),
    );
  });

  const list: ProjectSpeechProfileStore["Service"]["list"] = Effect.fn(
    "ProjectSpeechProfileStore.list",
  )(function* () {
    return yield* listProfileRows().pipe(Effect.mapError(storageError("list")));
  });

  const upsert: ProjectSpeechProfileStore["Service"]["upsert"] = Effect.fn(
    "ProjectSpeechProfileStore.upsert",
  )(function* (profile) {
    const operation = profile.source === "indexed" ? "index" : "create-basic";
    return yield* upsertProfileRow(profile).pipe(
      Effect.mapError(storageError(operation, profile.projectId)),
    );
  });

  return ProjectSpeechProfileStore.of({ get, list, upsert });
});

export const layer = Layer.effect(ProjectSpeechProfileStore, make);
