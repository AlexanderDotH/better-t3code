import { describe, expect, it } from "@effect/vitest";
import type { ServerProviderAuth } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import type { ChatGptAuthBroker } from "./ChatGptAuthBroker.ts";
import type { ChatGptCredential, ChatGptCredentialStore } from "./ChatGptCredentialStore.ts";
import { makeChatGptSubscriptionTransport } from "./ChatGptSubscriptionTransport.ts";

const catalog = {
  models: [
    {
      slug: "gpt-5.6-sol",
      display_name: "GPT 5.6 Sol",
      context_window: 1_000_000,
      default_reasoning_level: "high",
      supported_reasoning_levels: ["low", "high", "max"],
      visibility: "list",
    },
  ],
};

const auth = (status: ServerProviderAuth["status"]): ServerProviderAuth => ({
  status,
  type: "subscription",
  label: "ChatGPT Subscription",
});

const makeHarness = Effect.fn("ChatGptSubscriptionTransport.test.makeHarness")(function* (
  execute: Parameters<typeof HttpClient.make>[0],
) {
  let credential: ChatGptCredential | undefined = {
    accessToken: Redacted.make("old-token"),
    refreshToken: Redacted.make("refresh-token"),
    idToken: Redacted.make("id-token"),
    accountId: "account-123",
  };
  let refreshes = 0;
  let invalidations = 0;
  const store: ChatGptCredentialStore = {
    home: "/isolated/codex-home",
    authFilePath: "/isolated/codex-home/auth.json",
    prepare: Effect.void,
    read: Effect.sync(() => Option.fromNullishOr(credential)),
    remove: Effect.sync(() => {
      credential = undefined;
    }),
  };
  const broker: ChatGptAuthBroker = {
    credentialStore: store,
    connect: () => Stream.empty,
    status: Effect.succeed(auth("authenticated")),
    refresh: Effect.sync(() => {
      refreshes++;
      credential = {
        ...credential!,
        accessToken: Redacted.make("new-token"),
      };
      return auth("authenticated");
    }),
    disconnect: Effect.succeed(auth("unauthenticated")),
    invalidate: Effect.sync(() => {
      invalidations++;
      credential = undefined;
      return auth("unauthenticated");
    }),
  };
  const client = HttpClient.make(execute);
  const transport = yield* makeChatGptSubscriptionTransport({
    credentialStore: store,
    authBroker: broker,
  }).pipe(Effect.provideService(HttpClient.HttpClient, client));
  return {
    transport,
    refreshes: () => refreshes,
    invalidations: () => invalidations,
  };
});

const webResponse = (
  request: Parameters<Parameters<typeof HttpClient.make>[0]>[0],
  response: Response,
) => Effect.succeed(HttpClientResponse.fromWeb(request, response));

describe("ChatGptSubscriptionTransport", () => {
  it.effect("uses only the fixed ChatGPT origin and keeps account credentials in headers", () =>
    Effect.gen(function* () {
      const requests: Array<Parameters<Parameters<typeof HttpClient.make>[0]>[0]> = [];
      const harness = yield* makeHarness((request) => {
        requests.push(request);
        return webResponse(request, Response.json(catalog));
      });

      const models = yield* harness.transport.listModels;
      expect(models[0]?.id).toBe("gpt-5.6-sol");
      expect(requests[0]?.url).toBe(
        "https://chatgpt.com/backend-api/codex/models?client_version=0.0.1",
      );
      expect(requests[0]?.headers.authorization).toBe("Bearer old-token");
      expect(requests[0]?.headers["chatgpt-account-id"]).toBe("account-123");
    }),
  );

  it.effect(
    "coalesces concurrent 401 recovery into one app-server refresh and one retry each",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness((request) =>
          webResponse(
            request,
            request.headers.authorization === "Bearer old-token"
              ? new Response(null, { status: 401 })
              : Response.json(catalog),
          ),
        );

        const results = yield* Effect.all(
          [harness.transport.listModels, harness.transport.listModels],
          { concurrency: "unbounded" },
        );
        expect(results.every((models) => models.length === 1)).toBe(true);
        expect(harness.refreshes()).toBe(1);
      }),
  );

  it.effect("marks the instance unauthenticated after the one allowed retry also returns 401", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness((request) =>
        webResponse(request, new Response(null, { status: 401 })),
      );
      const error = yield* Effect.flip(harness.transport.listModels);
      expect(error._tag).toBe("ChatGptAuthenticationError");
      expect(harness.refreshes()).toBe(1);
      expect(harness.invalidations()).toBe(1);
      expect(JSON.stringify(error)).not.toContain("old-token");
      expect(JSON.stringify(error)).not.toContain("new-token");
    }),
  );

  it.effect("rejects a cross-origin redirect without forwarding authorization", () =>
    Effect.gen(function* () {
      let requests = 0;
      const harness = yield* makeHarness((request) => {
        requests++;
        return webResponse(
          request,
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example/stolen" },
          }),
        );
      });
      const error = yield* Effect.flip(harness.transport.listModels);
      expect(error._tag).toBe("ChatGptTransportSecurityError");
      expect(requests).toBe(1);
    }),
  );

  it.effect("projects retry timing after a subscription rate limit", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness((request) =>
        webResponse(request, new Response(null, { status: 429, headers: { "retry-after": "75" } })),
      );
      const error = yield* Effect.flip(harness.transport.listModels);
      expect(error).toMatchObject({ _tag: "ChatGptRateLimitError", retryAfterSeconds: 75 });
      expect(yield* harness.transport.rateLimit).toEqual({
        status: "exhausted",
        retryAfterSeconds: 75,
        message: "ChatGPT subscription rate limit reached",
      });
    }),
  );

  it.effect("fails compaction with no replacement history instead of falling back locally", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness((request) =>
        webResponse(request, Response.json({ output: [] })),
      );
      const error = yield* Effect.flip(
        harness.transport.compact({ model: "gpt-5.6-sol", input: [{ type: "message" }] }),
      );
      expect(error._tag).toBe("ChatGptCompactionError");
      expect(error.message).toContain("no replacement history");
    }),
  );
});
