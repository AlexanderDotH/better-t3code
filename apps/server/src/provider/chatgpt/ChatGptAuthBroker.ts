import type {
  ProviderAuthConnectEvent,
  ProviderAuthFailure,
  ProviderAuthFlow,
  ServerProviderAuth,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Encoding from "effect/Encoding";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as CodexClient from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { codexAppServerArgs } from "../CodexProcessArgs.ts";
import type { ChatGptCredentialStore } from "./ChatGptCredentialStore.ts";
import type { ChatGptCredential } from "./ChatGptCredentialStore.ts";

const DEVICE_CODE_EXPIRES_IN_MINUTES = 15;
const DEVICE_CODE_POLL_INTERVAL_SECONDS = 5;
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_CAPABILITIES = {
  flows: ["browser", "device-code"],
  canDisconnect: true,
} as const;
const ChatGptIdentityClaims = Schema.fromJsonString(
  Schema.Struct({
    email: Schema.optionalKey(Schema.String),
    exp: Schema.optionalKey(Schema.Number),
    "https://api.openai.com/auth": Schema.optionalKey(
      Schema.Struct({
        chatgpt_plan_type: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
);
const decodeChatGptIdentityClaims = Schema.decodeUnknownOption(ChatGptIdentityClaims);

export class ChatGptAuthBrokerError extends Schema.TaggedErrorClass<ChatGptAuthBrokerError>()(
  "ChatGptAuthBrokerError",
  {
    operation: Schema.Literals(["spawn", "initialize", "connect", "status", "refresh", "logout"]),
    code: Schema.Literals([
      "authorization-declined",
      "challenge-expired",
      "broker-unavailable",
      "broker-failed",
      "credential-storage-failed",
      "credential-removal-failed",
      "unknown",
    ]),
    reason: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

export type ChatGptAuthChallenge =
  | {
      readonly type: "browser";
      readonly loginId: string;
      readonly authorizationUrl: string;
    }
  | {
      readonly type: "device-code";
      readonly loginId: string;
      readonly verificationUrl: string;
      readonly userCode: string;
    };

export interface ChatGptAuthClient {
  readonly startLogin: (
    flow: ProviderAuthFlow,
  ) => Effect.Effect<ChatGptAuthChallenge, ChatGptAuthBrokerError>;
  readonly waitForLogin: (
    loginId: string,
  ) => Effect.Effect<
    { readonly success: true } | { readonly success: false; readonly error?: string },
    ChatGptAuthBrokerError
  >;
  readonly cancelLogin: (loginId: string) => Effect.Effect<void, never>;
  readonly readAccount: (
    refreshToken: boolean,
  ) => Effect.Effect<CodexSchema.V2GetAccountResponse, ChatGptAuthBrokerError>;
  readonly logout: Effect.Effect<void, ChatGptAuthBrokerError>;
}

export interface ChatGptAuthClientFactory {
  readonly open: Effect.Effect<ChatGptAuthClient, ChatGptAuthBrokerError, Scope.Scope>;
}

export interface ChatGptAuthBroker {
  readonly credentialStore: ChatGptCredentialStore;
  readonly connect: (flow: ProviderAuthFlow) => Stream.Stream<ProviderAuthConnectEvent>;
  readonly status: Effect.Effect<ServerProviderAuth, ChatGptAuthBrokerError>;
  readonly refresh: Effect.Effect<ServerProviderAuth, ChatGptAuthBrokerError>;
  readonly disconnect: Effect.Effect<ServerProviderAuth, ChatGptAuthBrokerError>;
  readonly invalidate: Effect.Effect<ServerProviderAuth, ChatGptAuthBrokerError>;
}

export const chatGptAuthBrokerArgs = (): ReadonlyArray<string> => [
  "-c",
  'cli_auth_credentials_store="file"',
  "-c",
  "mcp_servers={}",
  ...codexAppServerArgs(),
];

const OMITTED_AUTH_ENVIRONMENT_NAMES = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_BASE_URL",
] as const;

export const chatGptAuthBrokerEnvironment = (
  home: string,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const isolated: NodeJS.ProcessEnv = {
    ...environment,
    CODEX_HOME: home,
    CODEX_APP_SERVER_LOGIN_CLIENT_ID: CODEX_OAUTH_CLIENT_ID,
  };
  for (const name of OMITTED_AUTH_ENVIRONMENT_NAMES) delete isolated[name];
  return isolated;
};

const authError = (
  operation: ChatGptAuthBrokerError["operation"],
  code: ChatGptAuthBrokerError["code"],
  reason: string,
  retryable: boolean,
): ChatGptAuthBrokerError => new ChatGptAuthBrokerError({ operation, code, reason, retryable });

const mapClientError = (
  operation: ChatGptAuthBrokerError["operation"],
  reason: string,
  retryable = true,
) => Effect.mapError(() => authError(operation, "broker-failed", reason, retryable));

const planLabel = (plan: string): string => {
  switch (plan) {
    case "prolite":
      return "Pro Lite";
    case "self_serve_business_usage_based":
    case "business":
      return "Business";
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "Enterprise";
    case "edu":
      return "Education";
    default:
      return plan.length === 0 ? "Unknown" : `${plan[0]!.toUpperCase()}${plan.slice(1)}`;
  }
};

const unauthenticated = (): ServerProviderAuth => ({
  status: "unauthenticated",
  type: "subscription",
  label: "ChatGPT Subscription",
  capabilities: AUTH_CAPABILITIES,
});

const authenticated = (input: {
  readonly accountId: string;
  readonly account: Extract<
    NonNullable<CodexSchema.V2GetAccountResponse["account"]>,
    { readonly type: "chatgpt" }
  >;
}): ServerProviderAuth => ({
  status: "authenticated",
  type: "subscription",
  label: "ChatGPT Subscription",
  accountId: input.accountId,
  ...(input.account.email === null ? {} : { email: input.account.email }),
  capabilities: AUTH_CAPABILITIES,
  plan: { id: input.account.planType, label: planLabel(input.account.planType) },
});

const authenticatedFromCredential = (credential: ChatGptCredential): ServerProviderAuth => {
  const payload = Redacted.value(credential.idToken).split(".")[1];
  const decoded = payload ? Encoding.decodeBase64UrlString(payload) : undefined;
  const claims =
    decoded?._tag === "Success"
      ? Option.getOrUndefined(decodeChatGptIdentityClaims(decoded.success))
      : undefined;
  const planType = claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type?.trim();
  const expirationMillis = claims?.exp === undefined ? undefined : claims.exp * 1_000;
  const expiresAt =
    expirationMillis === undefined ||
    !Number.isFinite(expirationMillis) ||
    expirationMillis < 0 ||
    expirationMillis > 8.64e15
      ? undefined
      : DateTime.make(expirationMillis).pipe(Option.map(DateTime.formatIso), Option.getOrUndefined);
  return {
    status: "authenticated",
    type: "subscription",
    label: "ChatGPT Subscription",
    accountId: credential.accountId,
    ...(claims?.email?.trim() ? { email: claims.email.trim() } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    capabilities: AUTH_CAPABILITIES,
    ...(planType ? { plan: { id: planType, label: planLabel(planType) } } : {}),
  };
};

const failureFromError = (error: ChatGptAuthBrokerError): ProviderAuthFailure => ({
  code: error.code,
  reason: error.reason,
  retryable: error.retryable,
});

const classifyCompletionFailure = (message?: string): ProviderAuthConnectEvent => {
  const lower = message?.toLowerCase() ?? "";
  if (lower.includes("cancel")) {
    return { type: "cancelled", reason: "ChatGPT authorization was cancelled" };
  }
  if (lower.includes("expired")) {
    return {
      type: "failed",
      failure: {
        code: "challenge-expired",
        reason: "The ChatGPT authorization challenge expired",
        retryable: true,
      },
    };
  }
  return {
    type: "failed",
    failure: {
      code: "authorization-declined",
      reason: "ChatGPT authorization did not complete",
      retryable: true,
    },
  };
};

const challengeEvent = Effect.fn("chatGptAuthChallengeEvent")(function* (
  challenge: ChatGptAuthChallenge,
): Effect.fn.Return<ProviderAuthConnectEvent> {
  if (challenge.type === "browser") {
    return {
      type: "browserChallenge",
      authorizationUrl: challenge.authorizationUrl,
    };
  }
  const now = yield* DateTime.now;
  return {
    type: "deviceCodeChallenge",
    verificationUrl: challenge.verificationUrl,
    userCode: challenge.userCode,
    expiresAt: DateTime.formatIso(DateTime.add(now, { minutes: DEVICE_CODE_EXPIRES_IN_MINUTES })),
    pollIntervalSeconds: DEVICE_CODE_POLL_INTERVAL_SECONDS,
  };
});

export const makeChatGptAuthBrokerWithClientFactory = (input: {
  readonly credentialStore: ChatGptCredentialStore;
  readonly clientFactory: ChatGptAuthClientFactory;
}): ChatGptAuthBroker => {
  const accountAuth = Effect.fn("ChatGptAuthBroker.accountAuth")(function* (
    client: ChatGptAuthClient,
    refreshToken: boolean,
  ) {
    const response = yield* client.readAccount(refreshToken);
    const account = response.account;
    if (account?.type !== "chatgpt") {
      return yield* authError(
        refreshToken ? "refresh" : "status",
        "broker-failed",
        "ChatGPT subscription authentication is required",
        true,
      );
    }
    const credential = yield* input.credentialStore.read.pipe(
      Effect.mapError(() =>
        authError(
          refreshToken ? "refresh" : "status",
          "credential-storage-failed",
          "ChatGPT credentials could not be read",
          false,
        ),
      ),
    );
    if (Option.isNone(credential)) {
      return yield* authError(
        refreshToken ? "refresh" : "status",
        "credential-storage-failed",
        "ChatGPT credentials were not persisted",
        false,
      );
    }
    return authenticated({ accountId: credential.value.accountId, account });
  });

  const withClient = <A>(
    use: (client: ChatGptAuthClient) => Effect.Effect<A, ChatGptAuthBrokerError>,
  ): Effect.Effect<A, ChatGptAuthBrokerError> =>
    input.clientFactory.open.pipe(Effect.flatMap(use), Effect.scoped);

  const status = input.credentialStore.read.pipe(
    Effect.mapError(() =>
      authError(
        "status",
        "credential-storage-failed",
        "ChatGPT credentials could not be read",
        false,
      ),
    ),
    Effect.flatMap((credential) =>
      Option.isNone(credential)
        ? Effect.succeed(unauthenticated())
        : Effect.succeed(authenticatedFromCredential(credential.value)),
    ),
  );

  const refresh = input.credentialStore.read.pipe(
    Effect.mapError(() =>
      authError(
        "refresh",
        "credential-storage-failed",
        "ChatGPT credentials could not be read",
        false,
      ),
    ),
    Effect.flatMap((credential) =>
      Option.isNone(credential)
        ? Effect.fail(
            authError(
              "refresh",
              "credential-storage-failed",
              "ChatGPT credentials are unavailable",
              false,
            ),
          )
        : withClient((client) => accountAuth(client, true)),
    ),
  );

  const removeCredential = input.credentialStore.remove.pipe(
    Effect.mapError(() =>
      authError(
        "logout",
        "credential-removal-failed",
        "ChatGPT credentials could not be removed",
        true,
      ),
    ),
    Effect.as(unauthenticated()),
  );

  const disconnect = input.credentialStore.read.pipe(
    Effect.mapError(() =>
      authError(
        "logout",
        "credential-storage-failed",
        "ChatGPT credentials could not be read",
        false,
      ),
    ),
    Effect.flatMap((credential) =>
      Option.isNone(credential)
        ? Effect.succeed(unauthenticated())
        : withClient((client) => client.logout).pipe(Effect.andThen(removeCredential)),
    ),
  );

  const connect = (flow: ProviderAuthFlow): Stream.Stream<ProviderAuthConnectEvent> =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* input.credentialStore.prepare.pipe(
          Effect.mapError(() =>
            authError(
              "connect",
              "credential-storage-failed",
              "ChatGPT credential storage could not be prepared",
              false,
            ),
          ),
        );
        const client = yield* input.clientFactory.open;
        const challenge = yield* client.startLogin(flow);
        const settled = yield* Ref.make(false);
        yield* Effect.addFinalizer(() =>
          Ref.get(settled).pipe(
            Effect.flatMap((done) => (done ? Effect.void : client.cancelLogin(challenge.loginId))),
          ),
        );
        const challengeOutput = yield* challengeEvent(challenge);
        const completion = client.waitForLogin(challenge.loginId).pipe(
          Effect.tap(() => Ref.set(settled, true)),
          Effect.flatMap(
            (result): Effect.Effect<ProviderAuthConnectEvent, ChatGptAuthBrokerError> => {
              if (!result.success) return Effect.succeed(classifyCompletionFailure(result.error));
              return accountAuth(client, false).pipe(
                Effect.map((auth): ProviderAuthConnectEvent => ({ type: "connected", auth })),
              );
            },
          ),
        );
        return Stream.fromIterable<ProviderAuthConnectEvent>([
          { type: "starting", flow },
          challengeOutput,
        ]).pipe(Stream.concat(Stream.fromEffect(completion)));
      }),
    ).pipe(
      Stream.scoped,
      Stream.catchTag("ChatGptAuthBrokerError", (error) =>
        Stream.succeed<ProviderAuthConnectEvent>({
          type: "failed",
          failure: failureFromError(error),
        }),
      ),
    );

  return {
    credentialStore: input.credentialStore,
    connect,
    status,
    refresh,
    disconnect,
    invalidate: removeCredential,
  };
};

export interface CodexAppServerAuthClientFactoryOptions {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
}

export const makeCodexAppServerAuthClientFactory = Effect.fn("makeCodexAppServerAuthClientFactory")(
  function* (
    options: CodexAppServerAuthClientFactoryOptions,
    credentialStore: ChatGptCredentialStore,
  ): Effect.fn.Return<ChatGptAuthClientFactory, never, ChildProcessSpawner.ChildProcessSpawner> {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = chatGptAuthBrokerEnvironment(
      credentialStore.home,
      options.environment ?? process.env,
    );

    const open = Effect.gen(function* () {
      const args = chatGptAuthBrokerArgs();
      const command = yield* resolveSpawnCommand(options.binaryPath, args, {
        env: environment,
        extendEnv: true,
      }).pipe(
        Effect.mapError(() =>
          authError("spawn", "broker-unavailable", "Codex auth broker could not be resolved", true),
        ),
      );
      const child = yield* spawner
        .spawn(
          ChildProcess.make(command.command, command.args, {
            cwd: options.cwd,
            env: environment,
            extendEnv: true,
            shell: command.shell,
          }),
        )
        .pipe(
          Effect.mapError(() =>
            authError(
              "spawn",
              "broker-unavailable",
              "Codex auth broker could not be started",
              true,
            ),
          ),
        );
      yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));
      const clientContext = yield* Layer.build(CodexClient.layerChildProcess(child));
      const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
        Effect.provide(clientContext),
      );
      const completions = yield* Queue.unbounded<CodexSchema.V2AccountLoginCompletedNotification>();
      yield* Effect.addFinalizer(() => Queue.shutdown(completions));
      yield* client.handleServerNotification("account/login/completed", (notification) =>
        Queue.offer(completions, notification).pipe(Effect.asVoid),
      );
      yield* client
        .request("initialize", {
          clientInfo: {
            name: "t3code_chatgpt_subscription",
            title: "T3 Code ChatGPT Subscription",
            version: "0.0.1",
          },
          capabilities: { experimentalApi: true },
        })
        .pipe(mapClientError("initialize", "Codex auth broker initialization failed"));
      yield* client
        .notify("initialized", undefined)
        .pipe(mapClientError("initialize", "Codex auth broker initialization failed"));

      const startLogin: ChatGptAuthClient["startLogin"] = (flow) =>
        client
          .request(
            "account/login/start",
            flow === "browser"
              ? {
                  type: "chatgpt",
                  appBrand: "chatgpt",
                  codexStreamlinedLogin: true,
                  useHostedLoginSuccessPage: true,
                }
              : { type: "chatgptDeviceCode" },
          )
          .pipe(
            mapClientError("connect", "Codex auth broker could not start authorization"),
            Effect.flatMap(
              (response): Effect.Effect<ChatGptAuthChallenge, ChatGptAuthBrokerError> => {
                if (response.type === "chatgpt") {
                  return Effect.succeed({
                    type: "browser",
                    loginId: response.loginId,
                    authorizationUrl: response.authUrl,
                  });
                }
                if (response.type === "chatgptDeviceCode") {
                  return Effect.succeed({
                    type: "device-code",
                    loginId: response.loginId,
                    verificationUrl: response.verificationUrl,
                    userCode: response.userCode,
                  });
                }
                return Effect.fail(
                  authError(
                    "connect",
                    "broker-failed",
                    "Codex auth broker returned an unexpected authorization flow",
                    false,
                  ),
                );
              },
            ),
          );

      const waitForLogin: ChatGptAuthClient["waitForLogin"] = Effect.fn(
        "CodexAppServerAuthClient.waitForLogin",
      )(function* (loginId) {
        while (true) {
          const completion = yield* Queue.take(completions);
          if (
            completion.loginId !== null &&
            completion.loginId !== undefined &&
            completion.loginId !== loginId
          ) {
            continue;
          }
          return completion.success
            ? { success: true as const }
            : {
                success: false as const,
                ...(completion.error == null ? {} : { error: completion.error }),
              };
        }
      });

      const cancelLogin: ChatGptAuthClient["cancelLogin"] = (loginId) =>
        client.request("account/login/cancel", { loginId }).pipe(Effect.ignore);
      const readAccount: ChatGptAuthClient["readAccount"] = (refreshToken) =>
        client
          .request("account/read", { refreshToken })
          .pipe(
            mapClientError(
              refreshToken ? "refresh" : "status",
              refreshToken
                ? "Codex auth broker could not refresh ChatGPT credentials"
                : "Codex auth broker could not read the ChatGPT account",
            ),
          );
      const logout = client
        .request("account/logout", undefined)
        .pipe(
          mapClientError("logout", "Codex auth broker could not disconnect ChatGPT"),
          Effect.asVoid,
        );

      return { startLogin, waitForLogin, cancelLogin, readAccount, logout };
    });

    return { open };
  },
);

export const makeChatGptAuthBroker = Effect.fn("makeChatGptAuthBroker")(function* (input: {
  readonly credentialStore: ChatGptCredentialStore;
  readonly binaryPath: string;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
}) {
  const clientFactory = yield* makeCodexAppServerAuthClientFactory(
    {
      binaryPath: input.binaryPath,
      cwd: input.cwd,
      ...(input.environment === undefined ? {} : { environment: input.environment }),
    },
    input.credentialStore,
  );
  return makeChatGptAuthBrokerWithClientFactory({
    credentialStore: input.credentialStore,
    clientFactory,
  });
});
