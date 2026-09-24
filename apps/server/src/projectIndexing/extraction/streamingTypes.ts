import type {
  ProjectCallsiteV1,
  ProjectEntityV1,
  ProjectIndexGapV1,
  ProjectSourceFileV1,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const SEMANTIC_BATCH_SIZE = 128;

export interface SemanticPage<Value> {
  readonly items: readonly Value[];
  readonly nextCursor: string | null;
}

export interface SemanticLocation {
  readonly filePath: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface SemanticDeclaration extends SemanticLocation {
  readonly name?: string;
}

export interface SemanticReader {
  files(
    languages: readonly string[],
    afterPath: string | undefined,
    limit: number,
  ): Promise<SemanticPage<ProjectSourceFileV1>>;
  callsites(
    filePath: string,
    afterId: string | undefined,
    limit: number,
  ): Promise<SemanticPage<ProjectCallsiteV1>>;
  file(filePath: string): Promise<ProjectSourceFileV1 | undefined>;
  callsitesAt(locations: readonly SemanticLocation[]): Promise<readonly ProjectCallsiteV1[]>;
  target(location: SemanticDeclaration): Promise<ProjectEntityV1 | undefined>;
}

export interface SemanticBatch {
  readonly callsites: readonly ProjectCallsiteV1[];
  readonly gaps: readonly ProjectIndexGapV1[];
}

export interface StreamingSemanticInput {
  readonly root: string;
  readonly reader: SemanticReader;
  readonly signal?: AbortSignal;
  readonly typescriptMode?: "native" | "compatible";
  readonly helperPaths?: { readonly dotnet?: string; readonly java?: string };
}

const Declaration = Schema.Struct({
  filePath: Schema.String,
  startOffset: Schema.Int,
  endOffset: Schema.Int,
  name: Schema.optionalKey(Schema.String),
});
export const CompilerCall = Schema.Struct({
  filePath: Schema.String,
  startOffset: Schema.Int,
  endOffset: Schema.Int,
  targets: Schema.Array(Declaration),
  exact: Schema.Boolean,
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type CompilerCall = typeof CompilerCall.Type;
export const CompilerGap = Schema.Struct({
  message: Schema.String,
  filePath: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type CompilerGap = typeof CompilerGap.Type;
export const CompilerMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["call"]), call: CompilerCall }),
  Schema.Struct({ type: Schema.Literals(["gap"]), gap: CompilerGap }),
]);
export type CompilerMessage = typeof CompilerMessage.Type;

export async function* semanticFiles(input: StreamingSemanticInput, languages: readonly string[]) {
  let cursor: string | undefined;
  while (true) {
    input.signal?.throwIfAborted();
    const page = await input.reader.files(languages, cursor, SEMANTIC_BATCH_SIZE);
    if (page.items.length > SEMANTIC_BATCH_SIZE)
      throw new Error("Semantic source reader exceeded its page budget.");
    for (const file of page.items)
      if (
        languages.includes(file.language) &&
        !["skipped", "deleted", "failed"].includes(file.status)
      )
        yield file;
    if (page.nextCursor === null) break;
    if (page.nextCursor === cursor)
      throw new Error("Semantic source reader did not advance its cursor.");
    cursor = page.nextCursor;
  }
}
