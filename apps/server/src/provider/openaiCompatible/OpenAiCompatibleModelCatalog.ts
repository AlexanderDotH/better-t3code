import { TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const optionalString = Schema.optionalKey(Schema.NullOr(Schema.String));
const optionalNumber = Schema.optionalKey(Schema.NullOr(Schema.Number));
const capabilities = Schema.Union([
  Schema.Array(Schema.String),
  Schema.Struct({
    trained_for_tool_use: Schema.optionalKey(Schema.Boolean),
    vision: Schema.optionalKey(Schema.Boolean),
  }),
]);
const modelMetadata = {
  description: optionalString,
  context_length: optionalNumber,
  max_context_length: optionalNumber,
  type: optionalString,
  architecture: Schema.optionalKey(
    Schema.Union([
      Schema.String,
      Schema.Null,
      Schema.Struct({
        input_modalities: Schema.optionalKey(Schema.Array(Schema.String)),
        output_modalities: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
    ]),
  ),
  supported_parameters: Schema.optionalKey(Schema.Array(Schema.String)),
  capabilities: Schema.optionalKey(capabilities),
};
const catalogModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: optionalString,
  ...modelMetadata,
});
const decodeCatalog = Schema.decodeUnknownEffect(
  Schema.Struct({ data: Schema.Array(catalogModel) }),
);
const decodeLmStudioCatalog = Schema.decodeUnknownEffect(
  Schema.Struct({
    models: Schema.Array(
      Schema.Struct({
        ...modelMetadata,
        type: Schema.Literals(["llm", "embedding"]),
        key: TrimmedNonEmptyString,
        display_name: optionalString,
        loaded_instances: Schema.optionalKey(Schema.Array(Schema.Unknown)),
      }),
    ),
  }),
);

export interface OpenAiCompatibleCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindowTokens?: number;
  readonly inputModalities?: ReadonlyArray<string>;
  readonly outputModalities?: ReadonlyArray<string>;
  readonly toolCapabilities: {
    readonly tools?: boolean;
    readonly parallelToolCalls?: boolean;
    readonly toolChoice?: boolean;
  };
  readonly loaded?: boolean;
  readonly incompatibilityReason?: string;
  readonly isCustom: boolean;
  readonly isVerified: boolean;
}

export class OpenAiCompatibleModelCatalogError extends Schema.TaggedError<OpenAiCompatibleModelCatalogError>()(
  "OpenAiCompatibleModelCatalogError",
  { message: Schema.String },
) {}

function normalizeModel(raw: typeof catalogModel.Type): OpenAiCompatibleCatalogModel {
  const id = raw.id;
  const contextWindowTokens = raw.context_length ?? raw.max_context_length;
  const architecture = typeof raw.architecture === "object" ? raw.architecture : undefined;
  const parameters = raw.supported_parameters;
  const advertised = raw.capabilities;
  const tools =
    parameters !== undefined
      ? parameters.includes("tools")
      : Array.isArray(advertised)
        ? advertised.includes("tool_use") || advertised.includes("tools")
        : advertised !== undefined && "trained_for_tool_use" in advertised
          ? advertised.trained_for_tool_use
          : undefined;
  const inputModalities = architecture?.input_modalities;
  const outputModalities =
    architecture?.output_modalities ??
    (raw.type === "embedding" || raw.type === "embeddings" ? ["embedding"] : undefined);
  const incompatibilityReason =
    inputModalities !== undefined && !inputModalities.includes("text")
      ? "This model does not accept text input required by T3 Code."
      : outputModalities !== undefined && !outputModalities.includes("text")
        ? "This model does not produce text responses required by T3 Code."
        : tools === false
          ? "This model does not support the tool calling required by T3 Code."
          : undefined;
  return {
    id,
    name: raw.name?.trim() || id,
    ...(raw.description?.trim() ? { description: raw.description.trim() } : {}),
    ...(contextWindowTokens != null &&
    Number.isSafeInteger(contextWindowTokens) &&
    contextWindowTokens > 0
      ? { contextWindowTokens }
      : {}),
    ...(inputModalities === undefined ? {} : { inputModalities }),
    ...(outputModalities === undefined ? {} : { outputModalities }),
    toolCapabilities: {
      ...(tools === undefined ? {} : { tools }),
      ...(parameters === undefined
        ? {}
        : {
            parallelToolCalls: parameters.includes("parallel_tool_calls"),
            toolChoice: parameters.includes("tool_choice"),
          }),
    },
    ...(incompatibilityReason === undefined ? {} : { incompatibilityReason }),
    isCustom: false,
    isVerified: true,
  };
}

function uniqueModels(models: ReadonlyArray<OpenAiCompatibleCatalogModel>) {
  const unique = new Map<string, OpenAiCompatibleCatalogModel>();
  for (const model of models) {
    if (model.id && !unique.has(model.id)) unique.set(model.id, model);
  }
  return Array.from(unique.values());
}

export const decodeOpenAiCompatibleModelCatalog = Effect.fn("decodeOpenAiCompatibleModelCatalog")(
  function* (input: unknown) {
    const catalog = yield* decodeCatalog(input).pipe(
      Effect.mapError(
        () =>
          new OpenAiCompatibleModelCatalogError({
            message: "The endpoint model catalog schema is invalid.",
          }),
      ),
    );
    return uniqueModels(catalog.data.map(normalizeModel));
  },
);

export const decodeLmStudioModelCatalog = Effect.fn("decodeLmStudioModelCatalog")(function* (
  input: unknown,
) {
  const catalog = yield* decodeLmStudioCatalog(input).pipe(
    Effect.mapError(
      () =>
        new OpenAiCompatibleModelCatalogError({
          message: "The LM Studio model catalog schema is invalid.",
        }),
    ),
  );
  return uniqueModels(
    catalog.models.map((model) => ({
      ...normalizeModel({ ...model, id: model.key, name: model.display_name ?? model.key }),
      ...(model.loaded_instances === undefined
        ? {}
        : { loaded: model.loaded_instances.length > 0 }),
    })),
  );
});

export const mergeOpenAiCompatibleCustomModels = (
  catalog: ReadonlyArray<OpenAiCompatibleCatalogModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<OpenAiCompatibleCatalogModel> =>
  uniqueModels([
    ...catalog,
    ...customModels.map((raw) => {
      const id = raw.trim();
      return { id, name: id, toolCapabilities: {}, isCustom: true, isVerified: false };
    }),
  ]);
