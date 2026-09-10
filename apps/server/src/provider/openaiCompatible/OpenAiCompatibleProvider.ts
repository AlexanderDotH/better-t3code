import type {
  OpenAiCompatibleSettings,
  ServerProviderAuth,
  ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

import { buildServerProvider } from "../providerSnapshot.ts";
import { openAiCompatibleAuth } from "./OpenAiCompatibleAuthentication.ts";
import type { OpenAiCompatibleCredentialStoreError } from "./OpenAiCompatibleCredentialStore.ts";
import {
  mergeOpenAiCompatibleCustomModels,
  type OpenAiCompatibleCatalogModel,
} from "./OpenAiCompatibleModelCatalog.ts";
import type { OpenAiCompatibleTransportError } from "./OpenAiCompatibleTransport.ts";

export function openAiCompatibleModelsFromCatalog(
  catalog: ReadonlyArray<OpenAiCompatibleCatalogModel>,
  settings: Pick<OpenAiCompatibleSettings, "defaultModel" | "customModels">,
): ReadonlyArray<ServerProviderModel> {
  const defaultModel = settings.defaultModel.trim();
  return mergeOpenAiCompatibleCustomModels(catalog, [...settings.customModels, defaultModel]).map(
    (model) => {
      const unavailableReason =
        model.incompatibilityReason ??
        (model.toolCapabilities.tools === false
          ? "This model does not support tool calls required for agent turns."
          : undefined);
      return {
        slug: model.id,
        name: model.name,
        ...(model.id === defaultModel && !unavailableReason ? { isDefault: true as const } : {}),
        isCustom: model.isCustom,
        isVerified: model.isVerified,
        isSelectable: unavailableReason === undefined,
        ...(unavailableReason ? { unavailableReason } : {}),
        capabilities: createModelCapabilities({
          optionDescriptors: [],
          inputModalities: ["text"],
          outputModalities: ["text"],
          ...(model.contextWindowTokens
            ? {
                contextWindow: {
                  defaultTokens: model.contextWindowTokens,
                  maxTokens: model.contextWindowTokens,
                },
              }
            : {}),
          ...(model.toolCapabilities.tools === undefined
            ? {}
            : {
                toolSupport: {
                  tools: model.toolCapabilities.tools,
                  parallelToolCalls: model.toolCapabilities.parallelToolCalls === true,
                  toolChoice: model.toolCapabilities.toolChoice === true,
                },
              }),
        }),
      };
    },
  );
}

export const makePendingOpenAiCompatibleProvider = Effect.fn("makePendingOpenAiCompatibleProvider")(
  function* (settings: OpenAiCompatibleSettings, displayName: string) {
    return buildServerProvider({
      presentation: { displayName, showInteractionModeToggle: true },
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: openAiCompatibleAuth({ hasCredential: false }),
        ...(settings.enabled
          ? {
              message: settings.baseUrl.trim()
                ? "Checking endpoint access and available models..."
                : "Configure an endpoint base URL before starting turns.",
            }
          : {}),
      },
    });
  },
);

export const checkOpenAiCompatibleProviderStatus = Effect.fn("checkOpenAiCompatibleProviderStatus")(
  function* (
    settings: OpenAiCompatibleSettings,
    dependencies: {
      readonly displayName: string;
      readonly resolveCredential: Effect.Effect<
        Option.Option<Redacted.Redacted<string>>,
        OpenAiCompatibleCredentialStoreError
      >;
      readonly listModels: Effect.Effect<
        ReadonlyArray<OpenAiCompatibleCatalogModel>,
        OpenAiCompatibleTransportError
      >;
    },
  ) {
    if (!settings.enabled || !settings.baseUrl.trim()) {
      return yield* makePendingOpenAiCompatibleProvider(settings, dependencies.displayName);
    }
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const build = (input: {
      readonly status: "ready" | "warning" | "error";
      readonly auth: ServerProviderAuth;
      readonly models?: ReadonlyArray<ServerProviderModel>;
      readonly message?: string;
    }) =>
      buildServerProvider({
        presentation: {
          displayName: dependencies.displayName,
          showInteractionModeToggle: true,
          ...(input.status === "ready"
            ? {
                nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 40 },
                fetchWorkers: { maxRecommendedWorkers: 8, commandExecutionPolicy: "deny" as const },
              }
            : {}),
        },
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
        auth: openAiCompatibleAuth({ hasCredential: false, status: "error" }),
        message: "The endpoint API key could not be read from secure storage.",
      });
    }
    const hasCredential = Option.isSome(credentialExit.value);
    const catalogExit = yield* Effect.exit(dependencies.listModels);
    let catalog: ReadonlyArray<OpenAiCompatibleCatalogModel> = [];
    let catalogUnavailable = false;
    if (Exit.isSuccess(catalogExit)) {
      catalog = catalogExit.value;
    } else {
      const error = Option.getOrUndefined(Cause.findErrorOption(catalogExit.cause));
      if (error?._tag === "OpenAiCompatibleHttpError" && error.category === "catalog-not-found") {
        catalogUnavailable = true;
      } else {
        const rejected = error?._tag === "OpenAiCompatibleAuthenticationError";
        let message = "The endpoint returned an invalid or unsupported model response.";
        if (rejected) {
          message = hasCredential
            ? "The endpoint rejected the saved API key. Replace or remove it in provider settings."
            : "This endpoint requires an API key. Add it in provider settings.";
        } else if (error?._tag === "OpenAiCompatibleHttpError") {
          if (error.category === "network")
            message =
              "The endpoint could not be reached from this T3 environment. Check its base URL and server.";
          else if (error.category === "timeout")
            message = "The endpoint timed out while listing models.";
          else if (error.category === "rate-limit")
            message = "The endpoint rate limited model discovery. Try refreshing later.";
          else if (error.category === "service-unavailable")
            message = "The endpoint server is temporarily unavailable.";
        }
        return build({
          status: "error",
          auth: openAiCompatibleAuth({
            hasCredential,
            status: rejected ? "unauthenticated" : "unknown",
          }),
          models: openAiCompatibleModelsFromCatalog([], settings),
          message,
        });
      }
    }

    const auth = openAiCompatibleAuth({
      hasCredential,
      status: hasCredential && !catalogUnavailable ? "authenticated" : "unknown",
    });
    const models = openAiCompatibleModelsFromCatalog(catalog, settings);
    const defaultModel = settings.defaultModel.trim();
    if (models.length === 0) {
      return build({
        status: "warning",
        auth,
        message: catalogUnavailable
          ? "This endpoint does not provide a model list. Enter an exact default model ID in provider settings."
          : "The endpoint returned no models. Load a model on the server or enter an exact default model ID.",
      });
    }
    if (!models.some((model) => model.isSelectable !== false)) {
      return build({
        status: "error",
        auth,
        models,
        message: "No endpoint models support the text and tool calls required for agent turns.",
      });
    }
    if (!defaultModel) {
      return build({
        status: "warning",
        auth,
        models,
        message: "Select a model or configure a default model before starting turns.",
      });
    }
    const configuredDefault = models.find((model) => model.slug === defaultModel);
    if (configuredDefault?.isSelectable === false) {
      return build({
        status: "warning",
        auth,
        models,
        message:
          configuredDefault.unavailableReason ??
          "The default model is not compatible with agent turns.",
      });
    }
    return build({
      status: "ready",
      auth,
      models,
      ...(catalogUnavailable
        ? {
            message:
              "This endpoint does not provide a model list. Configured model IDs are available but unverified.",
          }
        : configuredDefault?.isVerified === false
          ? {
              message:
                "The default model was entered manually and has not been verified by this endpoint.",
            }
          : {}),
    });
  },
);
