import { describe, expect, it } from "@effect/vitest";
import type { OpenAiCompatibleSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { OpenAiCompatibleCredentialStoreError } from "./OpenAiCompatibleCredentialStore.ts";
import {
  decodeOpenAiCompatibleModelCatalog,
  OpenAiCompatibleModelCatalogError,
} from "./OpenAiCompatibleModelCatalog.ts";
import { checkOpenAiCompatibleProviderStatus } from "./OpenAiCompatibleProvider.ts";
import {
  OpenAiCompatibleAuthenticationError,
  OpenAiCompatibleHttpError,
} from "./OpenAiCompatibleTransport.ts";

const SETTINGS = {
  enabled: true,
  baseUrl: "http://localhost:1234/v1",
  defaultModel: "local/Model-Q4_K_M",
  customModels: [],
} as const satisfies OpenAiCompatibleSettings;

const dependencies = {
  displayName: "LM Studio",
  resolveCredential: Effect.succeed(Option.none<Redacted.Redacted<string>>()),
  listModels: decodeOpenAiCompatibleModelCatalog({ data: [{ id: SETTINGS.defaultModel }] }),
};

describe("OpenAI-compatible provider status", () => {
  it.effect("keeps disabled and unconfigured instances free of credential and network probes", () =>
    Effect.gen(function* () {
      for (const settings of [
        { ...SETTINGS, enabled: false },
        { ...SETTINGS, baseUrl: "" },
      ]) {
        const snapshot = yield* checkOpenAiCompatibleProviderStatus(settings, {
          ...dependencies,
          resolveCredential: Effect.die("Unconfigured providers must not read credentials"),
          listModels: Effect.die("Unconfigured providers must not probe endpoints"),
        });
        expect(snapshot.status).toBe(settings.enabled ? "warning" : "disabled");
        expect(snapshot.models).toEqual([]);
      }
    }),
  );

  it.effect("makes a saved keyless endpoint ready without claiming unsupported capabilities", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOpenAiCompatibleProviderStatus(SETTINGS, dependencies);
      expect(snapshot).toMatchObject({
        status: "ready",
        auth: {
          status: "unknown",
          type: "api-key-optional",
          capabilities: { canDisconnect: false },
        },
        nativeSubagents: { toolName: "spawn_agent" },
        models: [
          { slug: SETTINGS.defaultModel, isDefault: true, isSelectable: true, isVerified: true },
        ],
      });
      expect(snapshot.models[0]?.capabilities?.inputModalities).toEqual(["text"]);
      expect(snapshot.models[0]?.capabilities?.outputModalities).toEqual(["text"]);
      expect(snapshot.models[0]?.capabilities?.optionDescriptors).toEqual([]);
    }),
  );

  it.effect("keeps exact manual IDs usable when the catalog is missing or empty", () =>
    Effect.gen(function* () {
      for (const listModels of [
        Effect.fail(
          new OpenAiCompatibleHttpError({
            operation: "models",
            category: "catalog-not-found",
            status: 404,
            message: "No catalog",
          }),
        ),
        Effect.succeed([]),
      ]) {
        const snapshot = yield* checkOpenAiCompatibleProviderStatus(SETTINGS, {
          ...dependencies,
          listModels,
        });
        expect(snapshot).toMatchObject({
          status: "ready",
          models: [
            {
              slug: SETTINGS.defaultModel,
              isCustom: true,
              isVerified: false,
              isSelectable: true,
              isDefault: true,
            },
          ],
        });
        expect(snapshot.message).toMatch(/unverified|not been verified/);
      }

      const settings = { ...SETTINGS, defaultModel: "" };
      const missing = yield* checkOpenAiCompatibleProviderStatus(settings, {
        ...dependencies,
        listModels: Effect.fail(
          new OpenAiCompatibleHttpError({
            operation: "models",
            category: "catalog-not-found",
            status: 405,
            message: "No catalog",
          }),
        ),
      });
      const empty = yield* checkOpenAiCompatibleProviderStatus(settings, {
        ...dependencies,
        listModels: Effect.succeed([]),
      });
      expect(missing).toMatchObject({
        status: "warning",
        message: expect.stringContaining("does not provide a model list"),
      });
      expect(empty).toMatchObject({
        status: "warning",
        message: expect.stringContaining("returned no models"),
      });
    }),
  );

  it.effect(
    "keeps manual models visible while distinguishing network, auth, and catalog failures",
    () =>
      Effect.gen(function* () {
        const failures = [
          [
            new OpenAiCompatibleHttpError({
              operation: "models",
              category: "network",
              message: "private-error",
            }),
            "could not be reached",
          ],
          [
            new OpenAiCompatibleHttpError({
              operation: "models",
              category: "timeout",
              message: "private-error",
            }),
            "timed out",
          ],
          [
            new OpenAiCompatibleHttpError({
              operation: "models",
              category: "rate-limit",
              status: 429,
              message: "private-error",
            }),
            "rate limited",
          ],
          [
            new OpenAiCompatibleHttpError({
              operation: "models",
              category: "service-unavailable",
              status: 503,
              message: "private-error",
            }),
            "temporarily unavailable",
          ],
          [
            new OpenAiCompatibleAuthenticationError({ status: 401, message: "private-error" }),
            "requires an API key",
          ],
          [
            new OpenAiCompatibleModelCatalogError({ message: "private-error" }),
            "invalid or unsupported model response",
          ],
        ] as const;
        for (const [error, message] of failures) {
          const snapshot = yield* checkOpenAiCompatibleProviderStatus(SETTINGS, {
            ...dependencies,
            listModels: Effect.fail(error),
          });
          expect(snapshot).toMatchObject({
            status: "error",
            message: expect.stringContaining(message),
          });
          expect(snapshot.models).toMatchObject([
            { slug: SETTINGS.defaultModel, isVerified: false },
          ]);
          expect(snapshot.nativeSubagents).toBeUndefined();
          expect(snapshot.fetchWorkers).toBeUndefined();
          expect(snapshot.message).not.toContain("private-error");
        }

        const rejected = yield* checkOpenAiCompatibleProviderStatus(SETTINGS, {
          ...dependencies,
          resolveCredential: Effect.succeed(Option.some(Redacted.make("saved-secret"))),
          listModels: Effect.fail(
            new OpenAiCompatibleAuthenticationError({ status: 403, message: "saved-secret" }),
          ),
        });
        expect(rejected).toMatchObject({
          auth: { status: "unauthenticated", capabilities: { canDisconnect: true } },
          message: expect.stringContaining("rejected the saved API key"),
        });
        expect(rejected.message).not.toContain("saved-secret");
      }),
  );

  it.effect("does not probe when secure credential storage fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOpenAiCompatibleProviderStatus(SETTINGS, {
        ...dependencies,
        resolveCredential: Effect.fail(
          new OpenAiCompatibleCredentialStoreError({ operation: "read", message: "private-error" }),
        ),
        listModels: Effect.die("Credentials must be resolved before a network request"),
      });
      expect(snapshot).toMatchObject({
        status: "error",
        auth: { status: "error" },
        message: expect.stringContaining("secure storage"),
      });
    }),
  );

  it.effect(
    "keeps incompatible catalog models visible and prevents them becoming the default",
    () =>
      Effect.gen(function* () {
        const snapshot = yield* checkOpenAiCompatibleProviderStatus(SETTINGS, {
          ...dependencies,
          listModels: decodeOpenAiCompatibleModelCatalog({
            data: [
              { id: SETTINGS.defaultModel, capabilities: { trained_for_tool_use: false } },
              { id: "selectable", supported_parameters: ["tools"] },
            ],
          }),
        });
        expect(snapshot.status).toBe("warning");
        expect(snapshot.models).toMatchObject([
          {
            slug: SETTINGS.defaultModel,
            isSelectable: false,
            unavailableReason: expect.stringContaining("tool calling"),
          },
          { slug: "selectable", isSelectable: true },
        ]);
        expect(snapshot.models[0]?.isDefault).toBeUndefined();
        expect(snapshot.nativeSubagents).toBeUndefined();
      }),
  );
});
