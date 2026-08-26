import { describe, expect, it, vi } from "@effect/vitest";
import type { ServerProviderAuth } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import type { ChatGptCredentialStore } from "./ChatGptCredentialStore.ts";
import {
  chatGptAuthBrokerArgs,
  chatGptAuthBrokerEnvironment,
  makeChatGptAuthBrokerWithClientFactory,
  type ChatGptAuthClient,
  type ChatGptAuthClientFactory,
} from "./ChatGptAuthBroker.ts";

const credential = {
  accessToken: Redacted.make("access-secret"),
  refreshToken: Redacted.make("refresh-secret"),
  idToken: Redacted.make(
    `header.${Encoding.encodeBase64Url(
      JSON.stringify({
        email: "alex@example.com",
        exp: 2_000_000_000,
        "https://api.openai.com/auth": { chatgpt_plan_type: "plus" },
      }),
    )}.signature`,
  ),
  accountId: "account-123",
};

const makeHarness = (flow: "browser" | "device-code") => {
  let removed = false;
  const cancelled: Array<string> = [];
  const refreshFlags: Array<boolean> = [];
  const logout = vi.fn();
  const store: ChatGptCredentialStore = {
    home: "/secrets/providers/chatgpt/personal/codex-home",
    authFilePath: "/secrets/providers/chatgpt/personal/codex-home/auth.json",
    prepare: Effect.void,
    read: Effect.sync(() => (removed ? Option.none() : Option.some(credential))),
    remove: Effect.sync(() => {
      removed = true;
    }),
  };
  const account = {
    account: { type: "chatgpt", email: "alex@example.com", planType: "plus" },
    requiresOpenaiAuth: true,
  } as const;
  const client: ChatGptAuthClient = {
    startLogin: (requestedFlow) =>
      Effect.succeed(
        requestedFlow === "browser"
          ? {
              type: "browser" as const,
              loginId: "login-browser",
              authorizationUrl: "https://auth.openai.com/authorize",
            }
          : {
              type: "device-code" as const,
              loginId: "login-device",
              verificationUrl: "https://auth.openai.com/device",
              userCode: "ABCD-EFGH",
            },
      ),
    waitForLogin: () => Effect.succeed({ success: true }),
    cancelLogin: (loginId) => Effect.sync(() => void cancelled.push(loginId)),
    readAccount: (refreshToken) =>
      Effect.sync(() => {
        refreshFlags.push(refreshToken);
        return account;
      }),
    logout: Effect.sync(logout),
  };
  const factory: ChatGptAuthClientFactory = { open: Effect.succeed(client) };
  const broker = makeChatGptAuthBrokerWithClientFactory({
    credentialStore: store,
    clientFactory: factory,
  });
  return { broker, cancelled, refreshFlags, logout, flow };
};

describe("ChatGptAuthBroker", () => {
  it.effect("streams the browser challenge and authenticated account without credentials", () =>
    Effect.gen(function* () {
      const harness = makeHarness("browser");
      const events = yield* harness.broker.connect(harness.flow).pipe(Stream.runCollect);
      expect(Array.from(events)).toEqual([
        { type: "starting", flow: "browser" },
        {
          type: "browserChallenge",
          authorizationUrl: "https://auth.openai.com/authorize",
        },
        {
          type: "connected",
          auth: {
            status: "authenticated",
            type: "subscription",
            label: "ChatGPT Subscription",
            accountId: "account-123",
            email: "alex@example.com",
            capabilities: { flows: ["browser", "device-code"], canDisconnect: true },
            plan: { id: "plus", label: "Plus" },
          },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain("access-secret");
    }),
  );

  it.effect("emits device-code expiry and cancels an unfinished login when the stream closes", () =>
    Effect.gen(function* () {
      const harness = makeHarness("device-code");
      const events = yield* harness.broker
        .connect(harness.flow)
        .pipe(Stream.take(2), Stream.runCollect);
      const challenge = Array.from(events)[1];
      expect(challenge).toMatchObject({
        type: "deviceCodeChallenge",
        verificationUrl: "https://auth.openai.com/device",
        userCode: "ABCD-EFGH",
        pollIntervalSeconds: 5,
      });
      expect((challenge as { expiresAt: string }).expiresAt).toMatch(/Z$/u);
      expect(harness.cancelled).toEqual(["login-device"]);
    }),
  );

  it.effect(
    "uses proactive app-server refresh and removes only the instance credential on logout",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness("browser");
        const auth: ServerProviderAuth = yield* harness.broker.refresh;
        expect(auth.status).toBe("authenticated");
        expect(harness.refreshFlags).toEqual([true]);

        const disconnected = yield* harness.broker.disconnect;
        expect(disconnected.status).toBe("unauthenticated");
        expect(harness.logout).toHaveBeenCalledOnce();
        expect(Option.isNone(yield* harness.broker.credentialStore.read)).toBe(true);
      }),
  );

  it.effect(
    "reads display-safe status from the isolated credential without starting a broker",
    () =>
      Effect.gen(function* () {
        const harness = makeHarness("browser");
        expect(yield* harness.broker.status).toMatchObject({
          status: "authenticated",
          accountId: "account-123",
          email: "alex@example.com",
          plan: { id: "plus", label: "Plus" },
        });
        expect(harness.refreshFlags).toEqual([]);
      }),
  );

  it("forces file-backed credentials and strips ambient OpenAI keys from the broker child", () => {
    expect(chatGptAuthBrokerArgs()).toEqual([
      "-c",
      'cli_auth_credentials_store="file"',
      "app-server",
      "--disable",
      "image_generation",
    ]);
    expect(
      chatGptAuthBrokerEnvironment("/isolated/codex-home", {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "api-secret",
        CODEX_API_KEY: "codex-secret",
        CODEX_APP_SERVER_LOGIN_CLIENT_ID: "wrong-client-id",
        PROJECT_TOKEN: "keep-me",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      PROJECT_TOKEN: "keep-me",
      CODEX_HOME: "/isolated/codex-home",
      CODEX_APP_SERVER_LOGIN_CLIENT_ID: "app_EMoamEEZ73f0CkXaXp7hrann",
    });
  });
});
