import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { readHyperagentStatus, type FetchLike } from "../hyperagent/HyperagentClient.ts";
import { providerExternalProbeError } from "./ProviderExternalProbeError.ts";
import {
  resolveHyperagentDefaultModel,
  resolveHyperagentBaseUrl,
  resolveHyperagentSessionCookie,
  type HyperagentSettings,
} from "../hyperagent/HyperagentSettings.ts";
import { HYPERAGENT_MODEL_CATALOG } from "../hyperagent/HyperagentCatalog.ts";

const PROVIDER = ProviderDriverKind.make("hyperagent");
const PRESENTATION = {
  displayName: "Hyperagent",
  badgeLabel: "External",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

function hyperagentModelsFromSettings(
  settings: HyperagentSettings,
): ReadonlyArray<ServerProviderModel> {
  const defaultModel = resolveHyperagentDefaultModel(settings);
  const catalogIncludesDefault = HYPERAGENT_MODEL_CATALOG.some(
    (model) => model.id === defaultModel,
  );
  const builtInModels = [
    ...HYPERAGENT_MODEL_CATALOG.map((model) => ({
      slug: model.id,
      name: model.name,
      isCustom: false,
      capabilities: EMPTY_CAPABILITIES,
    })),
    ...(catalogIncludesDefault
      ? []
      : [
          {
            slug: defaultModel,
            name: defaultModel,
            isCustom: false,
            capabilities: EMPTY_CAPABILITIES,
          },
        ]),
  ];
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
}

export function makePendingHyperagentProvider(
  settings: HyperagentSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = hyperagentModelsFromSettings(settings);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Hyperagent is disabled in T3 Code settings.",
        },
      });
    }
    const sessionCookie = resolveHyperagentSessionCookie(settings);
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: sessionCookie ? "warning" : "error",
        auth: { status: sessionCookie ? "unknown" : "unauthenticated" },
        message: sessionCookie
          ? "Checking Hyperagent session..."
          : "Hyperagent session cookie is not configured.",
      },
    });
  });
}

export function checkHyperagentProviderStatus(
  settings: HyperagentSettings,
  fetchImpl?: FetchLike,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = hyperagentModelsFromSettings(settings);
    if (!settings.enabled) {
      return yield* makePendingHyperagentProvider(settings);
    }
    const sessionCookie = resolveHyperagentSessionCookie(settings);
    const baseUrl = resolveHyperagentBaseUrl(settings);
    if (!sessionCookie) {
      return buildServerProvider({
        presentation: PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Hyperagent session cookie is not configured.",
        },
      });
    }

    const status = yield* Effect.result(
      Effect.tryPromise({
        try: () => readHyperagentStatus({ sessionCookie, baseUrl, fetchImpl }),
        catch: providerExternalProbeError({
          provider: PROVIDER,
          operation: "hyperagent.status",
        }),
      }),
    );

    if (Result.isFailure(status)) {
      return buildServerProvider({
        presentation: PRESENTATION,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Failed to verify Hyperagent session.",
        },
      });
    }

    const connected = status.success.connected;
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: connected ? "ready" : "error",
        auth: {
          status: connected ? "authenticated" : "unauthenticated",
          type: "session_cookie",
          label: "Hyperagent Session",
          ...(status.success.email ? { email: status.success.email } : {}),
        },
        ...(connected ? {} : { message: "Hyperagent session is not authenticated." }),
      },
    });
  });
}
