import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { makeOpenAiKeyValidator, maskOpenAiKeyLabel } from "./OpenAiKeyValidation.ts";

type Request = Parameters<Parameters<typeof HttpClient.make>[0]>[0];

const response = (request: Request, value: Response) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, value));

describe("OpenAiKeyValidation", () => {
  it.effect("validates against live model discovery and returns only masked metadata", () =>
    Effect.gen(function* () {
      const requests: Array<Request> = [];
      const client = HttpClient.make((request) => {
        requests.push(request);
        return response(
          request,
          Response.json({
            object: "list",
            data: [
              {
                id: "gpt-5.6-sol",
                object: "model",
                created: 1,
                owned_by: "openai",
                shutdown_date: null,
              },
            ],
          }),
        );
      });
      const validator = yield* makeOpenAiKeyValidator().pipe(
        Effect.provideService(HttpClient.HttpClient, client),
      );

      const profile = yield* validator.validate(Redacted.make("sk-proj-1234567890"));

      expect(profile).toEqual({ label: "sk-p…7890", supportedModelCount: 1 });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.headers.authorization).toBe("Bearer sk-proj-1234567890");
      expect(JSON.stringify(profile)).not.toContain("1234567890");
    }),
  );

  it.effect("maps rejected and rate-limited credentials without retaining payloads", () =>
    Effect.gen(function* () {
      for (const status of [401, 429]) {
        const client = HttpClient.make((request) =>
          response(
            request,
            new Response("secret validation body", {
              status,
              headers: status === 429 ? { "retry-after": "11" } : undefined,
            }),
          ),
        );
        const validator = yield* makeOpenAiKeyValidator().pipe(
          Effect.provideService(HttpClient.HttpClient, client),
        );
        const error = yield* Effect.flip(validator.validate(Redacted.make("sk-secret-key")));

        expect(error).toMatchObject(
          status === 401
            ? { code: "credential-invalid", status: 401, retryable: false }
            : { code: "rate-limited", status: 429, retryAfterSeconds: 11, retryable: true },
        );
        expect(JSON.stringify(error)).not.toContain("secret validation body");
        expect(JSON.stringify(error)).not.toContain("sk-secret-key");
      }
    }),
  );

  it("masks short and long key labels", () => {
    expect(maskOpenAiKeyLabel("short")).toBe("••••");
    expect(maskOpenAiKeyLabel("sk-proj-1234567890")).toBe("sk-p…7890");
  });
});
