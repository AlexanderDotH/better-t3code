import type { ProviderDriverKind, ServerProvider } from "@t3tools/contracts";
import { getProviderClient, providerClients } from "@t3tools/client-runtime/provider-clients";
import { CursorSettings } from "@t3tools/contracts";
import type {
  ProviderSettingsDefinition,
  ProviderSettingsModelOption,
} from "@t3tools/client-runtime/providerSettingsForm";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CURSOR_SETTINGS_DEFINITION: ProviderSettingsDefinition = { settingsSchema: CursorSettings };

export function mobileProviderSettingsDefinition(
  driver: ProviderDriverKind,
): ProviderSettingsDefinition | null {
  if (driver === "cursor") return CURSOR_SETTINGS_DEFINITION;
  return getProviderClient(driver) ?? null;
}

const providerConfigDecoders = new Map<
  ProviderDriverKind,
  (input: unknown) => Option.Option<unknown>
>();
for (const definition of providerClients.definitions) {
  const schema = mobileProviderSettingsDefinition(definition.driverKind)!.settingsSchema;
  providerConfigDecoders.set(
    definition.driverKind,
    Schema.decodeUnknownOption(schema as unknown as Schema.Decoder<unknown>),
  );
}

export function isMobileProviderConfigValid(driver: ProviderDriverKind, config: unknown): boolean {
  const decode = providerConfigDecoders.get(driver);
  return decode === undefined || Option.isSome(decode(config));
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
