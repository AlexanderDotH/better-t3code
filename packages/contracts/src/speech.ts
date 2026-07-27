import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ASSEMBLY_AI_CONTEXT_PROMPT_MAX_CHARS = 1_750;
export const ASSEMBLY_AI_KEYTERM_MAX_CHARS = 50;
export const ASSEMBLY_AI_KEYTERM_MAX_COUNT = 100;
export const PROJECT_TEXT_TRANSFORM_MAX_CHARS = 16_000;

export const ProjectSpeechProfileSource = Schema.Literals(["indexed", "basic"]);
export type ProjectSpeechProfileSource = typeof ProjectSpeechProfileSource.Type;

export const AssemblyAiSpeechContext = Schema.Struct({
  source: ProjectSpeechProfileSource,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(ASSEMBLY_AI_CONTEXT_PROMPT_MAX_CHARS)),
  keyterms: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(ASSEMBLY_AI_KEYTERM_MAX_CHARS)),
  ).check(Schema.isMaxLength(ASSEMBLY_AI_KEYTERM_MAX_COUNT)),
});
export type AssemblyAiSpeechContext = typeof AssemblyAiSpeechContext.Type;

export const ProjectSpeechProfile = Schema.Struct({
  projectId: ProjectId,
  projectTitle: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryKey: Schema.NullOr(TrimmedNonEmptyString),
  source: ProjectSpeechProfileSource,
  contextPrompt: TrimmedNonEmptyString.check(
    Schema.isMaxLength(ASSEMBLY_AI_CONTEXT_PROMPT_MAX_CHARS),
  ),
  keyterms: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(ASSEMBLY_AI_KEYTERM_MAX_CHARS)),
  ).check(Schema.isMaxLength(ASSEMBLY_AI_KEYTERM_MAX_COUNT)),
  technologies: Schema.Array(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  warning: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProjectSpeechProfile = typeof ProjectSpeechProfile.Type;

export const ProjectSpeechProfileInput = Schema.Struct({ projectId: ProjectId });
export type ProjectSpeechProfileInput = typeof ProjectSpeechProfileInput.Type;

export const ProjectSpeechProfileListResult = Schema.Struct({
  profiles: Schema.Array(ProjectSpeechProfile),
});
export type ProjectSpeechProfileListResult = typeof ProjectSpeechProfileListResult.Type;

export class ProjectSpeechProfileError extends Schema.TaggedErrorClass<ProjectSpeechProfileError>()(
  "ProjectSpeechProfileError",
  {
    operation: Schema.Literals(["get", "list", "index", "create-basic", "resolve-project"]),
    projectId: Schema.optional(ProjectId),
    reason: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Project speech profile ${this.operation} failed: ${this.reason}`;
  }
}

const ProjectTextTransformInputFields = {
  projectId: ProjectId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TEXT_TRANSFORM_MAX_CHARS)),
};

export const TranslateTranscriptInput = Schema.Struct(ProjectTextTransformInputFields);
export type TranslateTranscriptInput = typeof TranslateTranscriptInput.Type;

export const ImprovePromptInput = Schema.Struct(ProjectTextTransformInputFields);
export type ImprovePromptInput = typeof ImprovePromptInput.Type;

export const ProjectTextTransformResult = Schema.Struct({
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TEXT_TRANSFORM_MAX_CHARS)),
});
export type ProjectTextTransformResult = typeof ProjectTextTransformResult.Type;

export class ProjectTextTransformError extends Schema.TaggedErrorClass<ProjectTextTransformError>()(
  "ProjectTextTransformError",
  {
    operation: Schema.Literals(["translate-transcript", "improve-prompt"]),
    projectId: ProjectId,
    reason: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Project text transform ${this.operation} failed: ${this.reason}`;
  }
}
