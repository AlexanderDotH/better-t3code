import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CLAUDE_DRIVER_KIND,
  CODEX_DRIVER_KIND,
  CURSOR_DRIVER_KIND,
  EnvironmentId,
  GROK_DRIVER_KIND,
  OPENCODE_DRIVER_KIND,
  ProviderDriverKind,
  ProviderInstanceId,
  makeBetterT3SettingsV1,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServer } from "effect/unstable/http";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

const environmentId = EnvironmentId.make("environment-1");
const makeFakeHttpServer = (hostname: string, port = 43123) =>
  HttpServer.HttpServer.of({
    address: { _tag: "TcpAddress", hostname, port },
    serve: (() => Effect.void) as HttpServer.HttpServer["Service"]["serve"],
  });
const fakeHttpServer = makeFakeHttpServer("127.0.0.1");
const fakeEnvironment = ServerEnvironment.ServerEnvironment.of({
  getEnvironmentId: Effect.succeed(environmentId),
  getDescriptor: Effect.die("unused"),
});

const makeRegistry = (
  now: () => number,
  httpServer = fakeHttpServer,
  optionalFeature?: "knowledge.graph" | "agent.projectCoordination" | "agent.generalSubagents",
) =>
  McpSessionRegistry.__testing
    .make({
      now,
      livenessWindowMs: 100,
    })
    .pipe(
      Effect.provideService(HttpServer.HttpServer, httpServer),
      Effect.provideService(ServerEnvironment.ServerEnvironment, fakeEnvironment),
      Effect.provide(
        ServerSettings.ServerSettingsService.layerTest(
          optionalFeature
            ? {
                betterT3Environment: makeBetterT3SettingsV1("clean-install", {
                  [optionalFeature]: true,
                }),
              }
            : {},
        ),
      ),
      Effect.provide(NodeServices.layer),
    );

it.effect("stores only a token hash, resolves the bearer token, and revokes by thread", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const threadId = ThreadId.make("thread-1");
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      provider: CODEX_DRIVER_KIND,
    });
    expect(issued.config.endpoint).toBe("http://127.0.0.1:43123/mcp/workspace");
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    expect(token.length).toBeGreaterThan(20);

    const resolved = yield* registry.resolve(token);
    expect(resolved?.threadId).toBe(threadId);

    yield* registry.revokeThread(threadId);
    expect(yield* registry.resolve(token)).toBeUndefined();

    timestamp += 2_000;
  }),
);

it.effect("scopes transient workspace-only credentials to a durable parent thread", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const ownerThreadId = ThreadId.make("fetch:parent-thread:run-1:0");
    const workspaceContextThreadId = ThreadId.make("parent-thread");
    const issued = yield* registry.issue({
      threadId: ownerThreadId,
      workspaceContextThreadId,
      workspaceOnly: true,
      providerInstanceId: ProviderInstanceId.make("codex"),
      provider: CODEX_DRIVER_KIND,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    const resolved = yield* registry.resolve(token);

    expect(issued.config.threadId).toBe(ownerThreadId);
    expect(issued.config.endpoint).toBe("http://127.0.0.1:43123/mcp/workspace-only");
    expect(resolved?.threadId).toBe(workspaceContextThreadId);
    expect(Array.from(resolved?.capabilities ?? [])).toEqual(["workspace"]);
    expect(resolved?.capabilities.has("workspace-write")).toBe(false);

    yield* registry.revokeThread(ownerThreadId);
    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);

it.effect("selects writable workspace profiles only when explicitly authorized", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const cases = [
      [{}, "/mcp/workspace-write"],
      [{ projectMemoryEnabled: false }, "/mcp/workspace-write-no-memory"],
      [{ previewEnabled: false, workspaceOnly: false }, "/mcp/workspace-write-no-preview"],
      [
        { previewEnabled: false, workspaceOnly: false, projectMemoryEnabled: false },
        "/mcp/workspace-write-no-preview-no-memory",
      ],
      [{ previewEnabled: false, workspaceOnly: true }, "/mcp/workspace-write-only"],
      [
        { previewEnabled: false, workspaceOnly: true, projectMemoryEnabled: false },
        "/mcp/workspace-write-only-no-memory",
      ],
    ] as const;

    for (const [profile, endpoint] of cases) {
      const credential = yield* registry.issue({
        threadId: ThreadId.make(`thread-${endpoint}`),
        providerInstanceId: ProviderInstanceId.make("codex"),
        provider: CODEX_DRIVER_KIND,
        workspaceWriteEnabled: true,
        ...profile,
      });
      const token = credential.config.authorizationHeader.replace(/^Bearer\s+/, "");
      const scope = yield* registry.resolve(token);

      expect(credential.config.endpoint).toBe(`http://127.0.0.1:43123${endpoint}`);
      expect(scope?.capabilities.has("workspace")).toBe(true);
      expect(scope?.capabilities.has("workspace-write")).toBe(true);
    }

    const previewOnly = yield* registry.issue({
      threadId: ThreadId.make("thread-grok-write-request"),
      providerInstanceId: ProviderInstanceId.make("grok"),
      provider: GROK_DRIVER_KIND,
      workspaceWriteEnabled: true,
    });
    const previewOnlyToken = previewOnly.config.authorizationHeader.replace(/^Bearer\s+/, "");
    expect(previewOnly.config.endpoint).toBe("http://127.0.0.1:43123/mcp");
    expect((yield* registry.resolve(previewOnlyToken))?.capabilities.has("workspace-write")).toBe(
      false,
    );
  }),
);

it.effect("omits project memory from every workspace profile when it is not activated", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const cases = [
      [{ previewEnabled: false }, "/mcp/workspace-only-no-memory"],
      [{ previewEnabled: false, workspaceOnly: false }, "/mcp/workspace-no-preview-no-memory"],
      [{ previewEnabled: true }, "/mcp/workspace-no-memory"],
    ] as const;

    for (const [profile, endpoint] of cases) {
      const credential = yield* registry.issue({
        threadId: ThreadId.make(`thread-${endpoint}`),
        providerInstanceId: ProviderInstanceId.make("codex"),
        provider: CODEX_DRIVER_KIND,
        projectMemoryEnabled: false,
        ...profile,
      });

      expect(credential.config.endpoint).toBe(`http://127.0.0.1:43123${endpoint}`);
    }
  }),
);

it.effect("builds MCP endpoints from the bound server host", () =>
  Effect.gen(function* () {
    const cases = [
      ["100.64.0.40", "http://100.64.0.40:43123/mcp"],
      ["0.0.0.0", "http://127.0.0.1:43123/mcp"],
      ["localhost", "http://localhost:43123/mcp"],
      ["127.0.0.1", "http://127.0.0.1:43123/mcp"],
    ] as const;

    for (const [hostname, expectedEndpoint] of cases) {
      const registry = yield* makeRegistry(() => 1_000, makeFakeHttpServer(hostname));
      const issued = yield* registry.issue({
        threadId: ThreadId.make(`thread-${hostname}`),
        providerInstanceId: ProviderInstanceId.make("grok"),
        provider: GROK_DRIVER_KIND,
      });
      expect(issued.config.endpoint).toBe(expectedEndpoint);
    }
  }),
);

it.effect("expires credentials once their session stops showing signs of life", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const issued = yield* registry.issue({
      threadId: ThreadId.make("thread-2"),
      providerInstanceId: ProviderInstanceId.make("claude"),
      provider: CLAUDE_DRIVER_KIND,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
    timestamp += 101;
    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);

it.effect("keeps a credential alive across turns that never touch an MCP tool", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const threadId = ThreadId.make("thread-3");
    const issued = yield* registry.issue({
      threadId,
      providerInstanceId: ProviderInstanceId.make("claude"),
      provider: CLAUDE_DRIVER_KIND,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

    // Well past the liveness window in total, but each turn reports in before
    // it lapses — this is the long-session case that used to lose the toolkit.
    for (let turn = 0; turn < 10; turn += 1) {
      timestamp += 99;
      yield* registry.touch(threadId);
    }

    expect((yield* registry.resolve(token))?.threadId).toBe(threadId);
  }),
);

it.effect("does not keep credentials of other threads alive", () =>
  Effect.gen(function* () {
    let timestamp = 1_000;
    const registry = yield* makeRegistry(() => timestamp);
    const issued = yield* registry.issue({
      threadId: ThreadId.make("thread-4"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      provider: CODEX_DRIVER_KIND,
    });
    const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");

    timestamp += 99;
    yield* registry.touch(ThreadId.make("thread-unrelated"));
    timestamp += 2;

    expect(yield* registry.resolve(token)).toBeUndefined();
  }),
);

it.effect("issues workspace credentials only to MCP-capable coding providers", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const cases = [
      [CODEX_DRIVER_KIND, "workspace"],
      [CLAUDE_DRIVER_KIND, "workspace"],
      [CURSOR_DRIVER_KIND, "workspace"],
      [OPENCODE_DRIVER_KIND, "workspace"],
      [GROK_DRIVER_KIND, "preview"],
      [ProviderDriverKind.make("customAgent"), "preview"],
    ] as const;

    for (const [provider, expectedProfile] of cases) {
      const issued = yield* registry.issue({
        threadId: ThreadId.make(`thread-${provider}`),
        providerInstanceId: ProviderInstanceId.make(`instance-${provider}`),
        provider,
      });
      const token = issued.config.authorizationHeader.replace(/^Bearer\s+/, "");
      const resolved = yield* registry.resolve(token);

      expect(
        issued.config.endpoint.endsWith(
          expectedProfile === "workspace" ? "/mcp/workspace" : "/mcp",
        ),
      ).toBe(true);
      expect(resolved?.capabilities.has("preview")).toBe(true);
      expect(resolved?.capabilities.has("workspace")).toBe(expectedProfile === "workspace");
    }
  }),
);

it.effect("uses core Codex tools unless optional groups are explicitly requested", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(() => 1_000);
    const codingThreadId = ThreadId.make("thread-preview-disabled-codex");
    const codingCredential = yield* registry.issue({
      threadId: codingThreadId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      provider: CODEX_DRIVER_KIND,
      previewEnabled: false,
    });
    const codingToken = codingCredential.config.authorizationHeader.replace(/^Bearer\s+/, "");
    const codingScope = yield* registry.resolve(codingToken);

    expect(codingCredential.config.endpoint).toBe("http://127.0.0.1:43123/mcp/workspace-only");
    expect(Array.from(codingScope?.capabilities ?? [])).toEqual(["workspace"]);

    const explicitFullCredential = yield* registry.issue({
      threadId: ThreadId.make("thread-explicit-full-codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      provider: CODEX_DRIVER_KIND,
      previewEnabled: false,
      workspaceOnly: false,
    });
    const explicitFullToken = explicitFullCredential.config.authorizationHeader.replace(
      /^Bearer\s+/,
      "",
    );
    const explicitFullScope = yield* registry.resolve(explicitFullToken);

    expect(explicitFullCredential.config.endpoint).toBe(
      "http://127.0.0.1:43123/mcp/workspace-no-preview",
    );
    expect(Array.from(explicitFullScope?.capabilities ?? [])).toEqual([
      "workspace",
      "coordination",
    ]);

    const nonWorkspaceCredential = yield* registry.issue({
      threadId: ThreadId.make("thread-preview-disabled-grok"),
      providerInstanceId: ProviderInstanceId.make("grok"),
      provider: GROK_DRIVER_KIND,
      previewEnabled: false,
    });
    const nonWorkspaceToken = nonWorkspaceCredential.config.authorizationHeader.replace(
      /^Bearer\s+/,
      "",
    );
    const nonWorkspaceScope = yield* registry.resolve(nonWorkspaceToken);

    expect(nonWorkspaceCredential.config.endpoint).toBe("http://127.0.0.1:43123/mcp/coordination");
    expect(Array.from(nonWorkspaceScope?.capabilities ?? [])).toEqual(["coordination"]);
  }),
);

it.effect("selects the full relevant profile when an optional coding group is enabled", () =>
  Effect.gen(function* () {
    for (const feature of [
      "knowledge.graph",
      "agent.projectCoordination",
      "agent.generalSubagents",
    ] as const) {
      const registry = yield* makeRegistry(() => 1_000, fakeHttpServer, feature);
      const credential = yield* registry.issue({
        threadId: ThreadId.make(`thread-${feature}`),
        providerInstanceId: ProviderInstanceId.make("codex"),
        provider: CODEX_DRIVER_KIND,
        previewEnabled: false,
      });
      expect(credential.config.endpoint).toBe("http://127.0.0.1:43123/mcp/workspace-no-preview");
    }
  }),
);
