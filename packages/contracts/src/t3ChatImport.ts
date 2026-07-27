import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const T3ChatImportSourceId = TrimmedNonEmptyString;
export type T3ChatImportSourceId = typeof T3ChatImportSourceId.Type;

export const T3ChatImportSource = Schema.Struct({
  id: T3ChatImportSourceId,
  label: TrimmedNonEmptyString,
  databasePath: TrimmedNonEmptyString,
  threadCount: NonNegativeInt,
  latestUpdatedAt: Schema.NullOr(IsoDateTime),
});
export type T3ChatImportSource = typeof T3ChatImportSource.Type;

export const T3ChatImportDiscoverInput = Schema.Struct({});
export type T3ChatImportDiscoverInput = typeof T3ChatImportDiscoverInput.Type;

export const T3ChatImportDiscoverResult = Schema.Struct({
  sources: Schema.Array(T3ChatImportSource),
});
export type T3ChatImportDiscoverResult = typeof T3ChatImportDiscoverResult.Type;

export const T3ChatImportRunInput = Schema.Struct({
  sourceId: T3ChatImportSourceId,
});
export type T3ChatImportRunInput = typeof T3ChatImportRunInput.Type;

export const T3ChatImportRunResult = Schema.Struct({
  projectsImported: NonNegativeInt,
  threadsImported: NonNegativeInt,
  messagesImported: NonNegativeInt,
  attachmentsCopied: NonNegativeInt,
  attachmentsSkipped: NonNegativeInt,
});
export type T3ChatImportRunResult = typeof T3ChatImportRunResult.Type;

export class T3ChatImportError extends Schema.TaggedErrorClass<T3ChatImportError>()(
  "T3ChatImportError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
