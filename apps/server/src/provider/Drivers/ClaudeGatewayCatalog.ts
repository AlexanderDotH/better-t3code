import type { ModelCapabilities, ProviderOptionChoice } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

export type ClaudeGatewayEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeGatewayModelProfile {
  readonly canonicalModelId: string;
  readonly baseModelId: string;
  readonly fastModelId?: string;
  readonly aliases: ReadonlyArray<string>;
  readonly defaultEffort: ClaudeGatewayEffort;
  readonly capabilities: ModelCapabilities;
}

export interface ClaudeGatewayCatalog {
  readonly profiles: ReadonlyArray<ClaudeGatewayModelProfile>;
}

export interface ClaudeGatewayDiscoveredModelIdentity {
  readonly value?: string | null;
  readonly resolvedModel?: string | null;
  readonly displayName?: string | null;
}

export interface ClaudeGatewayCatalogLoadOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly homePath: string;
  readonly timeoutMs?: number;
}

type UnknownRecord = Record<string, unknown>;

interface GatewayConnection {
  readonly baseUrl: string;
  readonly authToken?: string;
  readonly apiKey?: string;
}

interface RichReasoningLevel {
  readonly effort: ClaudeGatewayEffort;
  readonly description?: string;
}

interface RichModel {
  readonly slug: string;
  readonly defaultEffort: ClaudeGatewayEffort;
  readonly reasoningLevels: ReadonlyArray<RichReasoningLevel>;
  readonly supportsFast: boolean;
}

const EMPTY_CATALOG: ClaudeGatewayCatalog = { profiles: [] };
const DEFAULT_TIMEOUT_MS = 3_000;
const EFFORT_LABELS: Readonly<Record<ClaudeGatewayEffort, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isClaudeGatewayEffort(value: unknown): value is ClaudeGatewayEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function parseSettingsEnvironment(raw: string): Readonly<Record<string, string | undefined>> {
  try {
    const settings = JSON.parse(raw) as unknown;
    if (!isRecord(settings) || !isRecord(settings.env)) return {};
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings.env)) {
      const parsed = nonEmptyString(value);
      if (parsed) environment[key] = parsed;
    }
    return environment;
  } catch {
    return {};
  }
}

function environmentValue(
  instanceEnvironment: Readonly<Record<string, string | undefined>>,
  settingsEnvironment: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return nonEmptyString(instanceEnvironment[name]) ?? nonEmptyString(settingsEnvironment[name]);
}

function resolveGatewayConnection(
  instanceEnvironment: Readonly<Record<string, string | undefined>>,
  settingsEnvironment: Readonly<Record<string, string | undefined>>,
): GatewayConnection | undefined {
  const baseUrl = environmentValue(instanceEnvironment, settingsEnvironment, "ANTHROPIC_BASE_URL");
  if (!baseUrl) return undefined;
  const authToken = environmentValue(
    instanceEnvironment,
    settingsEnvironment,
    "ANTHROPIC_AUTH_TOKEN",
  );
  const apiKey = environmentValue(instanceEnvironment, settingsEnvironment, "ANTHROPIC_API_KEY");
  return {
    baseUrl,
    ...(authToken ? { authToken } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function modelCatalogUrl(baseUrl: string, rich: boolean): string | undefined {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "");
    url.pathname = path.endsWith("/v1") ? `${path}/models` : `${path}/v1/models`;
    url.search = "";
    url.hash = "";
    if (rich) url.searchParams.set("client_version", "0.0.1");
    return url.toString();
  } catch {
    return undefined;
  }
}

function standardModelIds(payload: unknown): ReadonlySet<string> {
  if (!isRecord(payload)) return new Set();
  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = nonEmptyString(row.id) ?? nonEmptyString(row.slug);
    if (id) ids.add(id);
  }
  return ids;
}

function parseReasoningLevels(value: unknown): ReadonlyArray<RichReasoningLevel> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<ClaudeGatewayEffort>();
  const levels: Array<RichReasoningLevel> = [];
  for (const item of value) {
    if (!isRecord(item) || !isClaudeGatewayEffort(item.effort) || seen.has(item.effort)) {
      continue;
    }
    seen.add(item.effort);
    const description = nonEmptyString(item.description);
    levels.push({ effort: item.effort, ...(description ? { description } : {}) });
  }
  return levels;
}

function supportsFastTier(row: UnknownRecord): boolean {
  const serviceTiers = Array.isArray(row.service_tiers) ? row.service_tiers : [];
  if (
    serviceTiers.some(
      (tier) => isRecord(tier) && nonEmptyString(tier.id)?.toLowerCase() === "priority",
    )
  ) {
    return true;
  }
  const speedTiers = Array.isArray(row.additional_speed_tiers) ? row.additional_speed_tiers : [];
  return speedTiers.some((tier) => nonEmptyString(tier)?.toLowerCase() === "fast");
}

function parseRichModels(payload: unknown): ReadonlyArray<RichModel> {
  if (!isRecord(payload)) return [];
  const rows = Array.isArray(payload.models)
    ? payload.models
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  const models: Array<RichModel> = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const slug = nonEmptyString(row.slug) ?? nonEmptyString(row.id);
    if (!slug?.startsWith("gpt-") || (row.visibility !== undefined && row.visibility !== "list")) {
      continue;
    }
    const reasoningLevels = parseReasoningLevels(row.supported_reasoning_levels);
    if (reasoningLevels.length === 0) continue;
    const configuredDefault = isClaudeGatewayEffort(row.default_reasoning_level)
      ? row.default_reasoning_level
      : undefined;
    const defaultEffort =
      configuredDefault && reasoningLevels.some(({ effort }) => effort === configuredDefault)
        ? configuredDefault
        : reasoningLevels[0]!.effort;
    models.push({
      slug,
      defaultEffort,
      reasoningLevels,
      supportsFast: supportsFastTier(row),
    });
  }
  return models;
}

function reasoningOption(
  level: RichReasoningLevel,
  defaultEffort: ClaudeGatewayEffort,
): ProviderOptionChoice {
  return {
    id: level.effort,
    label: EFFORT_LABELS[level.effort],
    ...(level.description ? { description: level.description } : {}),
    ...(level.effort === defaultEffort ? { isDefault: true } : {}),
  };
}

function profileCapabilities(
  model: RichModel,
  fastModelId: string | undefined,
  defaults: {
    readonly effort: ClaudeGatewayEffort;
    readonly fastMode: boolean;
  } = { effort: model.defaultEffort, fastMode: false },
): ModelCapabilities {
  return createModelCapabilities({
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: model.reasoningLevels.map((level) => reasoningOption(level, defaults.effort)),
      },
      ...(fastModelId
        ? ([
            {
              id: "fastMode",
              label: "Fast Mode",
              type: "boolean",
              currentValue: defaults.fastMode,
            },
          ] as const)
        : []),
    ],
  });
}

function parseVariantDefaults(
  model: RichModel,
  baseModelId: string,
  fastModelId: string | undefined,
  candidateModelId: string,
): { readonly effort: ClaudeGatewayEffort; readonly fastMode: boolean } | undefined {
  if (!candidateModelId.startsWith(`${baseModelId}-`)) return undefined;
  let suffix = candidateModelId.slice(baseModelId.length + 1);
  const fastMode = suffix === "fast" || suffix.endsWith("-fast");
  if (fastMode) {
    if (!fastModelId) return undefined;
    suffix = suffix === "fast" ? "" : suffix.slice(0, -"-fast".length);
  }
  const effort = suffix.length === 0 ? model.defaultEffort : suffix;
  if (
    !isClaudeGatewayEffort(effort) ||
    !model.reasoningLevels.some((level) => level.effort === effort)
  ) {
    return undefined;
  }
  return { effort, fastMode };
}

function buildCatalog(standardPayload: unknown, richPayload: unknown): ClaudeGatewayCatalog {
  const modelIds = standardModelIds(standardPayload);
  const profiles: Array<ClaudeGatewayModelProfile> = [];
  for (const model of parseRichModels(richPayload)) {
    const baseModelId = `claude-codex-${model.slug}`;
    if (!modelIds.has(baseModelId)) continue;
    const fastCandidate = `${baseModelId}-fast`;
    const fastModelId =
      model.supportsFast && modelIds.has(fastCandidate) ? fastCandidate : undefined;
    profiles.push({
      canonicalModelId: model.slug,
      baseModelId,
      ...(fastModelId ? { fastModelId } : {}),
      aliases: [model.slug, baseModelId],
      defaultEffort: model.defaultEffort,
      capabilities: profileCapabilities(model, fastModelId),
    });
    for (const candidateModelId of modelIds) {
      const defaults = parseVariantDefaults(model, baseModelId, fastModelId, candidateModelId);
      if (!defaults) continue;
      profiles.push({
        canonicalModelId: model.slug,
        baseModelId,
        ...(fastModelId ? { fastModelId } : {}),
        aliases: [candidateModelId],
        defaultEffort: defaults.effort,
        capabilities: profileCapabilities(model, fastModelId, defaults),
      });
    }
  }
  return { profiles };
}

function fetchCatalogJson(connection: GatewayConnection, url: string, timeoutMs: number) {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    let request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    if (connection.authToken) {
      request = request.pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${connection.authToken}`),
      );
    }
    if (connection.apiKey) {
      request = request.pipe(HttpClientRequest.setHeader("x-api-key", connection.apiKey));
    }
    const response = yield* client.execute(request);
    if (response.status < 200 || response.status >= 300) return undefined;
    return yield* response.json;
  }).pipe(
    Effect.timeoutOption(timeoutMs),
    Effect.map(Option.getOrUndefined),
    Effect.orElseSucceed(() => undefined),
  );
}

export const loadClaudeGatewayCatalog = Effect.fn("loadClaudeGatewayCatalog")(function* (
  options: ClaudeGatewayCatalogLoadOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsPath = path.join(options.homePath, ".claude", "settings.json");
  const settingsEnvironment = yield* fileSystem.readFileString(settingsPath).pipe(
    Effect.map(parseSettingsEnvironment),
    Effect.orElseSucceed(() => ({})),
  );
  const connection = resolveGatewayConnection(options.environment, settingsEnvironment);
  if (!connection) return EMPTY_CATALOG;
  const standardUrl = modelCatalogUrl(connection.baseUrl, false);
  const richUrl = modelCatalogUrl(connection.baseUrl, true);
  if (!standardUrl || !richUrl) return EMPTY_CATALOG;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [standardPayload, richPayload] = yield* Effect.all(
    [
      fetchCatalogJson(connection, standardUrl, timeoutMs),
      fetchCatalogJson(connection, richUrl, timeoutMs),
    ],
    { concurrency: "unbounded" },
  );
  return buildCatalog(standardPayload, richPayload);
});

export function resolveClaudeGatewayModelProfile(
  catalog: ClaudeGatewayCatalog,
  modelId: string | null | undefined,
): ClaudeGatewayModelProfile | undefined {
  const normalized = nonEmptyString(modelId);
  if (!normalized) return undefined;
  return catalog.profiles.find((profile) => profile.aliases.includes(normalized));
}

function normalizeGatewayModelIdentity(value: string | null | undefined): string | undefined {
  return nonEmptyString(value)
    ?.toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "");
}

export function resolveClaudeGatewayDiscoveredModelProfile(
  catalog: ClaudeGatewayCatalog,
  model: ClaudeGatewayDiscoveredModelIdentity,
): ClaudeGatewayModelProfile | undefined {
  const exactProfile =
    resolveClaudeGatewayModelProfile(catalog, model.value) ??
    resolveClaudeGatewayModelProfile(catalog, model.resolvedModel) ??
    resolveClaudeGatewayModelProfile(catalog, model.displayName);
  if (exactProfile) return exactProfile;

  const displayIdentity = normalizeGatewayModelIdentity(model.displayName);
  if (!displayIdentity) return undefined;
  const matchingBaseProfiles = catalog.profiles.filter(
    (profile) =>
      profile.aliases.includes(profile.baseModelId) &&
      normalizeGatewayModelIdentity(profile.canonicalModelId) === displayIdentity,
  );
  return matchingBaseProfiles.length === 1 ? matchingBaseProfiles[0] : undefined;
}
