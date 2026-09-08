import type {
  ProviderOptionDescriptor,
  ServerProviderAuth,
  ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { buildServerProvider } from "../providerSnapshot.ts";
import type { OpenAiCatalogModel } from "./OpenAiModelCatalog.ts";
import { openAiAuthenticatedAuth, openAiUnauthenticatedAuth } from "./auth/OpenAiAuthentication.ts";
import type { OpenAiResolvedCredential } from "./auth/OpenAiCredentialStore.ts";
import { maskOpenAiKeyLabel } from "./auth/OpenAiKeyValidation.ts";

const BASE_PRESENTATION = {
  displayName: "OpenAI Responses",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;

export const OPENAI_RESPONSES_PRESENTATION = {
  ...BASE_PRESENTATION,
  nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 40 },
  fetchWorkers: { maxRecommendedWorkers: 8, commandExecutionPolicy: "deny" },
} as const;

export interface OpenAiProviderSettings {
  readonly enabled: boolean;
}

interface OpenAiProviderDependencyError {
  readonly _tag: string;
  readonly message: string;
}

export interface OpenAiProviderStatusDependencies {
  readonly resolveCredential: Effect.Effect<
    Option.Option<OpenAiResolvedCredential>,
    OpenAiProviderDependencyError
  >;
  readonly listModels: Effect.Effect<
    ReadonlyArray<OpenAiCatalogModel>,
    OpenAiProviderDependencyError
  >;
}

function reasoningLabel(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function modelCapabilities(model: OpenAiCatalogModel) {
  const reasoningOptions = model.reasoningEfforts.map((effort) => ({
    id: effort,
    label: reasoningLabel(effort),
    ...(effort === model.defaultReasoningEffort ? { isDefault: true as const } : {}),
  }));
  const optionDescriptors: ReadonlyArray<ProviderOptionDescriptor> = [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: reasoningOptions,
      currentValue: model.defaultReasoningEffort,
    },
  ];
  return createModelCapabilities({
    optionDescriptors,
    contextWindow: {
      defaultTokens: model.contextWindowTokens,
      maxTokens: model.contextWindowTokens,
    },
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    toolSupport: model.toolCapabilities,
  });
}

export function openAiModelsFromLiveCatalog(
  catalog: ReadonlyArray<OpenAiCatalogModel>,
): ReadonlyArray<ServerProviderModel> {
  return catalog.map((model, index) => ({
    slug: model.id,
    name: model.name,
    ...(index === 0 ? { isDefault: true as const } : {}),
    isCustom: false,
    isVerified: model.isVerified,
    capabilities: modelCapabilities(model),
  }));
}

function unresolvedAuth(status: ServerProviderAuth["status"]): ServerProviderAuth {
  return {
    status,
    type: "api-key",
    capabilities: {
      flows: [],
      canDisconnect: false,
      credential: { kind: "api-key", label: "API key", placeholder: "sk-…" },
    },
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  return "OpenAI provider status check failed.";
}

export const makePendingOpenAiProvider = Effect.fn("makePendingOpenAiProvider")(function* (
  settings: OpenAiProviderSettings,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return buildServerProvider({
    presentation: BASE_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: [],
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: unresolvedAuth("unknown"),
      ...(settings.enabled ? { message: "Checking OpenAI API access and live models..." } : {}),
    },
  });
});

export const checkOpenAiProviderStatus = Effect.fn("checkOpenAiProviderStatus")(function* (
  settings: OpenAiProviderSettings,
  dependencies: OpenAiProviderStatusDependencies,
) {
  if (!settings.enabled) return yield* makePendingOpenAiProvider(settings);
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const build = (input: {
    readonly status: "ready" | "warning" | "error";
    readonly auth: ServerProviderAuth;
    readonly models?: ReadonlyArray<ServerProviderModel>;
    readonly message?: string;
    readonly exposeNativeSurfaces?: boolean;
  }) =>
    buildServerProvider({
      presentation: input.exposeNativeSurfaces ? OPENAI_RESPONSES_PRESENTATION : BASE_PRESENTATION,
      enabled: true,
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

  const credentialExit = yield* Effect.exit(dependencies.resolveCredential);
  if (Exit.isFailure(credentialExit)) {
    return build({
      status: "error",
      auth: unresolvedAuth("error"),
      message: "OpenAI credential storage could not be read.",
    });
  }
  if (Option.isNone(credentialExit.value)) {
    return build({
      status: "warning",
      auth: openAiUnauthenticatedAuth(),
      message:
        "Set an OpenAI API key or configure OPENAI_API_KEY in this provider instance's environment.",
    });
  }
  const credential = credentialExit.value.value;
  const modelsExit = yield* Effect.exit(dependencies.listModels);
  if (Exit.isFailure(modelsExit)) {
    return build({
      status: "error",
      auth: unresolvedAuth("error"),
      message: `Live OpenAI model discovery failed: ${errorMessage(Cause.squash(modelsExit.cause))}`,
    });
  }
  const auth = openAiAuthenticatedAuth(
    {
      label: maskOpenAiKeyLabel(Redacted.value(credential.apiKey)),
      supportedModelCount: modelsExit.value.length,
    },
    { source: credential.source },
  );
  const models = openAiModelsFromLiveCatalog(modelsExit.value);
  if (models.length === 0) {
    return build({
      status: "error",
      auth,
      message: "The authenticated OpenAI account returned no tested coding models.",
    });
  }
  return build({
    status: "ready",
    auth,
    models,
    exposeNativeSurfaces: true,
  });
});
