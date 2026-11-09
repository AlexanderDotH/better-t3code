import type { ModelSelection } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  getClaudeCatalogModelCapabilities,
  isClaudeCatalogUltracodeEffort,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  type ClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";
import type { ClaudeGatewayModelProfile } from "./provider/Drivers/ClaudeGatewayCatalog.ts";

export interface CompiledClaudeModelSelection {
  readonly apiModelId: string;
  readonly effort: string | undefined;
  readonly promptEffort: string | undefined;
  readonly settings: Readonly<Record<string, boolean>>;
  readonly queryIdentity: string;
}

// A gateway serves Fast Mode as a separate model id; Claude's own fastMode setting never applies.
function compileClaudeGatewaySelection(
  selection: ModelSelection,
  profile: ClaudeGatewayModelProfile,
): CompiledClaudeModelSelection {
  const descriptors = getProviderOptionDescriptors({
    caps: profile.capabilities,
    selections: selection.options,
  });
  const current = (id: string) =>
    getProviderOptionCurrentValue(descriptors.find((descriptor) => descriptor.id === id));
  const selectedEffort = current("effort");
  const effort = typeof selectedEffort === "string" ? selectedEffort : undefined;
  const apiModelId =
    current("fastMode") === true && profile.fastModelId !== undefined
      ? profile.fastModelId
      : profile.baseModelId;
  return {
    apiModelId,
    effort,
    promptEffort: undefined,
    settings: {},
    queryIdentity: JSON.stringify({ apiModelId, effort: effort ?? null, settings: {} }),
  };
}

export function compileClaudeModelSelection(
  selection: ModelSelection,
  catalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
  gatewayProfile?: ClaudeGatewayModelProfile,
): CompiledClaudeModelSelection {
  if (gatewayProfile !== undefined) return compileClaudeGatewaySelection(selection, gatewayProfile);
  const capabilities = getClaudeCatalogModelCapabilities(catalog, selection.model);
  const descriptors = getProviderOptionDescriptors({ caps: capabilities });
  const supportsBoolean = (id: string) =>
    descriptors.some((descriptor) => descriptor.type === "boolean" && descriptor.id === id);
  const rawEffort = getModelSelectionStringOptionValue(selection, "effort");
  const resolvedEffort = resolveClaudeCatalogEffort(catalog, selection.model, rawEffort);
  const effort = normalizeClaudeCatalogEffort(catalog, resolvedEffort, selection.model);
  const fastMode = supportsBoolean("fastMode")
    ? (getModelSelectionBooleanOptionValue(selection, "fastMode") ?? false)
    : undefined;
  const thinking = supportsBoolean("thinking")
    ? getModelSelectionBooleanOptionValue(selection, "thinking")
    : undefined;
  const settings = {
    ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
    ...(typeof fastMode === "boolean" ? { fastMode } : {}),
    ...(isClaudeCatalogUltracodeEffort(resolvedEffort) ? { ultracode: true } : {}),
  };
  const apiModelId = resolveClaudeCatalogApiModelId(catalog, selection);
  const promptEffort = resolvePromptInjectedEffort(capabilities, rawEffort) ?? undefined;
  return {
    apiModelId,
    effort,
    promptEffort,
    settings,
    queryIdentity: JSON.stringify({ apiModelId, effort: effort ?? null, settings }),
  };
}
