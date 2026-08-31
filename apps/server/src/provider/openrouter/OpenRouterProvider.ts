import {
  type OpenRouterSettings,
  type ProviderOptionDescriptor,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { buildServerProvider } from "../providerSnapshot.ts";
import {
  openRouterAuthenticatedAuth,
  openRouterUnauthenticatedAuth,
} from "./auth/OpenRouterAuthentication.ts";
import type { OpenRouterResolvedCredential } from "./auth/OpenRouterCredentialStore.ts";
import type { OpenRouterKeyProfile } from "./auth/OpenRouterKeyValidation.ts";

const OPENROUTER_PRESENTATION = {
  displayName: "OpenRouter",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;

const OPENROUTER_READY_PRESENTATION = {
  ...OPENROUTER_PRESENTATION,
  nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 40 },
  fetchWorkers: { maxRecommendedWorkers: 8, commandExecutionPolicy: "deny" },
} as const;

const API_KEY_CAPABILITIES = {
  flows: [],
  canDisconnect: false,
  credential: {
    kind: "api-key",
    label: "API key",
    placeholder: "sk-or-v1-…",
  },
} as const;

export interface OpenRouterSnapshotCatalogModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly contextWindowTokens?: number;
  readonly inputModalities: ReadonlyArray<string>;
  readonly outputModalities: ReadonlyArray<string>;
  readonly promptPriceUsdPerMillion?: number;
  readonly completionPriceUsdPerMillion?: number;
  readonly reasoningEfforts: ReadonlyArray<string>;
  readonly defaultReasoningEffort?: string;
  readonly toolCapabilities: {
    readonly tools: boolean;
    readonly parallelToolCalls: boolean;
    readonly toolChoice: boolean;
  };
  readonly incompatibilityReason?: string;
  readonly isCustom: boolean;
  readonly isVerified: boolean;
}

interface OpenRouterProviderDependencyError {
  readonly _tag: string;
  readonly message: string;
  readonly code?: string;
}

export interface OpenRouterProviderStatusDependencies {
  readonly resolveCredential: Effect.Effect<
    Option.Option<OpenRouterResolvedCredential>,
    OpenRouterProviderDependencyError
  >;
  readonly validateKey: (
    apiKey: Redacted.Redacted<string>,
  ) => Effect.Effect<OpenRouterKeyProfile, OpenRouterProviderDependencyError>;
  readonly listModels: (
    customModels: ReadonlyArray<string>,
  ) => Effect.Effect<
    ReadonlyArray<OpenRouterSnapshotCatalogModel>,
    OpenRouterProviderDependencyError
  >;
}

function reasoningLabel(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function modelCapabilities(model: OpenRouterSnapshotCatalogModel) {
  const reasoningOptions = model.reasoningEfforts.map((effort) => ({
    id: effort,
    label: reasoningLabel(effort),
    ...(effort === model.defaultReasoningEffort ? { isDefault: true as const } : {}),
  }));
  const optionDescriptors: ReadonlyArray<ProviderOptionDescriptor> =
    reasoningOptions.length === 0
      ? []
      : [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: reasoningOptions,
            ...(model.defaultReasoningEffort ? { currentValue: model.defaultReasoningEffort } : {}),
          },
        ];
  return createModelCapabilities({
    optionDescriptors,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    ...((model.promptPriceUsdPerMillion !== undefined ||
      model.completionPriceUsdPerMillion !== undefined) && {
      pricing: {
        ...(model.promptPriceUsdPerMillion === undefined
          ? {}
          : { promptUsdPerMillion: model.promptPriceUsdPerMillion }),
        ...(model.completionPriceUsdPerMillion === undefined
          ? {}
          : { completionUsdPerMillion: model.completionPriceUsdPerMillion }),
      },
    }),
    toolSupport: model.toolCapabilities,
    ...(model.contextWindowTokens
      ? {
          contextWindow: {
            defaultTokens: model.contextWindowTokens,
            maxTokens: model.contextWindowTokens,
          },
        }
      : {}),
  });
}

export function openRouterModelsFromCatalog(
  catalog: ReadonlyArray<OpenRouterSnapshotCatalogModel>,
  defaultModel: string,
): ReadonlyArray<ServerProviderModel> {
  const normalizedDefault = defaultModel.trim();
  return catalog.map((model) => ({
    slug: model.id,
    name: model.name,
    ...(normalizedDefault &&
    model.id === normalizedDefault &&
    model.incompatibilityReason === undefined
      ? { isDefault: true as const }
      : {}),
    isCustom: model.isCustom,
    isVerified: model.isVerified,
    isSelectable: model.incompatibilityReason === undefined,
    ...(model.incompatibilityReason ? { unavailableReason: model.incompatibilityReason } : {}),
    capabilities: modelCapabilities(model),
  }));
}

function unresolvedAuth(status: ServerProviderAuth["status"]): ServerProviderAuth {
  return {
    status,
    type: "api-key",
    capabilities: API_KEY_CAPABILITIES,
  };
}

export const makePendingOpenRouterProvider = Effect.fn("makePendingOpenRouterProvider")(function* (
  settings: OpenRouterSettings,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return buildServerProvider({
    presentation: OPENROUTER_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: [],
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: unresolvedAuth("unknown"),
      ...(settings.enabled ? { message: "Checking OpenRouter access and live models..." } : {}),
    },
  });
});

export const checkOpenRouterProviderStatus = Effect.fn("checkOpenRouterProviderStatus")(function* (
  settings: OpenRouterSettings,
  dependencies: OpenRouterProviderStatusDependencies,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const build = (input: {
    readonly status: "ready" | "warning" | "error";
    readonly auth: ServerProviderAuth;
    readonly models?: ReadonlyArray<ServerProviderModel>;
    readonly message?: string;
    readonly exposeNativeSurfaces?: boolean;
  }) =>
    buildServerProvider({
      presentation: input.exposeNativeSurfaces
        ? OPENROUTER_READY_PRESENTATION
        : OPENROUTER_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: input.models ?? [],
      probe: {
        installed: true,
        version: null,
        status: input.status,
        auth: input.auth,
        ...(input.message ? { message: input.message } : {}),
      },
    });

  if (!settings.enabled) {
    return yield* makePendingOpenRouterProvider(settings);
  }
  const credentialExit = yield* Effect.exit(dependencies.resolveCredential);
  if (Exit.isFailure(credentialExit)) {
    return build({
      status: "error",
      auth: unresolvedAuth("error"),
      message: "OpenRouter credential storage could not be read.",
    });
  }
  if (Option.isNone(credentialExit.value)) {
    return build({
      status: "warning",
      auth: openRouterUnauthenticatedAuth(),
      message:
        "Set an OpenRouter API key or configure OPENROUTER_API_KEY in this provider instance's environment.",
    });
  }
  const credential = credentialExit.value.value;
  const profileExit = yield* Effect.exit(dependencies.validateKey(credential.apiKey));
  if (Exit.isFailure(profileExit)) {
    const validationError = Cause.findErrorOption(profileExit.cause);
    return build({
      status: "error",
      auth: unresolvedAuth("error"),
      message: Option.match(validationError, {
        onNone: () => "OpenRouter API key validation failed.",
        onSome: (error) =>
          error.code === "credential-not-inference"
            ? error.message
            : "OpenRouter rejected the configured API key or key validation failed.",
      }),
    });
  }
  const auth = openRouterAuthenticatedAuth(profileExit.value, { source: credential.source });
  const catalogExit = yield* Effect.exit(dependencies.listModels(settings.customModels));
  if (Exit.isFailure(catalogExit)) {
    return build({
      status: "error",
      auth,
      message: "OpenRouter live model discovery failed.",
    });
  }
  const models = openRouterModelsFromCatalog(catalogExit.value, settings.defaultModel);
  if (models.length === 0) {
    return build({
      status: "error",
      auth,
      message: "OpenRouter returned an empty model catalog.",
    });
  }
  const selectableModels = models.filter((model) => model.isSelectable !== false);
  if (selectableModels.length === 0) {
    return build({
      status: "error",
      auth,
      models,
      message: "OpenRouter returned no models compatible with T3 Code agent turns.",
    });
  }
  if (!settings.defaultModel.trim()) {
    return build({
      status: "warning",
      auth,
      models,
      message: "Select an explicit OpenRouter default model before starting turns.",
    });
  }
  const configuredDefault = models.find((model) => model.slug === settings.defaultModel.trim());
  if (!configuredDefault) {
    return build({
      status: "warning",
      auth,
      models,
      message:
        "The configured OpenRouter default model is no longer available. Select another model before starting turns.",
    });
  }
  if (configuredDefault.isSelectable === false) {
    return build({
      status: "warning",
      auth,
      models,
      message: `The configured OpenRouter default model is not compatible with T3 Code. ${configuredDefault.unavailableReason ?? "Select another model before starting turns."}`,
    });
  }
  return build({
    status: "ready",
    auth,
    models,
    exposeNativeSurfaces: true,
    ...(credential.source === "environment"
      ? {
          message:
            "This API key comes from the provider instance's OPENROUTER_API_KEY environment entry. Remove that entry to disconnect.",
        }
      : {}),
  });
});
