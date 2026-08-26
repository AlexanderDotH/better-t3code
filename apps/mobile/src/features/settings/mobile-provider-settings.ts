import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { OpenRouterSettings } from "@t3tools/contracts";
import type {
  ProviderSettingsDefinition,
  ProviderSettingsModelOption,
} from "@t3tools/client-runtime/providerSettingsForm";

const OPENROUTER_SETTINGS_DEFINITION: ProviderSettingsDefinition = {
  settingsSchema: OpenRouterSettings,
};

export function mobileProviderSettingsDefinition(
  driver: ProviderDriverKind,
): ProviderSettingsDefinition | null {
  return driver === "openrouter" ? OPENROUTER_SETTINGS_DEFINITION : null;
}

export function mobileProviderCatalogModels(
  provider: Pick<ServerProvider, "models">,
): ReadonlyArray<ProviderSettingsModelOption> | undefined {
  if (provider.models.length === 0) return undefined;
  return provider.models.map((model) => ({
    slug: model.slug,
    name: model.name,
    ...(model.isSelectable === undefined ? {} : { isSelectable: model.isSelectable }),
  }));
}

export type MobileNumberDraftResult =
  | { readonly valid: true; readonly value: number | undefined }
  | { readonly valid: false };

export function parseMobileNumberDraft(
  draft: string,
  constraints: { readonly min?: number | undefined; readonly max?: number | undefined },
): MobileNumberDraftResult {
  const normalized = draft.trim();
  if (normalized.length === 0) return { valid: true, value: undefined };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { valid: false };
  if (constraints.min !== undefined && value < constraints.min) return { valid: false };
  if (constraints.max !== undefined && value > constraints.max) return { valid: false };
  return { valid: true, value };
}
