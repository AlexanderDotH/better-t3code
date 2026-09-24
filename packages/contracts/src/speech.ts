import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

import {
  IsoDateTime,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

const ASSEMBLY_AI_CONTEXT_PROMPT_MAX_CHARS = 1_750;
const ASSEMBLY_AI_KEYTERM_MAX_CHARS = 50;
const ASSEMBLY_AI_KEYTERM_MAX_COUNT = 100;
const PROJECT_TEXT_TRANSFORM_MAX_CHARS = 16_000;

export const AssemblyAiSpeechModel = Schema.Literals([
  "universal-3-5-pro",
  "universal-streaming-multilingual",
  "universal-streaming-english",
]);
export type AssemblyAiSpeechModel = typeof AssemblyAiSpeechModel.Type;

export const ASSEMBLY_AI_LANGUAGE_CODES: readonly string[] = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "tr",
  "nl",
  "sv",
  "no",
  "da",
  "fi",
  "hi",
  "vi",
  "ar",
  "he",
  "ja",
  "zh",
];
const supportedLanguageCodes = new Set(ASSEMBLY_AI_LANGUAGE_CODES);

export const AssemblyAiVoiceSettings = Schema.Struct({
  speechModel: AssemblyAiSpeechModel.pipe(
    Schema.withDecodingDefault(Effect.succeed("universal-3-5-pro" as const)),
  ),
  languageCodes: Schema.Array(
    TrimmedNonEmptyString.check(
      Schema.makeFilter(
        (code) => supportedLanguageCodes.has(code) || "Unsupported AssemblyAI language code.",
      ),
    ),
  )
    .check(Schema.isMaxLength(20))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  streamingMode: Schema.Literals(["balanced", "max_accuracy", "min_latency"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("balanced" as const)),
  ),
  minTurnSilence: Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: 10_000 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(400)),
  ),
  maxTurnSilence: Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: 10_000 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(1_536)),
  ),
  vadThreshold: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(0.2)),
  ),
  includePartialTurns: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  interruptionDelay: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  continuousPartials: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  projectVocabulary: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  customKeyterms: Schema.Array(
    TrimmedNonEmptyString.check(Schema.isMaxLength(ASSEMBLY_AI_KEYTERM_MAX_CHARS)),
  )
    .check(Schema.isMaxLength(ASSEMBLY_AI_KEYTERM_MAX_COUNT))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  contextPrompt: Schema.String.check(Schema.isMaxLength(ASSEMBLY_AI_CONTEXT_PROMPT_MAX_CHARS)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  voiceFocus: Schema.Literals(["near-field", "far-field"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("near-field" as const)),
  ),
  cleanupMode: Schema.Literals(["off", "conservative", "compact", "custom"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("conservative" as const)),
  ),
  cleanupInstructions: Schema.String.check(Schema.isMaxLength(4_000)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  cleanupModel: TrimmedNonEmptyString.check(Schema.isMaxLength(200)).pipe(
    Schema.withDecodingDefault(Effect.succeed("claude-haiku-4-5-20251001")),
  ),
  cleanupModelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  automaticFileReferences: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
}).check(
  Schema.makeFilter(
    (settings) =>
      settings.minTurnSilence <= settings.maxTurnSilence ||
      "Minimum turn silence must not exceed maximum turn silence.",
  ),
);
export type AssemblyAiVoiceSettings = typeof AssemblyAiVoiceSettings.Type;
export const DEFAULT_ASSEMBLY_AI_VOICE_SETTINGS: AssemblyAiVoiceSettings = Schema.decodeSync(
  AssemblyAiVoiceSettings,
)({});

export function resolveAssemblyAiVoiceSettings(
  settings: {
    readonly voice: AssemblyAiVoiceSettings;
    readonly projectOverrides: Readonly<Record<string, AssemblyAiVoiceSettings>>;
  },
  projectId: string,
): AssemblyAiVoiceSettings {
  return settings.projectOverrides[projectId] ?? settings.voice;
}

export const SpeechVocabularyKind = Schema.Literals([
  "file",
  "class",
  "function",
  "type",
  "variable",
  "library",
]);
export const SpeechVocabularyEntry = Schema.Struct({
  kind: SpeechVocabularyKind,
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  line: Schema.optionalKey(PositiveInt),
});
export type SpeechVocabularyEntry = typeof SpeechVocabularyEntry.Type;

export const VoiceFileCandidate = Schema.Struct({
  path: TrimmedNonEmptyString,
  symbols: Schema.Array(
    Schema.Struct({
      name: TrimmedNonEmptyString,
      kind: SpeechVocabularyKind,
      line: Schema.optionalKey(PositiveInt),
    }),
  ),
});
export const VoiceFileReference = Schema.Struct({
  label: TrimmedNonEmptyString,
  previewPath: TrimmedNonEmptyString,
  candidates: Schema.Array(VoiceFileCandidate),
  truncated: Schema.Boolean,
});
export type VoiceFileReference = typeof VoiceFileReference.Type;

export const SpeechStreamingStartInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
});
export type SpeechStreamingStartInput = typeof SpeechStreamingStartInput.Type;
export const SpeechProcessDictationInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
  transcript: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_TEXT_TRANSFORM_MAX_CHARS)),
});
export type SpeechProcessDictationInput = typeof SpeechProcessDictationInput.Type;
export const SpeechProcessDictationResult = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(64_000)),
  references: Schema.Array(VoiceFileReference),
  warning: Schema.optionalKey(TrimmedNonEmptyString),
});
export type SpeechProcessDictationResult = typeof SpeechProcessDictationResult.Type;
export const AssemblyAiCleanupModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type AssemblyAiCleanupModel = typeof AssemblyAiCleanupModel.Type;
export const AssemblyAiModelsResult = Schema.Struct({
  models: Schema.Array(AssemblyAiCleanupModel),
});
export type AssemblyAiModelsResult = typeof AssemblyAiModelsResult.Type;
export class SpeechDictationError extends Schema.TaggedError<SpeechDictationError>()(
  "SpeechDictationError",
  { reason: TrimmedNonEmptyString },
) {
  override get message(): string {
    return this.reason;
  }
}

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

export class ProjectSpeechProfileError extends Schema.TaggedError<ProjectSpeechProfileError>()(
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

export class ProjectTextTransformError extends Schema.TaggedError<ProjectTextTransformError>()(
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
