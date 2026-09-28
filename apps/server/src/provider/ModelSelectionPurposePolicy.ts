import {
  type ModelSelection,
  type ModelSelectionPurpose,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { supportsModelSelectionPurpose } from "@t3tools/shared/model";

export const modelSupportsSelectionPurpose = (
  model: ServerProviderModel,
  purpose: ModelSelectionPurpose,
): boolean => supportsModelSelectionPurpose(model, purpose);

function findSelectedModel(
  provider: ServerProvider,
  modelSlug: string,
): ServerProviderModel | undefined {
  return provider.models.find(
    (model) => model.slug === modelSlug || model.aliases?.includes(modelSlug) === true,
  );
}

export function modelSelectionPurposeViolation(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly selection: ModelSelection;
  readonly purpose: ModelSelectionPurpose;
}): string | undefined {
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.selection.instanceId,
  );
  // Catalog gaps remain provider-owned for custom and newly released models.
  // This guard only rejects selections the server positively knows are incompatible.
  if (!provider) return undefined;

  const model = findSelectedModel(provider, input.selection.model);
  if (!model || modelSupportsSelectionPurpose(model, input.purpose)) return undefined;

  return `Model '${input.selection.model}' from provider instance '${input.selection.instanceId}' does not support the '${input.purpose}' selection purpose.`;
}
