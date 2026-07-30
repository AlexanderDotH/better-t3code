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
import { listCursorSdkModels, readCursorSdkStatus } from "../cursorSdk/CursorSdkClient.ts";
import { normalizeCursorSdkApiKey } from "../cursorSdk/CursorSdkKey.ts";
import {
  resolveCursorSdkDefaultModel,
  type CursorSdkSettings,
} from "../cursorSdk/CursorSdkSettings.ts";
import { providerExternalProbeError } from "./ProviderExternalProbeError.ts";

const PROVIDER = ProviderDriverKind.make("cursorSdk");
const PRESENTATION = {
  displayName: "Cursor SDK",
  badgeLabel: "SDK",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

function cursorSdkModelsFromSettings(
  settings: CursorSdkSettings,
): ReadonlyArray<ServerProviderModel> {
  const modelId = resolveCursorSdkDefaultModel(settings);
  const builtInModels = modelId
    ? [
        {
          slug: modelId,
          name: modelId,
          isCustom: false,
          capabilities: EMPTY_CAPABILITIES,
        },
      ]
    : [];
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
}

function cursorSdkModelsFromCatalog(
  settings: CursorSdkSettings,
  catalogModels: ReadonlyArray<{ readonly id: string; readonly displayName: string }>,
): ReadonlyArray<ServerProviderModel> {
  if (catalogModels.length === 0) return cursorSdkModelsFromSettings(settings);
  const builtInModels = catalogModels.map((model) => ({
    slug: model.id,
    name: model.displayName,
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  }));
  return providerModelsFromSettings(
    builtInModels,
    PROVIDER,
    settings.customModels,
    EMPTY_CAPABILITIES,
  );
}

export function makePendingCursorSdkProvider(
  settings: CursorSdkSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: cursorSdkModelsFromSettings(settings),
      probe: {
        installed: true,
        version: null,
        status: settings.enabled ? "warning" : "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Checking Cursor SDK auth..."
          : "Cursor SDK is disabled in T3 Code settings.",
      },
    });
  });
}

export function checkCursorSdkProviderStatus(
  settings: CursorSdkSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    if (!settings.enabled) return yield* makePendingCursorSdkProvider(settings);
    if (!normalizeCursorSdkApiKey(settings.apiKey)) {
      return buildServerProvider({
        presentation: PRESENTATION,
        enabled: true,
        checkedAt,
        models: cursorSdkModelsFromSettings(settings),
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Cursor SDK API key is not configured.",
        },
      });
    }

    const status = yield* Effect.result(
      Effect.tryPromise({
        try: () => readCursorSdkStatus({ apiKey: settings.apiKey }),
        catch: providerExternalProbeError({
          provider: PROVIDER,
          operation: "cursorSdk.status",
        }),
      }),
    );
    if (Result.isFailure(status)) {
      return buildServerProvider({
        presentation: PRESENTATION,
        enabled: true,
        checkedAt,
        models: cursorSdkModelsFromSettings(settings),
        probe: {
          installed: false,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Cursor SDK package is not available or auth status could not be read.",
        },
      });
    }

    const catalogResult = yield* Effect.result(
      Effect.tryPromise({
        try: () => listCursorSdkModels({ apiKey: settings.apiKey }),
        catch: providerExternalProbeError({
          provider: PROVIDER,
          operation: "cursorSdk.models",
        }),
      }),
    );
    const catalog = Result.isSuccess(catalogResult)
      ? catalogResult.success
      : { pickerRows: [], selectionByWireId: new Map() };
    return buildServerProvider({
      presentation: PRESENTATION,
      enabled: true,
      checkedAt,
      models: cursorSdkModelsFromCatalog(settings, catalog.pickerRows),
      probe: {
        installed: true,
        version: null,
        status: status.success.authenticated ? "ready" : "error",
        auth: {
          status: status.success.authenticated ? "authenticated" : "unauthenticated",
          type: "api_key",
          label: status.success.sessionTokenFallback
            ? "Cursor Session Token"
            : "Cursor SDK API Key",
        },
        ...(status.success.authenticated ? {} : { message: "Cursor SDK authentication failed." }),
      },
    });
  });
}
