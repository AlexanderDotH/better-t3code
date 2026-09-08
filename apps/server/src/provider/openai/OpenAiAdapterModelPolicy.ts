import type { OpenAiCatalogModel } from "./OpenAiModelCatalog.ts";
import type { OpenAiAdapterSettings } from "./OpenAiAdapterTypes.ts";

export type OpenAiModelResolution =
  | { readonly ok: true; readonly model: string; readonly catalogModel: OpenAiCatalogModel }
  | { readonly ok: false; readonly issue: string };

export function resolveOpenAiModel(
  settings: OpenAiAdapterSettings,
  catalog: ReadonlyArray<OpenAiCatalogModel>,
  requestedModel?: string,
): OpenAiModelResolution {
  if (!settings.enabled) {
    return { ok: false, issue: "OpenAI Responses is disabled in this provider instance." };
  }
  if (catalog.length === 0) {
    return {
      ok: false,
      issue: "The authenticated OpenAI account returned no tested coding models.",
    };
  }
  const model = requestedModel?.trim() || catalog[0]!.id;
  const catalogModel = catalog.find((candidate) => candidate.id === model);
  if (!catalogModel) {
    return {
      ok: false,
      issue: `Model '${model}' is not in the authenticated tested OpenAI catalog.`,
    };
  }
  return { ok: true, model, catalogModel };
}
