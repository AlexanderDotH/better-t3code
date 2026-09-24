import * as Schema from "effect/Schema";

export class ProjectIndexRuntimeError extends Schema.TaggedError<ProjectIndexRuntimeError>()(
  "ProjectIndexRuntimeError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

export function asProjectIndexRuntimeError(cause: unknown): ProjectIndexRuntimeError {
  return new ProjectIndexRuntimeError({
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export const encodeProjectIndexJson = Schema.encodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown),
);
