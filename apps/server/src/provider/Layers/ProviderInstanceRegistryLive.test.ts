/**
 * Multi-instance validation slices for `ProviderInstanceRegistryLive`.
 *
 * Two axes of the driver/registry refactor are exercised here:
 *
 *  1. **Same driver, many instances** — the "multi-instance codex slice"
 *     describe block below configures two independent `codex` instances and
 *     asserts each gets its own closures and identity. This is the
 *     multi-codex capability the refactor exists to unlock.
 *
 *  2. **Many drivers, one registry** — the "all drivers slice" describe
 *     block below configures one instance of every shipped driver
 *     (`codex`, `chatgpt`, `openrouter`, `openai`, `claudeAgent`, `cursor`, `grok`, `opencode`, `gemini`) in a single
 *     `ProviderInstanceConfigMap` and asserts the registry boots them all
 *     without cross-contamination. This proves the driver SPI is uniform
 *     across every provider — any driver plugs into the registry through
 *     the same `ProviderDriver` value contract.
 *
 * Every instance in these tests is configured with `enabled: false` so the
 * provider-status checks short-circuit to pending/disabled snapshots
 * without trying to spawn real `codex` / `claude` / `agent` / `grok` / `opencode`
 * binaries. That keeps the assertions focused on registry routing
 * behaviour rather than the runtime details of each provider.
 */
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  type ChatGptSettings,
  type ClaudeSettings,
  type CodexSettings,
  type CursorSettings,
  type GeminiSettings,
  type GrokSettings,
  type OpenAiSettings,
  type OpenCodeSettings,
  type OpenRouterSettings,
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as SubagentResourceGovernor from "../../resourceProtection/SubagentResourceGovernor.ts";
import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import { GrokDriver, type GrokDriverEnv } from "../Drivers/GrokDriver.ts";
import { GeminiDriver, type GeminiDriverEnv } from "../Drivers/GeminiDriver.ts";
import { NoOpMcpConfigEngineLayer } from "../../mcp/testUtils.ts";
import { ClaudeDriver, type ClaudeDriverEnv } from "../Drivers/ClaudeDriver.ts";
import { CodexDriver, type CodexDriverEnv } from "../Drivers/CodexDriver.ts";
import { ChatGptDriver, type ChatGptDriverEnv } from "../Drivers/ChatGptDriver.ts";
import { CursorDriver, type CursorDriverEnv } from "../Drivers/CursorDriver.ts";
import { OpenAiDriver, type OpenAiDriverEnv } from "../Drivers/OpenAiDriver.ts";
import { OpenCodeDriver, type OpenCodeDriverEnv } from "../Drivers/OpenCodeDriver.ts";
import { OpenRouterDriver, type OpenRouterDriverEnv } from "../Drivers/OpenRouterDriver.ts";
import * as ModelManifest from "../ModelManifest.ts";
import { OpenCodeRuntimeLive } from "../opencodeRuntime.ts";
import * as WorkspaceContext from "../../workspace/WorkspaceContext.ts";
import * as WorkspaceFileSystem from "../../workspace/WorkspaceFileSystem.ts";
import type { AnyProviderDriver } from "../ProviderDriver.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "./ProviderEventLoggers.ts";
import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
  ),
);

const TestServerSecretStoreLayer = Layer.succeed(
  ServerSecretStore.ServerSecretStore,
  ServerSecretStore.ServerSecretStore.of({
    get: () => Effect.succeed(Option.none()),
    set: () => Effect.void,
    create: () => Effect.void,
    getOrCreateRandom: (_name, bytes) => Effect.succeed(new Uint8Array(bytes)),
    remove: () => Effect.void,
  }),
);

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const BackgroundPolicyAlwaysRunLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  streamChanges: Stream.empty,
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

const makeCodexConfig = (overrides: Partial<CodexSettings>): CodexSettings => ({
  enabled: false,
  binaryPath: "codex",
  homePath: "",
  shadowHomePath: "",
  launchArgs: "",
  customModels: [],
  ...overrides,
});

const makeChatGptConfig = (overrides: Partial<ChatGptSettings>): ChatGptSettings => ({
  enabled: false,
  binaryPath: "codex",
  ...overrides,
});

const makeClaudeConfig = (overrides: Partial<ClaudeSettings>): ClaudeSettings => ({
  enabled: false,
  binaryPath: "claude",
  homePath: "",
  customModels: [],
  launchArgs: "",
  autoCompactWindow: "",
  ...overrides,
});

const makeCursorConfig = (overrides: Partial<CursorSettings>): CursorSettings => ({
  enabled: false,
  binaryPath: "cursor-agent",
  apiEndpoint: "",
  customModels: [],
  ...overrides,
});

const makeGrokConfig = (overrides: Partial<GrokSettings>): GrokSettings => ({
  enabled: false,
  binaryPath: "grok",
  customModels: [],
  ...overrides,
});

const makeGeminiConfig = (overrides: Partial<GeminiSettings>): GeminiSettings => ({
  enabled: false,
  customModels: [],
  ...overrides,
});

const makeOpenCodeConfig = (overrides: Partial<OpenCodeSettings>): OpenCodeSettings => ({
  enabled: false,
  binaryPath: "opencode",
  serverUrl: "",
  serverPassword: "",
  customModels: [],
  ...overrides,
});

const makeOpenRouterConfig = (overrides: Partial<OpenRouterSettings>): OpenRouterSettings => ({
  ...OpenRouterDriver.defaultConfig(),
  ...overrides,
});

const makeOpenAiConfig = (overrides: Partial<OpenAiSettings>): OpenAiSettings => ({
  ...OpenAiDriver.defaultConfig(),
  ...overrides,
});

describe("BUILT_IN_DRIVERS", () => {
  it("registers exactly the native providers in upstream order", () => {
    expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).toEqual([
      ProviderDriverKind.make("codex"),
      ProviderDriverKind.make("chatgpt"),
      ProviderDriverKind.make("openrouter"),
      ProviderDriverKind.make("openai"),
      ProviderDriverKind.make("claudeAgent"),
      ProviderDriverKind.make("cursor"),
      ProviderDriverKind.make("grok"),
      ProviderDriverKind.make("opencode"),
      ProviderDriverKind.make("gemini"),
    ]);
  });
});

describe("deriveProviderInstanceConfigMap", () => {
  it("hydrates exactly the nine native default instances", () => {
    const configMap = deriveProviderInstanceConfigMap(DEFAULT_SERVER_SETTINGS);

    expect(
      Object.entries(configMap).map(([instanceId, config]) => [instanceId, config.driver]),
    ).toEqual([
      ["codex", "codex"],
      ["chatgpt", "chatgpt"],
      ["openrouter", "openrouter"],
      ["openai", "openai"],
      ["claudeAgent", "claudeAgent"],
      ["cursor", "cursor"],
      ["grok", "grok"],
      ["opencode", "opencode"],
      ["gemini", "gemini"],
    ]);
  });
});

describe("ProviderInstanceRegistryLive — multi-instance codex slice", () => {
  // `ServerConfig.layerTest` needs `FileSystem` to materialize its scratch
  // directory. `Layer.merge` just unions requirements, so we have to push
  // `NodeServices.layer` through `Layer.provideMerge` to satisfy that
  // dependency while still surfacing NodeServices to the test body (the
  // codex driver's `create` yields `ChildProcessSpawner` directly).
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "provider-instance-registry-test",
  }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(TestHttpClientLive),
    Layer.provideMerge(NoOpMcpConfigEngineLayer),
    Layer.provideMerge(SubagentResourceGovernor.layer),
    Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
    Layer.provideMerge(ModelManifest.layerTest),
  );

  it.live("boots two independent codex instances from a ProviderInstanceConfigMap", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("codex_personal");
      const workId = ProviderInstanceId.make("codex_work");
      const codexDriverKind = ProviderDriverKind.make("codex");

      const configMap: ProviderInstanceConfigMap = {
        [personalId]: {
          driver: codexDriverKind,
          displayName: "Codex (personal)",
          enabled: false,
          config: makeCodexConfig({
            binaryPath: "/opt/codex-personal/bin/codex",
            homePath: "/home/julius/.codex_personal",
            customModels: ["personal-preview"],
          }),
        },
        [workId]: {
          driver: codexDriverKind,
          displayName: "Codex (work)",
          enabled: false,
          config: makeCodexConfig({
            binaryPath: "/opt/codex-work/bin/codex",
            homePath: "/home/julius/.codex",
            customModels: ["work-preview"],
          }),
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [CodexDriver],
        configMap,
      });

      const instances = yield* registry.listInstances;
      expect(instances.map((instance) => instance.instanceId).toSorted()).toEqual(
        [personalId, workId].toSorted(),
      );
      expect(instances.every((instance) => instance.driverKind === codexDriverKind)).toBe(true);
      expect(instances.map((instance) => instance.displayName).toSorted()).toEqual(
        ["Codex (personal)", "Codex (work)"].toSorted(),
      );

      // Each instance must be retrievable by id and carry its *own* closures.
      const personal = yield* registry.getInstance(personalId);
      const work = yield* registry.getInstance(workId);
      expect(personal).toBeDefined();
      expect(work).toBeDefined();
      expect(personal!.adapter).not.toBe(work!.adapter);
      expect(personal!.textGeneration).not.toBe(work!.textGeneration);
      expect(personal!.snapshot).not.toBe(work!.snapshot);

      // Snapshots identify themselves by instanceId + driver — this is
      // what makes per-instance routing distinguishable downstream.
      const personalSnapshot = yield* personal!.snapshot.getSnapshot;
      expect(personalSnapshot.instanceId).toBe(personalId);
      expect(personalSnapshot.driver).toBe(codexDriverKind);
      expect(personalSnapshot.enabled).toBe(false);
      expect(personalSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(personalSnapshot.continuation?.groupKey).toBe(
        "codex:home:/home/julius/.codex_personal",
      );

      const workSnapshot = yield* work!.snapshot.getSnapshot;
      expect(workSnapshot.instanceId).toBe(workId);
      expect(workSnapshot.driver).toBe(codexDriverKind);
      expect(workSnapshot.enabled).toBe(false);
      expect(workSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(workSnapshot.continuation?.groupKey).toBe("codex:home:/home/julius/.codex");

      // Nothing goes to the unavailable bucket — both drivers are registered.
      const unavailable = yield* registry.listUnavailable;
      expect(unavailable).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("treats an explicit in-config enabled:false as disabling despite the envelope", () =>
    Effect.gen(function* () {
      // Old settings files can carry both flags with conflicting values.
      // The explicit false must win so a user's disable is never undone.
      const staleId = ProviderInstanceId.make("codex_stale");
      const configMap: ProviderInstanceConfigMap = {
        [staleId]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          config: makeCodexConfig({ enabled: false }),
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [CodexDriver],
        configMap,
      });

      const instance = yield* registry.getInstance(staleId);
      expect(instance).toBeDefined();
      expect(instance!.enabled).toBe(false);
      const snapshot = yield* instance!.snapshot.getSnapshot;
      expect(snapshot.enabled).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live(
    "shadows instances whose driver is not registered in this build without failing boot",
    () =>
      Effect.gen(function* () {
        const codexId = ProviderInstanceId.make("codex_main");
        const ghostId = ProviderInstanceId.make("ghost_main");

        const configMap: ProviderInstanceConfigMap = {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: false,
            config: makeCodexConfig({}),
          },
          [ghostId]: {
            driver: ProviderDriverKind.make("ghostDriver"),
            displayName: "A fork-only driver we don't ship",
            enabled: false,
            config: { arbitrary: "payload", preserved: true },
          },
        };

        const { registry } = yield* makeProviderInstanceRegistry({
          drivers: [CodexDriver],
          configMap,
        });

        const instances = yield* registry.listInstances;
        expect(instances).toHaveLength(1);
        expect(instances[0]!.instanceId).toBe(codexId);

        const unavailable = yield* registry.listUnavailable;
        expect(unavailable).toHaveLength(1);
        const ghost = unavailable[0]!;
        expect(ghost.instanceId).toBe(ghostId);
        expect(ghost.driver).toBe("ghostDriver");
        expect(ghost.availability).toBe("unavailable");
        expect(ghost.unavailableReason).toMatch(/ghostDriver/);
      }).pipe(Effect.provide(testLayer)),
  );
});

describe("ProviderInstanceRegistryLive — all drivers slice", () => {
  // All drivers need `NodeServices` (ChildProcessSpawner + FileSystem +
  // Path). `OpenCodeDriver.create` additionally yields `OpenCodeRuntime`
  // at construction time, so we wire `OpenCodeRuntimeLive` into the stack.
  // `OpenCodeRuntimeLive` bundles its own `NetService.layer` via
  // `Layer.provide`, so the only external requirement it still exposes is
  // `ChildProcessSpawner` — resolved here by piping it through
  // `provideMerge(NodeServices.layer)`.
  //
  // The nested `provideMerge`s read bottom-up: `NodeServices.layer`
  // provides `OpenCodeRuntimeLive`'s deps while keeping its own outputs
  // surfaced; that merged layer then provides `ServerConfig.layerTest`'s
  // `FileSystem` dep while keeping everything else surfaced to the test.
  const GeminiWorkspaceLayer = Layer.merge(
    Layer.succeed(
      WorkspaceContext.WorkspaceContext,
      WorkspaceContext.WorkspaceContext.of({
        execute: () => Effect.succeed({ queries: [], reads: [], truncated: false, warnings: [] }),
      }),
    ),
    Layer.succeed(
      WorkspaceFileSystem.WorkspaceFileSystem,
      WorkspaceFileSystem.WorkspaceFileSystem.of({
        readFile: () => Effect.die("unused Gemini workspace read in disabled-driver test"),
        writeFile: () => Effect.die("unused Gemini workspace write in disabled-driver test"),
        editFiles: () => Effect.die("unused Gemini workspace edit in disabled-driver test"),
      }),
    ),
  );
  const infraLayer = OpenCodeRuntimeLive.pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(GeminiWorkspaceLayer),
  );
  const testLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: "provider-instance-registry-all-drivers-test",
  }).pipe(
    Layer.provideMerge(infraLayer),
    Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(TestHttpClientLive),
    Layer.provideMerge(NoOpMcpConfigEngineLayer),
    Layer.provideMerge(TestServerSecretStoreLayer),
    Layer.provideMerge(SubagentResourceGovernor.layer),
    Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
    Layer.provideMerge(ModelManifest.layerTest),
  );

  it.live("boots every shipped driver and isolates multiple OpenRouter instances", () =>
    Effect.gen(function* () {
      const codexId = ProviderInstanceId.make("codex_default");
      const chatGptId = ProviderInstanceId.make("chatgpt_default");
      const openRouterId = ProviderInstanceId.make("openrouter_default");
      const openRouterWorkId = ProviderInstanceId.make("openrouter_work");
      const openAiId = ProviderInstanceId.make("openai_default");
      const claudeId = ProviderInstanceId.make("claude_default");
      const cursorId = ProviderInstanceId.make("cursor_default");
      const grokId = ProviderInstanceId.make("grok_default");
      const openCodeId = ProviderInstanceId.make("opencode_default");
      const geminiId = ProviderInstanceId.make("gemini_default");

      const codexDriverKind = ProviderDriverKind.make("codex");
      const chatGptDriverKind = ProviderDriverKind.make("chatgpt");
      const openRouterDriverKind = ProviderDriverKind.make("openrouter");
      const openAiDriverKind = ProviderDriverKind.make("openai");
      const claudeDriverKind = ProviderDriverKind.make("claudeAgent");
      const cursorDriverKind = ProviderDriverKind.make("cursor");
      const grokDriverKind = ProviderDriverKind.make("grok");
      const openCodeDriverKind = ProviderDriverKind.make("opencode");
      const geminiDriverKind = ProviderDriverKind.make("gemini");

      const configMap: ProviderInstanceConfigMap = {
        [codexId]: {
          driver: codexDriverKind,
          displayName: "Codex",
          enabled: false,
          config: makeCodexConfig({ homePath: "/home/julius/.codex" }),
        },
        [chatGptId]: {
          driver: chatGptDriverKind,
          displayName: "ChatGPT Subscription",
          enabled: false,
          config: makeChatGptConfig({}),
        },
        [openRouterId]: {
          driver: openRouterDriverKind,
          displayName: "OpenRouter",
          enabled: false,
          config: makeOpenRouterConfig({}),
        },
        [openRouterWorkId]: {
          driver: openRouterDriverKind,
          displayName: "OpenRouter Work",
          enabled: false,
          config: makeOpenRouterConfig({
            protocol: "responses",
            customModels: ["@work/preset"],
          }),
        },
        [openAiId]: {
          driver: openAiDriverKind,
          displayName: "OpenAI Responses",
          enabled: false,
          config: makeOpenAiConfig({}),
        },
        [claudeId]: {
          driver: claudeDriverKind,
          displayName: "Claude",
          enabled: false,
          config: makeClaudeConfig({
            homePath: "/home/julius/.claude-work",
            launchArgs: "--verbose",
          }),
        },
        [cursorId]: {
          driver: cursorDriverKind,
          displayName: "Cursor",
          enabled: false,
          config: makeCursorConfig({}),
        },
        [grokId]: {
          driver: grokDriverKind,
          displayName: "Grok",
          enabled: false,
          config: makeGrokConfig({}),
        },
        [openCodeId]: {
          driver: openCodeDriverKind,
          displayName: "OpenCode",
          enabled: false,
          config: makeOpenCodeConfig({}),
        },
        [geminiId]: {
          driver: geminiDriverKind,
          displayName: "Gemini",
          enabled: false,
          config: makeGeminiConfig({}),
        },
      };

      type AllDriverEnv =
        | CodexDriverEnv
        | ChatGptDriverEnv
        | OpenRouterDriverEnv
        | OpenAiDriverEnv
        | ClaudeDriverEnv
        | CursorDriverEnv
        | GeminiDriverEnv
        | GrokDriverEnv
        | OpenCodeDriverEnv;
      const drivers: ReadonlyArray<AnyProviderDriver<AllDriverEnv>> = [
        CodexDriver,
        ChatGptDriver,
        OpenRouterDriver,
        OpenAiDriver,
        ClaudeDriver,
        CursorDriver,
        GrokDriver,
        OpenCodeDriver,
        GeminiDriver,
      ];
      const { registry } = yield* makeProviderInstanceRegistry({
        drivers,
        configMap,
      });

      // Every configured instance must materialize — none downgraded to a
      // shadow snapshot, because every driver in the map is registered.
      const unavailable = yield* registry.listUnavailable;
      expect(unavailable).toEqual([]);

      const instances = yield* registry.listInstances;
      expect(instances).toHaveLength(10);
      expect(instances.map((instance) => instance.instanceId).toSorted()).toEqual(
        [
          codexId,
          chatGptId,
          openRouterId,
          openRouterWorkId,
          openAiId,
          claudeId,
          cursorId,
          grokId,
          openCodeId,
          geminiId,
        ].toSorted(),
      );

      // Instance lookup by id resolves each instance to its own bundle —
      // this is how rest-of-server routes turn/session calls in the new
      // model. Each driver's bundle carries its advertised `driverKind`.
      const codex = yield* registry.getInstance(codexId);
      const chatGpt = yield* registry.getInstance(chatGptId);
      const openRouter = yield* registry.getInstance(openRouterId);
      const openRouterWork = yield* registry.getInstance(openRouterWorkId);
      const openAi = yield* registry.getInstance(openAiId);
      const claude = yield* registry.getInstance(claudeId);
      const cursor = yield* registry.getInstance(cursorId);
      const grok = yield* registry.getInstance(grokId);
      const openCode = yield* registry.getInstance(openCodeId);
      const gemini = yield* registry.getInstance(geminiId);
      expect(codex?.driverKind).toBe(codexDriverKind);
      expect(chatGpt?.driverKind).toBe(chatGptDriverKind);
      expect(openRouter?.driverKind).toBe(openRouterDriverKind);
      expect(openRouterWork?.driverKind).toBe(openRouterDriverKind);
      expect(openAi?.driverKind).toBe(openAiDriverKind);
      expect(claude?.driverKind).toBe(claudeDriverKind);
      expect(cursor?.driverKind).toBe(cursorDriverKind);
      expect(grok?.driverKind).toBe(grokDriverKind);
      expect(openCode?.driverKind).toBe(openCodeDriverKind);
      expect(gemini?.driverKind).toBe(geminiDriverKind);
      expect(codex?.displayName).toBe("Codex");
      expect(chatGpt?.displayName).toBe("ChatGPT Subscription");
      expect(openRouter?.displayName).toBe("OpenRouter");
      expect(openRouterWork?.displayName).toBe("OpenRouter Work");
      expect(openAi?.displayName).toBe("OpenAI Responses");
      expect(openRouterWork?.adapter).not.toBe(openRouter?.adapter);
      expect(openRouterWork?.snapshot).not.toBe(openRouter?.snapshot);
      expect(openRouterWork?.textGeneration).not.toBe(openRouter?.textGeneration);
      expect(openRouterWork?.authentication).not.toBe(openRouter?.authentication);
      expect(claude?.displayName).toBe("Claude");
      expect(cursor?.displayName).toBe("Cursor");
      expect(grok?.displayName).toBe("Grok");
      expect(openCode?.displayName).toBe("OpenCode");
      expect(gemini?.displayName).toBe("Gemini");

      // Every instance owns its own set of closures — no sharing across
      // drivers. `adapter` / `textGeneration` / `snapshot` are all
      // distinct references even when two instances happen to share a
      // trait (e.g. Cursor + others all use a stub-or-real
      // `textGeneration`; they must still be different object values).
      const adapters = [
        codex!.adapter,
        chatGpt!.adapter,
        openRouter!.adapter,
        openRouterWork!.adapter,
        openAi!.adapter,
        claude!.adapter,
        cursor!.adapter,
        grok!.adapter,
        openCode!.adapter,
        gemini!.adapter,
      ];
      expect(new Set(adapters).size).toBe(adapters.length);
      const textGenerations = [
        codex!.textGeneration,
        chatGpt!.textGeneration,
        openRouter!.textGeneration,
        openRouterWork!.textGeneration,
        openAi!.textGeneration,
        claude!.textGeneration,
        cursor!.textGeneration,
        grok!.textGeneration,
        openCode!.textGeneration,
        gemini!.textGeneration,
      ];
      expect(new Set(textGenerations).size).toBe(textGenerations.length);
      const snapshots = [
        codex!.snapshot,
        chatGpt!.snapshot,
        openRouter!.snapshot,
        openRouterWork!.snapshot,
        openAi!.snapshot,
        claude!.snapshot,
        cursor!.snapshot,
        grok!.snapshot,
        openCode!.snapshot,
        gemini!.snapshot,
      ];
      expect(new Set(snapshots).size).toBe(snapshots.length);

      // Snapshots identify themselves by `instanceId` + `driver` so
      // downstream aggregation in `ProviderRegistry` can tell instances
      // apart even when two share a driver. With `enabled: false`, the
      // check short-circuits and we get a disabled/pending snapshot back
      // — that's enough signal to validate the stamping wrapper without
      // spawning real binaries.
      const codexSnapshot = yield* codex!.snapshot.getSnapshot;
      expect(codexSnapshot.instanceId).toBe(codexId);
      expect(codexSnapshot.driver).toBe(codexDriverKind);
      expect(codexSnapshot.enabled).toBe(false);
      expect(codexSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(codexSnapshot.continuation?.groupKey).toBe("codex:home:/home/julius/.codex");

      const chatGptSnapshot = yield* chatGpt!.snapshot.getSnapshot;
      expect(chatGptSnapshot.instanceId).toBe(chatGptId);
      expect(chatGptSnapshot.driver).toBe(chatGptDriverKind);
      expect(chatGptSnapshot.enabled).toBe(false);

      const openRouterSnapshot = yield* openRouter!.snapshot.getSnapshot;
      expect(openRouterSnapshot.instanceId).toBe(openRouterId);
      expect(openRouterSnapshot.driver).toBe(openRouterDriverKind);
      expect(openRouterSnapshot.enabled).toBe(false);
      expect(openRouterSnapshot.nativeSubagents).toBeUndefined();
      expect(openRouterSnapshot.fetchWorkers).toBeUndefined();
      expect(openRouterSnapshot.continuation?.groupKey).toBe(
        `${openRouterDriverKind}:instance:${openRouterId}`,
      );

      const openRouterWorkSnapshot = yield* openRouterWork!.snapshot.getSnapshot;
      expect(openRouterWorkSnapshot.instanceId).toBe(openRouterWorkId);
      expect(openRouterWorkSnapshot.driver).toBe(openRouterDriverKind);
      expect(openRouterWorkSnapshot.enabled).toBe(false);
      expect(openRouterWorkSnapshot.continuation?.groupKey).toBe(
        `${openRouterDriverKind}:instance:${openRouterWorkId}`,
      );

      const openAiSnapshot = yield* openAi!.snapshot.getSnapshot;
      expect(openAiSnapshot.instanceId).toBe(openAiId);
      expect(openAiSnapshot.driver).toBe(openAiDriverKind);
      expect(openAiSnapshot.enabled).toBe(false);
      expect(openAiSnapshot.nativeSubagents).toBeUndefined();
      expect(openAiSnapshot.fetchWorkers).toBeUndefined();
      expect(openAiSnapshot.continuation?.groupKey).toBe(
        `${openAiDriverKind}:instance:${openAiId}`,
      );

      const claudeSnapshot = yield* claude!.snapshot.getSnapshot;
      expect(claudeSnapshot.instanceId).toBe(claudeId);
      expect(claudeSnapshot.driver).toBe(claudeDriverKind);
      expect(claudeSnapshot.enabled).toBe(false);
      expect(claudeSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(claudeSnapshot.continuation?.groupKey).toBe("claude:home:/home/julius/.claude-work");

      const cursorSnapshot = yield* cursor!.snapshot.getSnapshot;
      expect(cursorSnapshot.instanceId).toBe(cursorId);
      expect(cursorSnapshot.driver).toBe(cursorDriverKind);
      expect(cursorSnapshot.enabled).toBe(false);
      expect(cursorSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(cursorSnapshot.continuation?.groupKey).toBe(
        `${cursorDriverKind}:instance:${cursorId}`,
      );

      const grokSnapshot = yield* grok!.snapshot.getSnapshot;
      expect(grokSnapshot.instanceId).toBe(grokId);
      expect(grokSnapshot.driver).toBe(grokDriverKind);
      expect(grokSnapshot.enabled).toBe(false);
      expect(grokSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(grokSnapshot.continuation?.groupKey).toBe(`${grokDriverKind}:instance:${grokId}`);

      const openCodeSnapshot = yield* openCode!.snapshot.getSnapshot;
      expect(openCodeSnapshot.instanceId).toBe(openCodeId);
      expect(openCodeSnapshot.driver).toBe(openCodeDriverKind);
      expect(openCodeSnapshot.enabled).toBe(false);
      expect(openCodeSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(openCodeSnapshot.continuation?.groupKey).toBe(
        `${openCodeDriverKind}:instance:${openCodeId}`,
      );

      const geminiSnapshot = yield* gemini!.snapshot.getSnapshot;
      expect(geminiSnapshot.instanceId).toBe(geminiId);
      expect(geminiSnapshot.driver).toBe(geminiDriverKind);
      expect(geminiSnapshot.enabled).toBe(false);
      expect(geminiSnapshot.fetchWorkers).toEqual({
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      });
      expect(geminiSnapshot.continuation?.groupKey).toBe(
        `${geminiDriverKind}:instance:${geminiId}`,
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("rebuilds only the OpenRouter instance whose protocol settings changed", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("openrouter_personal");
      const workId = ProviderInstanceId.make("openrouter_work");
      const driver = ProviderDriverKind.make("openrouter");
      const initialConfig: ProviderInstanceConfigMap = {
        [personalId]: {
          driver,
          displayName: "OpenRouter Personal",
          enabled: false,
          config: makeOpenRouterConfig({
            protocol: "chat-completions",
            defaultModel: "openai/gpt-5.5",
          }),
        },
        [workId]: {
          driver,
          displayName: "OpenRouter Work",
          enabled: false,
          config: makeOpenRouterConfig({
            protocol: "chat-completions",
            defaultModel: "anthropic/claude-sonnet-4.5",
          }),
        },
      };

      const { registry, mutator } = yield* makeProviderInstanceRegistry({
        drivers: [OpenRouterDriver],
        configMap: initialConfig,
      });
      const personalBefore = yield* registry.getInstance(personalId);
      const workBefore = yield* registry.getInstance(workId);
      expect(personalBefore).toBeDefined();
      expect(workBefore).toBeDefined();

      yield* mutator.reconcile({
        ...initialConfig,
        [personalId]: {
          ...initialConfig[personalId]!,
          config: makeOpenRouterConfig({
            protocol: "responses",
            defaultModel: "openai/gpt-5.5",
          }),
        },
      });

      const personalAfter = yield* registry.getInstance(personalId);
      const workAfter = yield* registry.getInstance(workId);
      expect(personalAfter).toBeDefined();
      expect(workAfter).toBeDefined();
      expect(personalAfter).not.toBe(personalBefore);
      expect(workAfter).toBe(workBefore);

      const personalSnapshot = yield* personalAfter!.snapshot.getSnapshot;
      const workSnapshot = yield* workAfter!.snapshot.getSnapshot;
      expect(personalSnapshot.continuation?.groupKey).toBe(`${driver}:instance:${personalId}`);
      expect(workSnapshot.continuation?.groupKey).toBe(`${driver}:instance:${workId}`);
    }).pipe(Effect.provide(testLayer)),
  );
});
