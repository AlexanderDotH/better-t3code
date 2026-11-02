import type { ModelCapabilities, ServerProviderModel } from "@t3tools/contracts";
import { createCodexContextWindowDescriptor } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const decodeCatalog = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      models: Schema.Array(Schema.Unknown),
    }),
  ),
);
const ContextTokens = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const decodeModel = Schema.decodeUnknownOption(
  Schema.Struct({
    slug: Schema.NonEmptyString,
    context_window: ContextTokens,
    max_context_window: ContextTokens,
    effective_context_window_percent: Schema.optionalKey(Schema.Unknown),
  }),
);
const decodeEffectivePercent = Schema.decodeUnknownOption(
  Schema.Number.check(
    Schema.isFinite(),
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100),
  ),
);

export function codexModelContextWindows(
  text: string,
): ReadonlyMap<string, NonNullable<ModelCapabilities["contextWindow"]>> {
  const catalog = Option.getOrUndefined(decodeCatalog(text));
  const result = new Map<string, NonNullable<ModelCapabilities["contextWindow"]>>();
  for (const value of catalog?.models ?? []) {
    const model = Option.getOrUndefined(decodeModel(value));
    if (!model || model.max_context_window < model.context_window) continue;
    const effectivePercent = Option.getOrUndefined(
      decodeEffectivePercent(model.effective_context_window_percent),
    );
    result.set(model.slug, {
      defaultTokens: model.context_window,
      maxTokens: model.max_context_window,
      ...(effectivePercent === undefined ? {} : { effectivePercent }),
    });
  }
  return result;
}

export const enrichCodexModelsWithContextWindow = Effect.fn("enrichCodexModelsWithContextWindow")(
  function* (models: ReadonlyArray<ServerProviderModel>, codexHome: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = Option.getOrUndefined(
      yield* fileSystem
        .readFileString(path.join(codexHome, "models_cache.json"))
        .pipe(Effect.option),
    );
    if (text === undefined) return models;
    const metadata = codexModelContextWindows(text);
    return models.map((model) => {
      const contextWindow = metadata.get(model.slug);
      if (contextWindow === undefined) return model;
      return {
        ...model,
        capabilities: {
          ...model.capabilities,
          contextWindow,
          optionDescriptors: [
            ...(model.capabilities?.optionDescriptors ?? []).filter(
              (descriptor) => descriptor.id !== "contextWindow",
            ),
            createCodexContextWindowDescriptor(contextWindow),
          ],
        },
      };
    });
  },
);
