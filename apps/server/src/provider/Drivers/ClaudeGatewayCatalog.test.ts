// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import {
  loadClaudeGatewayCatalog,
  resolveClaudeGatewayModelProfile,
} from "./ClaudeGatewayCatalog.ts";

const STANDARD_MODELS = {
  data: [
    { id: "gpt-5.6-sol", object: "model" },
    { id: "claude-codex-gpt-5.6-sol", object: "model" },
    { id: "claude-codex-gpt-5.6-sol-fast", object: "model" },
    { id: "claude-codex-gpt-5.6-sol-xhigh-fast", object: "model" },
  ],
};

const RICH_MODELS = {
  models: [
    {
      slug: "gpt-5.6-sol",
      display_name: "GPT 5.6 Sol",
      default_reasoning_level: "low",
      supported_reasoning_levels: [
        { effort: "low", description: "Fast responses with lighter reasoning" },
        { effort: "medium", description: "Balanced reasoning" },
        { effort: "xhigh", description: "Extra high reasoning" },
        { effort: "max", description: "Maximum reasoning" },
        { effort: "ultra", description: "Automatic delegation" },
      ],
      service_tiers: [{ id: "priority", name: "Fast" }],
      additional_speed_tiers: ["fast"],
      visibility: "list",
    },
    {
      slug: "claude-codex-gpt-5.6-sol",
      display_name: "GPT 5.6 Sol",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [{ effort: "high", description: "Alias metadata" }],
      service_tiers: [],
      additional_speed_tiers: [],
      visibility: "list",
    },
  ],
};

function responseFor(request: Parameters<Parameters<typeof HttpClient.make>[0]>[0], body: unknown) {
  return HttpClientResponse.fromWeb(
    request,
    Response.json(body, { headers: { "content-type": "application/json" } }),
  );
}

function makeHome(settings: unknown): string {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-claude-gateway-"));
  NodeFS.mkdirSync(NodePath.join(home, ".claude"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(home, ".claude", "settings.json"), JSON.stringify(settings));
  return home;
}

describe("ClaudeGatewayCatalog", () => {
  it.layer(NodeServices.layer)(
    "loads both catalogs concurrently and trusts canonical GPT metadata",
    (it) => {
      it.effect("builds exact effort and Fast capabilities", () =>
        Effect.gen(function* () {
          const bothStarted = yield* Deferred.make<void>();
          const requests: Array<{ readonly url: string; readonly authorization?: string }> = [];
          const client = HttpClient.make((request) => {
            requests.push({
              url: request.url,
              authorization: request.headers.authorization,
            });
            if (request.url.includes("client_version=")) {
              return Deferred.succeed(bothStarted, undefined).pipe(
                Effect.as(responseFor(request, RICH_MODELS)),
              );
            }
            return Deferred.await(bothStarted).pipe(
              Effect.as(responseFor(request, STANDARD_MODELS)),
            );
          });

          const catalog = yield* loadClaudeGatewayCatalog({
            environment: {
              ANTHROPIC_BASE_URL: "https://instance.example.test/v1/",
              ANTHROPIC_AUTH_TOKEN: "instance-token",
            },
            homePath: makeHome({
              env: {
                ANTHROPIC_BASE_URL: "https://settings.example.test",
                ANTHROPIC_AUTH_TOKEN: "settings-token",
              },
            }),
            timeoutMs: 500,
          }).pipe(Effect.provideService(HttpClient.HttpClient, client));

          expect(requests).toHaveLength(2);
          expect(requests.map((request) => request.url).toSorted()).toEqual([
            "https://instance.example.test/v1/models",
            "https://instance.example.test/v1/models?client_version=0.0.1",
          ]);
          expect(
            requests.every((request) => request.authorization === "Bearer instance-token"),
          ).toBe(true);

          const profile = resolveClaudeGatewayModelProfile(catalog, "gpt-5.6-sol");
          expect(profile).toMatchObject({
            canonicalModelId: "gpt-5.6-sol",
            baseModelId: "claude-codex-gpt-5.6-sol",
            fastModelId: "claude-codex-gpt-5.6-sol-fast",
            defaultEffort: "low",
          });
          expect(profile?.capabilities.optionDescriptors).toEqual([
            {
              id: "effort",
              label: "Reasoning",
              type: "select",
              options: [
                {
                  id: "low",
                  label: "Low",
                  description: "Fast responses with lighter reasoning",
                  isDefault: true,
                },
                { id: "medium", label: "Medium", description: "Balanced reasoning" },
                { id: "xhigh", label: "Extra High", description: "Extra high reasoning" },
                { id: "max", label: "Max", description: "Maximum reasoning" },
              ],
            },
            { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
          ]);

          const forcedFastProfile = resolveClaudeGatewayModelProfile(
            catalog,
            "claude-codex-gpt-5.6-sol-xhigh-fast",
          );
          expect(forcedFastProfile).toMatchObject({
            canonicalModelId: "gpt-5.6-sol",
            baseModelId: "claude-codex-gpt-5.6-sol",
            fastModelId: "claude-codex-gpt-5.6-sol-fast",
            defaultEffort: "xhigh",
          });
          expect(forcedFastProfile?.capabilities.optionDescriptors).toEqual([
            {
              id: "effort",
              label: "Reasoning",
              type: "select",
              options: [
                {
                  id: "low",
                  label: "Low",
                  description: "Fast responses with lighter reasoning",
                },
                { id: "medium", label: "Medium", description: "Balanced reasoning" },
                {
                  id: "xhigh",
                  label: "Extra High",
                  description: "Extra high reasoning",
                  isDefault: true,
                },
                { id: "max", label: "Max", description: "Maximum reasoning" },
              ],
            },
            { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: true },
          ]);
          expect(JSON.stringify(catalog)).not.toContain("instance-token");
          expect(JSON.stringify(catalog)).not.toContain("settings-token");
        }),
      );
    },
  );

  it.layer(NodeServices.layer)("configuration fallback", (it) => {
    it.effect("reads missing gateway values from the selected HOME settings", () =>
      Effect.gen(function* () {
        const requests: Array<{ readonly url: string; readonly apiKey?: string }> = [];
        const client = HttpClient.make((request) => {
          requests.push({ url: request.url, apiKey: request.headers["x-api-key"] });
          return Effect.succeed(
            responseFor(
              request,
              request.url.includes("client_version=") ? RICH_MODELS : STANDARD_MODELS,
            ),
          );
        });
        const homePath = makeHome({
          env: {
            ANTHROPIC_BASE_URL: "https://settings.example.test/api",
            ANTHROPIC_API_KEY: "settings-api-key",
          },
        });

        const catalog = yield* loadClaudeGatewayCatalog({
          environment: {},
          homePath,
        }).pipe(Effect.provideService(HttpClient.HttpClient, client));

        expect(requests.map((request) => request.url).toSorted()).toEqual([
          "https://settings.example.test/api/v1/models",
          "https://settings.example.test/api/v1/models?client_version=0.0.1",
        ]);
        expect(requests.every((request) => request.apiKey === "settings-api-key")).toBe(true);
        expect(resolveClaudeGatewayModelProfile(catalog, "gpt-5.6-sol")).toBeDefined();
      }),
    );
  });

  it.layer(NodeServices.layer)("untrusted gateway responses", (it) => {
    it.effect("returns an empty catalog for invalid JSON without failing the provider", () => {
      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("not-json", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        ),
      );
      return loadClaudeGatewayCatalog({
        environment: { ANTHROPIC_BASE_URL: "https://gateway.example.test" },
        homePath: makeHome({}),
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.map((catalog) => expect(catalog).toEqual({ profiles: [] })),
      );
    });

    it.effect("does not advertise Fast without the exact Fast alias", () => {
      const client = HttpClient.make((request) =>
        Effect.succeed(
          responseFor(
            request,
            request.url.includes("client_version=")
              ? RICH_MODELS
              : {
                  data: [
                    { id: "gpt-5.6-sol", object: "model" },
                    { id: "claude-codex-gpt-5.6-sol", object: "model" },
                    { id: "claude-codex-gpt-5.6-sol-xhigh-fast", object: "model" },
                  ],
                },
          ),
        ),
      );
      return loadClaudeGatewayCatalog({
        environment: { ANTHROPIC_BASE_URL: "https://gateway.example.test" },
        homePath: makeHome({}),
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.map((catalog) => {
          const profile = resolveClaudeGatewayModelProfile(catalog, " claude-codex-gpt-5.6-sol ");
          expect(profile?.fastModelId).toBeUndefined();
          expect(profile?.aliases).toEqual(["gpt-5.6-sol", "claude-codex-gpt-5.6-sol"]);
          expect(profile?.capabilities.optionDescriptors?.some(({ id }) => id === "fastMode")).toBe(
            false,
          );
        }),
      );
    });
  });
});
