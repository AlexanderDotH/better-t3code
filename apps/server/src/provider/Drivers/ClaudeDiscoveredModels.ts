import { ProviderDriverKind, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities, normalizeModelSlug } from "@t3tools/shared/model";

import {
  type ClaudeGatewayCatalog,
  type ClaudeGatewayModelProfile,
  resolveClaudeGatewayDiscoveredModelProfile,
} from "./ClaudeGatewayCatalog.ts";

const CLAUDE_PROVIDER = ProviderDriverKind.make("claudeAgent");
const DEFAULT_DISCOVERED_MODEL_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const OPAQUE_DISCOVERED_MODEL_IDS = new Set(["default"]);

export interface ClaudeDiscoveredModel {
  readonly value: string;
  readonly displayName: string;
  readonly resolvedModel?: string;
  readonly description?: string;
  readonly supportsEffort?: boolean;
  readonly supportedEffortLevels?: ReadonlyArray<string>;
  readonly supportsAdaptiveThinking?: boolean;
  readonly supportsFastMode?: boolean;
  readonly supportsAutoMode?: boolean;
}

function trimModelId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveGatewayProfile(
  catalog: ClaudeGatewayCatalog | undefined,
  discovered: ClaudeDiscoveredModel,
): ClaudeGatewayModelProfile | undefined {
  if (!catalog || OPAQUE_DISCOVERED_MODEL_IDS.has(discovered.value.trim())) return undefined;

  return resolveClaudeGatewayDiscoveredModelProfile(catalog, discovered);
}

export function resolveClaudeDiscoveredModels(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  discoveredModels: ReadonlyArray<ClaudeDiscoveredModel>,
  gatewayCatalog?: ClaudeGatewayCatalog,
): ReadonlyArray<ServerProviderModel> {
  const builtInBySlug = new Map(builtInModels.map((model) => [model.slug, model]));
  const seen = new Set<string>();
  const resolved: ServerProviderModel[] = [];

  for (const discovered of discoveredModels) {
    const rawModelId = trimModelId(discovered.value);
    if (!rawModelId) continue;

    const gatewayProfile = resolveGatewayProfile(gatewayCatalog, discovered);
    const slug = gatewayProfile ? rawModelId : normalizeModelSlug(rawModelId, CLAUDE_PROVIDER);
    if (!slug || seen.has(slug)) continue;

    seen.add(slug);
    const builtIn = builtInBySlug.get(slug);
    resolved.push(
      builtIn ?? {
        slug,
        name: discovered.displayName.trim() || slug,
        isCustom: false,
        capabilities: gatewayProfile?.capabilities ?? DEFAULT_DISCOVERED_MODEL_CAPABILITIES,
      },
    );
  }

  return resolved.length > 0 ? resolved : builtInModels;
}
