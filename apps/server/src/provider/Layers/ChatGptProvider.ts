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

import type { ChatGptAuthBroker } from "../chatgpt/ChatGptAuthBroker.ts";
import { buildServerProvider } from "../providerSnapshot.ts";
import type {
  ChatGptAdapterModel,
  ChatGptAdapterSettings,
  ChatGptAdapterTransport,
} from "./ChatGptAdapter.ts";

const PRESENTATION = {
  displayName: "ChatGPT Subscription",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
  nativeSubagents: { toolName: "spawn_agent", maxRecommendedSubagents: 40 },
  fetchWorkers: { maxRecommendedWorkers: 8, commandExecutionPolicy: "read-only-sandbox" },
} as const;

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "object" && cause !== null && "detail" in cause) {
    const detail = (cause as { readonly detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  }
  return "ChatGPT subscription status check failed.";
}

function reasoningLabel(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function modelCapabilities(model: ChatGptAdapterModel) {
  const reasoningOptions = model.reasoningEfforts.map((effort, index) => ({
    id: effort,
    label: reasoningLabel(effort),
    ...(index === 0 ? { isDefault: true as const } : {}),
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
            currentValue: reasoningOptions[0]!.id,
          },
        ];
  return createModelCapabilities({
    optionDescriptors,
    contextWindow: {
      defaultTokens: model.contextWindow,
      maxTokens: model.contextWindow,
    },
  });
}

export function chatGptModelsFromLiveCatalog(
  models: ReadonlyArray<ChatGptAdapterModel>,
): ReadonlyArray<ServerProviderModel> {
  return models.map((model, index) => ({
    slug: model.id,
    name: model.displayName,
    isDefault:
      model.default === true || (!models.some((candidate) => candidate.default) && index === 0),
    isCustom: false,
    capabilities: modelCapabilities(model),
  }));
}

export const makePendingChatGptProvider = Effect.fn("makePendingChatGptProvider")(function* (
  settings: ChatGptAdapterSettings,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return buildServerProvider({
    presentation: PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: [],
    probe: settings.enabled
      ? {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown", type: "subscription" },
          message: "Checking ChatGPT subscription access and live models...",
        }
      : {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown", type: "subscription" },
        },
  });
});

export const checkChatGptProviderStatus = Effect.fn("checkChatGptProviderStatus")(function* (
  settings: ChatGptAdapterSettings,
  authBroker: Pick<ChatGptAuthBroker, "status">,
  transport: ChatGptAdapterTransport,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const authExit = yield* Effect.exit(authBroker.status);
  if (Exit.isFailure(authExit)) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "error", type: "subscription" },
        message: errorMessage(Cause.squash(authExit.cause)),
      },
    });
  }
  const auth: ServerProviderAuth = authExit.value;
  if (!settings.enabled) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: false,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth,
        ...(auth.status === "authenticated"
          ? { message: "ChatGPT Subscription is disabled in T3 Code settings." }
          : {}),
      },
    });
  }
  if (auth.status !== "authenticated") {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: null,
        status: auth.status === "pending" ? "warning" : "error",
        auth,
        ...(auth.status === "pending"
          ? { message: "ChatGPT subscription sign-in is in progress." }
          : auth.status === "unauthenticated"
            ? {}
            : { message: "Reconnect the ChatGPT subscription to use this provider." }),
      },
    });
  }
  const modelsExit = yield* Effect.exit(transport.listModels);
  const rateLimit = transport.rateLimit
    ? yield* transport.rateLimit.pipe(Effect.orElseSucceed(() => ({ status: "unknown" as const })))
    : undefined;
  if (Exit.isFailure(modelsExit)) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth,
        ...(rateLimit ? { rateLimit } : {}),
        message: `Live ChatGPT model discovery failed: ${errorMessage(Cause.squash(modelsExit.cause))}`,
      },
    });
  }
  const models = chatGptModelsFromLiveCatalog(modelsExit.value);
  if (models.length === 0) {
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth,
        ...(rateLimit ? { rateLimit } : {}),
        message: "The connected ChatGPT account returned no selectable live models.",
      },
    });
  }
  return buildServerProvider({
    presentation: PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "ready",
      auth,
      ...(rateLimit ? { rateLimit } : {}),
    },
  });
});
