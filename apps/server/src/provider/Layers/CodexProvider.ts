import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Types from "effect/Types";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as CodexErrors from "effect-codex-app-server/errors";

import type {
  CodexSettings,
  ServerProvider,
  ServerProviderState,
  ModelCapabilities,
  ProviderOptionDescriptor,
  ServerProviderModel,
  ServerProviderSkill,
} from "@t3tools/contracts";
import { PREFERRED_DEFAULT_CODEX_MODELS, ServerSettingsError } from "@t3tools/contracts";

import { createCodexContextWindowDescriptor, createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import {
  codexAppServerArgs as codexConfiguredAppServerArgs,
  codexExecLaunchArgs,
  resolveCodexLaunchArgs,
} from "./codexLaunchArgs.ts";
import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import { codexManagedFeatureArgs } from "../CodexProcessArgs.ts";
import { CODEX_DEFAULT_SERVICE_TIER, CODEX_FAST_SERVICE_TIER } from "../../codexModelOptions.ts";
import packageJson from "../../../package.json" with { type: "json" };
import { collectUint8StreamText } from "../../stream/collectUint8StreamText.ts";
const isCodexAppServerSpawnError = Schema.is(CodexErrors.CodexAppServerSpawnError);
const CODEX_MODEL_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
const CODEX_MODEL_CATALOG_TIMEOUT = Duration.seconds(5);
const decodeUnknownJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const CODEX_PRESENTATION = {
  displayName: "Codex",
  showInteractionModeToggle: true,
  nativeSubagents: {
    toolName: "spawn_agent",
    maxRecommendedSubagents: 8,
  },
  fetchWorkers: {
    maxRecommendedWorkers: 8,
    commandExecutionPolicy: "deny",
  },
} as const;

export interface CodexAppServerProviderSnapshot {
  readonly account: CodexSchema.V2GetAccountResponse;
  readonly version: string | undefined;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}

const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultra: "Ultra",
  max: "Maximum",
};

const CURRENT_CODEX_MODELS = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);

export function isLegacyCodexModel(model: string): boolean {
  return !CURRENT_CODEX_MODELS.has(model);
}
function reasoningEffortLabel(reasoningEffort: string): string {
  return REASONING_EFFORT_LABELS[reasoningEffort] ?? reasoningEffort;
}

function codexAccountAuthLabel(account: CodexSchema.V2GetAccountResponse["account"]) {
  if (!account) return undefined;
  if (account.type === "apiKey") return "OpenAI API Key";
  if (account.type === "amazonBedrock") return "Amazon Bedrock";
  if (account.type !== "chatgpt") return undefined;

  switch (account.planType) {
    case "free":
      return "ChatGPT Free Subscription";
    case "go":
      return "ChatGPT Go Subscription";
    case "plus":
      return "ChatGPT Plus Subscription";
    case "pro":
      return "ChatGPT Pro 20x Subscription";
    case "prolite":
      return "ChatGPT Pro 5x Subscription";
    case "team":
      return "ChatGPT Team Subscription";
    case "self_serve_business_usage_based":
    case "business":
      return "ChatGPT Business Subscription";
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "ChatGPT Enterprise Subscription";
    case "edu":
      return "ChatGPT Edu Subscription";
    case "unknown":
      return "ChatGPT Subscription";
    default:
      account.planType satisfies never;
      return undefined;
  }
}

function codexAccountEmail(account: CodexSchema.V2GetAccountResponse["account"]) {
  if (!account || account.type !== "chatgpt") return undefined;
  return account.email;
}

export function mapCodexModelCapabilities(
  model: CodexSchema.V2ModelListResponse__Model,
  contextWindow?: ModelCapabilities["contextWindow"],
): ModelCapabilities {
  const reasoningOptions = model.supportedReasoningEfforts.map(({ reasoningEffort }) =>
    reasoningEffort === model.defaultReasoningEffort
      ? {
          id: reasoningEffort,
          label: reasoningEffortLabel(reasoningEffort),
          isDefault: true,
        }
      : {
          id: reasoningEffort,
          label: reasoningEffortLabel(reasoningEffort),
        },
  );
  const defaultReasoning = reasoningOptions.find((option) => option.isDefault)?.id;
  const rawServiceTiers =
    model.serviceTiers && model.serviceTiers.length > 0
      ? model.serviceTiers
      : (model.additionalSpeedTiers ?? []).map((id) => ({
          id,
          name: id === "fast" ? "Fast" : id,
          description: "",
        }));
  const serviceTiers = rawServiceTiers.reduce<
    Array<{ readonly id: string; readonly name: string; readonly description: string }>
  >((tiers, tier) => {
    const id = tier.id === "fast" ? CODEX_FAST_SERVICE_TIER : tier.id;
    if (tiers.some((candidate) => candidate.id === id)) {
      return tiers;
    }
    tiers.push({
      id,
      name: id === CODEX_FAST_SERVICE_TIER ? "Fast" : tier.name,
      description: tier.description,
    });
    return tiers;
  }, []);
  const catalogDefaultTier =
    model.defaultServiceTier === "fast" ? CODEX_FAST_SERVICE_TIER : model.defaultServiceTier;
  const catalogDefaultServiceTier = serviceTiers.some((tier) => tier.id === catalogDefaultTier)
    ? catalogDefaultTier
    : null;
  const defaultServiceTier = catalogDefaultServiceTier ?? CODEX_DEFAULT_SERVICE_TIER;
  const optionDescriptors: ProviderOptionDescriptor[] = [];

  if (reasoningOptions.length > 0) {
    optionDescriptors.push({
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: reasoningOptions,
      ...(defaultReasoning ? { currentValue: defaultReasoning } : {}),
    });
  }
  if (serviceTiers.length > 0) {
    optionDescriptors.push({
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        {
          id: CODEX_DEFAULT_SERVICE_TIER,
          label: "Standard",
          ...(defaultServiceTier === CODEX_DEFAULT_SERVICE_TIER ? { isDefault: true } : {}),
        },
        ...serviceTiers.map((tier) => ({
          id: tier.id,
          label: tier.name,
          ...(tier.description ? { description: tier.description } : {}),
          ...(defaultServiceTier === tier.id ? { isDefault: true } : {}),
        })),
      ],
      currentValue: defaultServiceTier,
    });
  }
  if (contextWindow) {
    optionDescriptors.push(createCodexContextWindowDescriptor(contextWindow));
  }

  return createModelCapabilities({
    optionDescriptors,
    ...(contextWindow ? { contextWindow } : {}),
  });
}

type CodexContextWindowMetadata = NonNullable<ModelCapabilities["contextWindow"]>;

export function parseCodexDebugModelCatalog(
  value: unknown,
): Map<string, CodexContextWindowMetadata> {
  if (typeof value !== "object" || value === null || !("models" in value)) return new Map();
  const models = (value as { readonly models?: unknown }).models;
  if (!Array.isArray(models)) return new Map();

  const parsed = new Map<string, CodexContextWindowMetadata>();
  for (const model of models) {
    if (typeof model !== "object" || model === null) continue;
    const candidate = model as Record<string, unknown>;
    const slug = typeof candidate.slug === "string" ? candidate.slug.trim() : "";
    const defaultTokens = candidate.context_window;
    const maxTokens = candidate.max_context_window;
    const effectivePercent = candidate.effective_context_window_percent;
    if (
      !slug ||
      !Number.isSafeInteger(defaultTokens) ||
      !Number.isSafeInteger(maxTokens) ||
      Number(defaultTokens) <= 0 ||
      Number(maxTokens) < Number(defaultTokens)
    ) {
      continue;
    }
    parsed.set(slug, {
      defaultTokens: Number(defaultTokens),
      maxTokens: Number(maxTokens),
      ...(typeof effectivePercent === "number" &&
      Number.isFinite(effectivePercent) &&
      effectivePercent >= 1 &&
      effectivePercent <= 100
        ? { effectivePercent }
        : {}),
    });
  }
  return parsed;
}

function enrichCodexModelsWithContextWindow(
  models: ReadonlyArray<ServerProviderModel>,
  catalog: ReadonlyMap<string, CodexContextWindowMetadata>,
): ReadonlyArray<ServerProviderModel> {
  return models.map((model) => {
    const contextWindow = catalog.get(model.slug);
    if (!contextWindow) return model;
    const capabilities = model.capabilities ?? createModelCapabilities({ optionDescriptors: [] });
    const optionDescriptors = (capabilities.optionDescriptors ?? []).filter(
      (descriptor) => descriptor.id !== "contextWindow",
    );
    return {
      ...model,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          ...optionDescriptors,
          createCodexContextWindowDescriptor(contextWindow),
        ],
        contextWindow,
      }),
    };
  });
}

const probeCodexContextWindowCatalog = Effect.fn("probeCodexContextWindowCatalog")(
  function* (input: {
    readonly binaryPath: string;
    readonly launchArgs?: string;
    readonly cwd: string;
    readonly environment: NodeJS.ProcessEnv;
  }) {
    const args = [...codexExecLaunchArgs(input.launchArgs), "debug", "models"];
    const spawnCommand = yield* resolveSpawnCommand(input.binaryPath, args, {
      env: input.environment,
      extendEnv: true,
    });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        cwd: input.cwd,
        env: input.environment,
        extendEnv: true,
        shell: spawnCommand.shell,
      }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({
          stream: child.stdout,
          maxBytes: CODEX_MODEL_CATALOG_MAX_BYTES,
        }),
        collectUint8StreamText({ stream: child.stderr, maxBytes: 16 * 1024 }),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0 || stdout.truncated || stdout.invalidUtf8 || stderr.truncated) {
      return new Map<string, CodexContextWindowMetadata>();
    }
    const decoded = yield* decodeUnknownJson(stdout.text);
    return parseCodexDebugModelCatalog(decoded);
  },
);

const loadCodexContextWindowCatalog = (input: {
  readonly binaryPath: string;
  readonly launchArgs?: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}) =>
  probeCodexContextWindowCatalog(input).pipe(
    Effect.scoped,
    Effect.timeout(CODEX_MODEL_CATALOG_TIMEOUT),
    Effect.catchCause((cause) =>
      Effect.logDebug("Codex model context catalog unavailable", {
        cause: Cause.pretty(cause),
      }).pipe(Effect.as(new Map<string, CodexContextWindowMetadata>())),
    ),
  );

const toDisplayName = (model: CodexSchema.V2ModelListResponse__Model): string => {
  // Capitalize 'gpt' to 'GPT-' and capitalize any letter following a dash
  return model.displayName
    .replace(/^gpt/i, "GPT") // Handle start with 'gpt' or 'GPT'
    .replace(/-([a-z])/g, (_, c) => "-" + c.toUpperCase());
};

function parseCodexModelListResponse(
  response: CodexSchema.V2ModelListResponse,
): ReadonlyArray<ServerProviderModel> {
  return response.data.map((model) => ({
    slug: model.model,
    name: toDisplayName(model),
    isCustom: false,
    ...(model.isDefault ? { isDefault: true } : {}),
    ...(isLegacyCodexModel(model.model) ? { isLegacy: true } : {}),
    capabilities: mapCodexModelCapabilities(model),
  }));
}

/**
 * Prefer our own default-model ranking when one of the preferred slugs is in
 * the live catalog; otherwise keep whatever Codex itself flagged as default.
 */
export function applyPreferredCodexDefaultModel(
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  const preferredSlug = PREFERRED_DEFAULT_CODEX_MODELS.find((slug) =>
    models.some((model) => model.slug === slug && !model.isCustom),
  );
  if (!preferredSlug) {
    return models;
  }
  return models.map((model) => {
    if (model.slug === preferredSlug) {
      return model.isDefault ? model : { ...model, isDefault: true };
    }
    if (!model.isDefault) {
      return model;
    }
    const { isDefault: _isDefault, ...rest } = model;
    return rest;
  });
}

function appendCustomCodexModels(
  models: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  if (customModels.length === 0) {
    return models;
  }

  const seen = new Set(models.map((model) => model.slug));
  const fallbackCapabilities = models.find((model) => model.capabilities)?.capabilities ?? null;
  const customEntries: ServerProviderModel[] = [];
  for (const rawModel of customModels) {
    const slug = rawModel.trim();
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    customEntries.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: fallbackCapabilities,
    });
  }
  return customEntries.length === 0 ? models : [...models, ...customEntries];
}

function parseCodexSkillsListResponse(
  response: CodexSchema.V2SkillsListResponse,
  cwd: string,
): ReadonlyArray<ServerProviderSkill> {
  const matchingEntry = response.data.find((entry) => entry.cwd === cwd);
  const skills = matchingEntry
    ? matchingEntry.skills
    : response.data.flatMap((entry) => entry.skills);

  return skills.map((skill) => {
    const shortDescription =
      skill.shortDescription ?? skill.interface?.shortDescription ?? undefined;

    const parsedSkill: Types.Mutable<ServerProviderSkill> = {
      name: skill.name,
      path: skill.path,
      enabled: skill.enabled,
    };

    if (skill.description) {
      parsedSkill.description = skill.description;
    }
    if (skill.scope) {
      parsedSkill.scope = skill.scope;
    }
    if (skill.interface?.displayName) {
      parsedSkill.displayName = skill.interface.displayName;
    }
    if (shortDescription) {
      parsedSkill.shortDescription = shortDescription;
    }

    return parsedSkill;
  });
}

const requestAllCodexModels = Effect.fn("requestAllCodexModels")(function* (
  client: CodexClient.CodexAppServerClient["Service"],
) {
  const models: ServerProviderModel[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const response: CodexSchema.V2ModelListResponse = yield* client.request(
      "model/list",
      cursor ? { cursor } : {},
    );
    models.push(...parseCodexModelListResponse(response));
    cursor = response.nextCursor;
  } while (cursor);

  return models;
});

export function buildCodexInitializeParams(): CodexSchema.V1InitializeParams {
  return {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}

const probeCodexAppServerProvider = Effect.fn("probeCodexAppServerProvider")(function* (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly launchArgs?: string;
  readonly cwd: string;
  readonly customModels?: ReadonlyArray<string>;
  readonly environment?: NodeJS.ProcessEnv;
}) {
  // `~` is not shell-expanded when env vars are set via `child_process.spawn`,
  // so `CODEX_HOME=~/.codex_work` would reach codex verbatim and trip
  // "CODEX_HOME points to '~/.codex_work', but that path does not exist".
  // Expand here for parity with `CodexTextGeneration`/`CodexSessionRuntime`.
  const resolvedHomePath = input.homePath ? expandHomePath(input.homePath) : undefined;
  const environment = {
    ...input.environment,
    ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
  };
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const appServerArgs = [
    ...codexConfiguredAppServerArgs(input.launchArgs),
    ...codexManagedFeatureArgs(),
  ];
  const spawnCommand = yield* resolveSpawnCommand(input.binaryPath, appServerArgs, {
    env: environment,
    extendEnv: true,
  });
  const child = yield* spawner
    .spawn(
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        cwd: input.cwd,
        env: environment,
        extendEnv: true,
        shell: spawnCommand.shell,
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new CodexErrors.CodexAppServerSpawnError({
            command: `${input.binaryPath} ${appServerArgs.join(" ")}`,
            cause,
          }),
      ),
    );
  const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
  const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
    Effect.provide(clientContext),
  );

  const initialize = yield* client.request("initialize", {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  });
  yield* client.notify("initialized", undefined);

  // Extract the version string after the first '/' in userAgent, up to the next space or the end
  const versionMatch = initialize.userAgent.match(/\/([^\s]+)/);
  const version = versionMatch ? versionMatch[1] : undefined;

  const accountResponse = yield* client.request("account/read", {});
  if (!accountResponse.account && accountResponse.requiresOpenaiAuth) {
    return {
      account: accountResponse,
      version,
      models: appendCustomCodexModels([], input.customModels ?? []),
      skills: [],
    } satisfies CodexAppServerProviderSnapshot;
  }

  const [skillsResponse, models, contextCatalog] = yield* Effect.all(
    [
      client.request("skills/list", {
        cwds: [input.cwd],
      }),
      requestAllCodexModels(client),
      loadCodexContextWindowCatalog({
        binaryPath: input.binaryPath,
        ...(input.launchArgs ? { launchArgs: input.launchArgs } : {}),
        cwd: input.cwd,
        environment,
      }),
    ],
    { concurrency: "unbounded" },
  );

  return {
    account: accountResponse,
    version,
    models: applyPreferredCodexDefaultModel(
      enrichCodexModelsWithContextWindow(
        appendCustomCodexModels(models, input.customModels ?? []),
        contextCatalog,
      ),
    ),
    skills: parseCodexSkillsListResponse(skillsResponse, input.cwd),
  } satisfies CodexAppServerProviderSnapshot;
});

const emptyCodexModelsFromSettings = (codexSettings: CodexSettings): ServerProvider["models"] => {
  const models = new Set<string>();
  for (const model of codexSettings.customModels) {
    const trimmed = model.trim();
    if (trimmed.length > 0) {
      models.add(trimmed);
    }
  }
  return Array.from(models, (model) => ({
    slug: model,
    name: model,
    isCustom: true,
    capabilities: null,
  }));
};

const makePendingCodexProvider = (
  codexSettings: CodexSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = emptyCodexModelsFromSettings(codexSettings);

    if (!codexSettings.enabled) {
      return buildServerProvider({
        presentation: CODEX_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        skills: [],
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Codex is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      skills: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex provider status has not been checked in this session yet.",
      },
    });
  });

function accountProbeStatus(account: CodexAppServerProviderSnapshot["account"]): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProvider["auth"];
  readonly message?: string;
} {
  const authLabel = codexAccountAuthLabel(account.account);
  const authEmail = codexAccountEmail(account.account);
  const auth = {
    status: account.account ? ("authenticated" as const) : ("unknown" as const),
    ...(account.account?.type ? { type: account.account?.type } : {}),
    ...(authLabel ? { label: authLabel } : {}),
    ...(authEmail ? { email: authEmail } : {}),
  } satisfies ServerProvider["auth"];

  if (account.account) {
    return { status: "ready", auth };
  }

  if (account.requiresOpenaiAuth) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  return { status: "ready", auth };
}

export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  codexSettings: CodexSettings,
  probe: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
    readonly launchArgs?: string;
    readonly cwd: string;
    readonly customModels: ReadonlyArray<string>;
    readonly environment?: NodeJS.ProcessEnv;
  }) => Effect.Effect<
    CodexAppServerProviderSnapshot,
    CodexErrors.CodexAppServerError,
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
  > = probeCodexAppServerProvider,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<
  ServerProviderDraft,
  ServerSettingsError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const resolvedEnvironment = environment ?? process.env;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const emptyModels = emptyCodexModelsFromSettings(codexSettings);

  if (!codexSettings.enabled) {
    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: false,
      checkedAt,
      models: emptyModels,
      skills: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in T3 Code settings.",
      },
    });
  }

  const probeResult = yield* probe({
    binaryPath: codexSettings.binaryPath,
    homePath: codexSettings.homePath,
    launchArgs: resolveCodexLaunchArgs(codexSettings.launchArgs, resolvedEnvironment),
    cwd: process.cwd(),
    customModels: codexSettings.customModels,
    environment: resolvedEnvironment,
  }).pipe(
    Effect.scoped,
    Effect.timeoutOption(Duration.millis(AUTH_PROBE_TIMEOUT_MS)),
    Effect.result,
  );

  if (Result.isFailure(probeResult)) {
    const error = probeResult.failure;
    const installed = !isCodexAppServerSpawnError(error);
    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      probe: {
        installed,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: installed
          ? `Codex app-server provider probe failed: ${error.message}.`
          : "Codex CLI (`codex`) is not installed or not on PATH.",
      },
    });
  }

  if (Option.isNone(probeResult.success)) {
    return buildServerProvider({
      presentation: CODEX_PRESENTATION,
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Timed out while checking Codex app-server provider status.",
      },
    });
  }

  const snapshot = probeResult.success.value;
  const accountStatus = accountProbeStatus(snapshot.account);

  return buildServerProvider({
    presentation: CODEX_PRESENTATION,
    enabled: codexSettings.enabled,
    checkedAt,
    models: snapshot.models,
    skills: snapshot.skills,
    probe: {
      installed: true,
      version: snapshot.version ?? null,
      status: accountStatus.status,
      auth: accountStatus.auth,
      ...(accountStatus.message ? { message: accountStatus.message } : {}),
    },
  });
});

// NOTE: the singleton `CodexProviderLive` Layer has been removed as part of
// the per-instance-driver refactor. `CodexDriver.create()` builds a managed
// snapshot per instance (each with its own `CodexSettings`) and hands the
// resulting `ServerProviderShape` back as `ProviderInstance.snapshot`.
//
// The `makePendingCodexProvider` and `checkCodexProviderStatus` helpers are
// re-exported for use by `CodexDriver`.
export { makePendingCodexProvider };
