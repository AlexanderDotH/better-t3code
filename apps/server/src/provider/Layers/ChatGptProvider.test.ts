import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { ChatGptAuthBroker } from "../chatgpt/ChatGptAuthBroker.ts";
import { ChatGptAdapterBoundaryError, type ChatGptAdapterTransport } from "./ChatGptAdapter.ts";
import { checkChatGptProviderStatus } from "./ChatGptProvider.ts";

const authenticatedBroker = {
  status: Effect.succeed({
    status: "authenticated",
    type: "subscription",
    label: "alex@example.com",
    accountId: "account-1",
    capabilities: { flows: ["browser", "device-code"], canDisconnect: true },
    plan: { id: "plus", label: "Plus" },
  }),
} as ChatGptAuthBroker;

describe("ChatGptProvider", () => {
  it.effect("publishes only the connected account's live model catalog", () =>
    Effect.gen(function* () {
      const transport: ChatGptAdapterTransport = {
        rateLimit: Effect.succeed({ status: "limited", retryAfterSeconds: 30 }),
        listModels: Effect.succeed([
          {
            id: "gpt-5.6-codex",
            displayName: "GPT-5.6 Codex",
            contextWindow: 400_000,
            default: true,
            reasoningEfforts: ["medium", "high"],
          },
        ]),
        streamResponse: () => Stream.empty,
        compact: () => Effect.die("not used"),
      };

      const snapshot = yield* checkChatGptProviderStatus(
        { enabled: true },
        authenticatedBroker,
        transport,
      );

      expect(snapshot).toMatchObject({
        displayName: "ChatGPT Subscription",
        badgeLabel: "Early Access",
        status: "ready",
        fetchWorkers: {
          maxRecommendedWorkers: 8,
          commandExecutionPolicy: "deny",
        },
        auth: {
          status: "authenticated",
          accountId: "account-1",
          plan: { id: "plus", label: "Plus" },
        },
        rateLimit: { status: "limited", retryAfterSeconds: 30 },
      });
      expect(snapshot.models.map((model) => model.slug)).toEqual(["gpt-5.6-codex"]);
      expect(snapshot.models[0]?.capabilities.contextWindow).toEqual({
        defaultTokens: 400_000,
        maxTokens: 400_000,
      });
    }),
  );

  it.effect("fails closed without fallback models when live discovery drifts", () =>
    Effect.gen(function* () {
      const transport: ChatGptAdapterTransport = {
        listModels: Effect.fail(
          new ChatGptAdapterBoundaryError({
            operation: "models/list",
            detail: "protocol drift",
          }),
        ),
        streamResponse: () => Stream.empty,
        compact: () => Effect.die("not used"),
      };

      const snapshot = yield* checkChatGptProviderStatus(
        { enabled: true },
        authenticatedBroker,
        transport,
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.models).toEqual([]);
      expect(snapshot.message).toContain("protocol drift");
    }),
  );

  it.effect("keeps connected account state visible while the provider is disabled", () =>
    Effect.gen(function* () {
      let modelCalls = 0;
      const transport: ChatGptAdapterTransport = {
        listModels: Effect.sync(() => {
          modelCalls += 1;
          return [];
        }),
        streamResponse: () => Stream.empty,
        compact: () => Effect.die("not used"),
      };
      const snapshot = yield* checkChatGptProviderStatus(
        { enabled: false },
        authenticatedBroker,
        transport,
      );

      expect(snapshot.status).toBe("disabled");
      expect(snapshot.auth).toMatchObject({
        status: "authenticated",
        accountId: "account-1",
        plan: { label: "Plus" },
      });
      expect(snapshot.models).toEqual([]);
      expect(modelCalls).toBe(0);
    }),
  );
});
