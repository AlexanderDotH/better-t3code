import { describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { makeOpenRouterKeyValidator, maskOpenRouterKeyLabel } from "./OpenRouterKeyValidation.ts";

const profile = {
  data: {
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_monthly: 0,
    byok_usage_weekly: 0,
    creator_user_id: null,
    label: "sk-or-v1-secret-value",
    is_free_tier: true,
    expires_at: "2027-08-25T00:00:00.000Z",
    include_byok_in_limit: false,
    is_management_key: false,
    is_provisioning_key: false,
    limit: null,
    limit_remaining: null,
    limit_reset: null,
    rate_limit: { interval: "10s", note: "legacy", requests: -1 },
    usage: 0,
    usage_daily: 0,
    usage_monthly: 0,
    usage_weekly: 0,
  },
};

describe("OpenRouterKeyValidation", () => {
  it.effect("validates through the fixed current-key endpoint without exposing the API key", () =>
    Effect.gen(function* () {
      const execute = vi.fn((request: Parameters<Parameters<typeof HttpClient.make>[0]>[0]) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(profile))),
      );
      const validator = yield* makeOpenRouterKeyValidator().pipe(
        Effect.provideService(HttpClient.HttpClient, HttpClient.make(execute)),
      );

      const result = yield* validator.validate(Redacted.make("sk-or-v1-secret-value"));

      const request = execute.mock.calls[0]?.[0];
      expect(request?.url).toBe("https://openrouter.ai/api/v1/key");
      expect(request?.headers.authorization).toBe("Bearer sk-or-v1-secret-value");
      expect(result).toEqual({
        label: "sk-o…alue",
        isFreeTier: true,
        expiresAt: "2027-08-25T00:00:00.000Z",
      });
      expect(JSON.stringify(result)).not.toContain("secret-value");
    }),
  );

  it.effect("maps a rejected credential to a redacted non-retryable error", () =>
    Effect.gen(function* () {
      const execute = (request: Parameters<Parameters<typeof HttpClient.make>[0]>[0]) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(
              { error: { message: "sk-or-invalid should never escape" } },
              { status: 401 },
            ),
          ),
        );
      const validator = yield* makeOpenRouterKeyValidator().pipe(
        Effect.provideService(HttpClient.HttpClient, HttpClient.make(execute)),
      );

      const error = yield* Effect.flip(validator.validate(Redacted.make("sk-or-invalid")));

      expect(error).toMatchObject({
        code: "credential-invalid",
        status: 401,
        retryable: false,
      });
      expect(JSON.stringify(error)).not.toContain("sk-or-invalid");
    }),
  );

  it.effect("rejects management and provisioning keys before they reach inference", () =>
    Effect.gen(function* () {
      for (const restrictedKind of ["is_management_key", "is_provisioning_key"] as const) {
        const restrictedProfile = {
          data: {
            ...profile.data,
            is_management_key: false,
            is_provisioning_key: false,
            [restrictedKind]: true,
          },
        };
        const execute = (request: Parameters<Parameters<typeof HttpClient.make>[0]>[0]) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(restrictedProfile)));
        const validator = yield* makeOpenRouterKeyValidator().pipe(
          Effect.provideService(HttpClient.HttpClient, HttpClient.make(execute)),
        );

        const error = yield* Effect.flip(
          validator.validate(Redacted.make("sk-or-v1-management-secret")),
        );

        expect(error).toMatchObject({
          code: "credential-not-inference",
          retryable: false,
        });
        expect(error.message).toContain("completion endpoints");
        expect(JSON.stringify(error)).not.toContain("management-secret");
      }
    }),
  );

  it.effect("rejects cross-origin redirects before forwarding authorization", () =>
    Effect.gen(function* () {
      const execute = vi.fn((request: Parameters<Parameters<typeof HttpClient.make>[0]>[0]) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              status: 302,
              headers: { location: "https://attacker.example/key" },
            }),
          ),
        ),
      );
      const validator = yield* makeOpenRouterKeyValidator().pipe(
        Effect.provideService(HttpClient.HttpClient, HttpClient.make(execute)),
      );

      const error = yield* Effect.flip(validator.validate(Redacted.make("sk-or-secret")));

      expect(error).toMatchObject({ code: "security", retryable: false });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(error)).not.toContain("sk-or-secret");
    }),
  );

  it.effect("rejects malformed current-key JSON without retaining its body", () =>
    Effect.gen(function* () {
      const execute = (request: Parameters<Parameters<typeof HttpClient.make>[0]>[0]) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ data: { label: { secret: "never-log-this" } } }),
          ),
        );
      const validator = yield* makeOpenRouterKeyValidator().pipe(
        Effect.provideService(HttpClient.HttpClient, HttpClient.make(execute)),
      );

      const error = yield* Effect.flip(validator.validate(Redacted.make("sk-or-secret")));

      expect(error).toMatchObject({ code: "response-invalid", retryable: false });
      expect(JSON.stringify(error)).not.toContain("never-log-this");
      expect(JSON.stringify(error)).not.toContain("sk-or-secret");
    }),
  );

  it("masks short and long key labels", () => {
    expect(maskOpenRouterKeyLabel("short")).toBe("••••");
    expect(maskOpenRouterKeyLabel("sk-or-v1-abcdefgh")).toBe("sk-o…efgh");
  });
});
