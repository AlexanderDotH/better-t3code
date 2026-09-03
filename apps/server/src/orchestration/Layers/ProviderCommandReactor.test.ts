// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  type ChatAttachment,
  ModelSelection,
  type OrchestrationSession,
  type OrchestrationSubagentSummary,
  type OrchestrationThreadActivity,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  RuntimeSessionId,
  type ServerProvider,
  type ProviderTurnStartResult,
  type ProjectMemoryReadResponse,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  ApprovalRequestId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  SubagentId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { deriveServerPaths, ServerConfig } from "../../config.ts";
import { TextGenerationError } from "@t3tools/contracts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { makeProviderRegistryLayer } from "../../provider/testUtils/providerRegistryMock.ts";
import { TextGeneration, type TextGenerationShape } from "../../textGeneration/TextGeneration.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import {
  providerErrorLabel,
  providerErrorLabelFromInstanceHint,
  applyFetchContextToProviderInput,
  remainingFetchContextChars,
  ProviderCommandReactorLive,
} from "./ProviderCommandReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TurnAbortCoordinator } from "../Services/TurnAbortCoordinator.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import { ServerSettingsService } from "../../serverSettings.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";
import { NoOpSkillEngineLayer } from "../../skills/testUtils/NoOpSkillEngine.ts";
import { PROJECT_AGENT_COORDINATION_INSTRUCTIONS } from "../../projectAgent/ProjectAgentInstructions.ts";
import { ProjectMemoryStore } from "../../projectMemory/ProjectMemoryStore.ts";
import {
  FetchWorkerCoordinator,
  type FetchRunInput,
  type FetchRunResult,
} from "../../fetch/FetchWorkerCoordinator.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asApprovalRequestId = (value: string): ApprovalRequestId => ApprovalRequestId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const coordinatedProviderInput = (input: string) =>
  `${PROJECT_AGENT_COORDINATION_INSTRUCTIONS}\n\n${input}`;

function fetchProviderFixture(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly models: ReadonlyArray<string>;
  readonly maxRecommendedWorkers?: number;
  readonly enabled?: boolean;
}): ServerProvider {
  const driver = ProviderDriverKind.make(input.driver);
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver,
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    fetchWorkers: {
      maxRecommendedWorkers: input.maxRecommendedWorkers ?? 8,
      commandExecutionPolicy: "deny",
    },
    models: input.models.map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: null,
    })),
    slashCommands: [],
    skills: [],
  };
}

function codexAutoReasoningProviderFixture(model: string): ServerProvider {
  const provider = fetchProviderFixture({
    instanceId: "codex",
    driver: "codex",
    models: [model],
  });
  return {
    ...provider,
    models: [
      {
        slug: model,
        name: model,
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              label: "Reasoning effort",
              type: "select",
              options: ["low", "medium", "high", "xhigh"].map((effort) => ({
                id: effort,
                label: effort,
              })),
            },
            {
              id: "serviceTier",
              label: "Service tier",
              type: "select",
              options: ["default", "priority"].map((tier) => ({
                id: tier,
                label: tier,
              })),
            },
          ],
        },
      },
    ],
  };
}

const deriveServerPathsSync = (baseDir: string, devUrl: URL | undefined) =>
  Effect.runSync(deriveServerPaths(baseDir, devUrl).pipe(Effect.provide(NodeServices.layer)));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<void> => {
    if (await predicate()) {
      return;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await Effect.runPromise(Effect.yieldNow);
    return poll();
  };

  return poll();
}

describe("ProviderCommandReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    | OrchestrationEngineService
    | ProviderCommandReactor
    | ProjectionSnapshotQuery
    | ServerSettingsService,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const createdStateDirs = new Set<string>();
  const createdBaseDirs = new Set<string>();

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    for (const stateDir of createdStateDirs) {
      NodeFS.rmSync(stateDir, { recursive: true, force: true });
    }
    createdStateDirs.clear();
    for (const baseDir of createdBaseDirs) {
      NodeFS.rmSync(baseDir, { recursive: true, force: true });
    }
    createdBaseDirs.clear();
  });

  describe("provider error attribution", () => {
    it("uses the current provider instance slug when current instance lookup fails", () => {
      expect(
        providerErrorLabelFromInstanceHint({
          instanceId: "codex_personal",
          modelSelectionInstanceId: "codex",
          sessionProvider: "codex",
        }),
      ).toBe("codex_personal");
    });

    it("uses the desired provider instance slug when desired instance lookup fails", () => {
      expect(
        providerErrorLabelFromInstanceHint({
          instanceId: "claude_openrouter",
        }),
      ).toBe("claude_openrouter");
    });

    it("uses the unknown driver kind when the resolved driver is not registered locally", () => {
      expect(providerErrorLabel("third_party_driver")).toBe("third_party_driver");
    });
  });

  describe("Fetch context input budgeting", () => {
    it("appends collected Fetch evidence without changing the main request", () => {
      expect(
        applyFetchContextToProviderInput({
          providerInput: "implement the change",
          fetchContext: "T3 FETCH CONTEXT\nworker evidence",
        }),
      ).toEqual({
        providerInput: "implement the change\n\nT3 FETCH CONTEXT\nworker evidence",
        outcome: "included",
      });
    });

    it("truncates only Fetch context when the provider input budget is tight", () => {
      const providerInput = "u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 80);
      const result = applyFetchContextToProviderInput({
        providerInput,
        fetchContext: `T3 FETCH CONTEXT\n${"e".repeat(500)}`,
      });

      expect(result.providerInput?.startsWith(providerInput)).toBe(true);
      expect(result.providerInput).toHaveLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
      expect(result.providerInput).toContain("[T3 Fetch context truncated]");
      expect(result.outcome).toBe("truncated");
    });

    it("omits Fetch context when the main request already consumes the full budget", () => {
      const providerInput = "u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
      expect(
        applyFetchContextToProviderInput({
          providerInput,
          fetchContext: "T3 FETCH CONTEXT\nworker evidence",
        }),
      ).toEqual({
        providerInput,
        outcome: "omitted",
      });
    });

    it("passes the coordinator the actual remaining budget capped at 64,000 characters", () => {
      expect(remainingFetchContextChars("short request")).toBe(64_000);
      expect(remainingFetchContextChars("u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS - 100))).toBe(
        98,
      );
      expect(remainingFetchContextChars("u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS))).toBe(0);
    });
  });

  async function createHarness(input?: {
    readonly baseDir?: string;
    readonly threadModelSelection?: ModelSelection;
    readonly sessionModelSwitch?: "unsupported" | "in-session";
    readonly requiresNewThreadForModelChange?: boolean;
    readonly titleRegenerationCompletionDispatchFailures?: number;
    readonly titleRegenerationBeforeStart?: "one" | "two";
    readonly activeProjectPeerBeforeStart?: boolean;
    readonly projectedSessionBeforeStart?: {
      readonly status: OrchestrationSession["status"];
      readonly providerName?: string | null;
      readonly providerInstanceId?: ProviderInstanceId;
      readonly runtimeSessionId?: OrchestrationSession["runtimeSessionId"];
      readonly runtimeMode?: OrchestrationSession["runtimeMode"];
      readonly activeTurnId?: OrchestrationSession["activeTurnId"];
      readonly abortState?: OrchestrationSession["abortState"];
      readonly lastError?: string | null;
      readonly updatedAt?: string;
      readonly partialAssistantMessage?: {
        readonly id: MessageId;
        readonly text: string;
        readonly attachments: ReadonlyArray<ChatAttachment>;
        readonly turnId?: TurnId | null;
      };
    };
    readonly projectedSubagentsBeforeStart?: ReadonlyArray<OrchestrationSubagentSummary>;
    readonly projectedActivitiesBeforeStart?: ReadonlyArray<OrchestrationThreadActivity>;
    readonly seedMatchingLiveProviderSession?: boolean;
    readonly interruptTurnEffect?: () => Effect.Effect<void, ProviderAdapterRequestError>;
    readonly stopSessionEffect?: () => Effect.Effect<void, ProviderAdapterRequestError>;
    readonly startSessionEffect?: (
      session: ProviderSession,
    ) => Effect.Effect<ProviderSession, ProviderAdapterRequestError>;
    readonly providerSnapshots?: ReadonlyArray<ServerProvider>;
    readonly fetchModelSelection?: ModelSelection | null;
    readonly runFetchEffect?: (input: FetchRunInput) => Effect.Effect<FetchRunResult>;
    readonly fetchHandoffAllowed?: boolean;
    readonly fetchInterruptHandled?: boolean;
    readonly forkBeforeStart?: boolean;
    readonly forkProviderCursor?: {
      readonly providerThreadId: string;
      readonly providerTurnId: string;
    };
    readonly forkSessionEffect?: (
      input: Parameters<ProviderServiceShape["forkSession"]>[0],
    ) => Effect.Effect<ProviderSession, ProviderAdapterRequestError>;
    readonly forkSourceUserText?: string;
    readonly serverSettings?: Parameters<typeof ServerSettingsService.layerTest>[0];
    readonly sendTurnEffect?: (
      execution: number,
    ) => Effect.Effect<ProviderTurnStartResult, ProviderAdapterRequestError>;
    readonly projectMemoryRead?: ProjectMemoryReadResponse;
    readonly decideAutoReasoningEffect?: TextGenerationShape["decideAutoReasoning"];
  }) {
    const now = "2026-01-01T00:00:00.000Z";
    const baseDir =
      input?.baseDir ?? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-reactor-"));
    createdBaseDirs.add(baseDir);
    const { stateDir } = deriveServerPathsSync(baseDir, undefined);
    createdStateDirs.add(stateDir);
    const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    let nextSessionIndex = 1;
    const runtimeSessions: Array<ProviderSession> = [];
    const modelSelection = input?.threadModelSelection ?? {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    };
    const startSessionEffect = input?.startSessionEffect;
    const startSession = vi.fn((_: unknown, input: unknown) => {
      const sessionIndex = nextSessionIndex++;
      const resumeCursor =
        typeof input === "object" && input !== null && "resumeCursor" in input
          ? input.resumeCursor
          : undefined;
      const threadId =
        typeof input === "object" &&
        input !== null &&
        "threadId" in input &&
        typeof input.threadId === "string"
          ? ThreadId.make(input.threadId)
          : ThreadId.make(`thread-${sessionIndex}`);
      const inputModelSelection =
        typeof input === "object" && input !== null && "modelSelection" in input
          ? (input.modelSelection as ModelSelection | undefined)
          : undefined;
      const providerInstanceId =
        typeof input === "object" && input !== null && "providerInstanceId" in input
          ? (input.providerInstanceId as ProviderInstanceId | undefined)
          : inputModelSelection?.instanceId;
      const provider =
        typeof input === "object" &&
        input !== null &&
        "provider" in input &&
        typeof input.provider === "string"
          ? (input.provider as ProviderSession["provider"])
          : ProviderDriverKind.make(inputModelSelection?.instanceId ?? modelSelection.instanceId);
      const session: ProviderSession = {
        provider,
        ...(providerInstanceId ? { providerInstanceId } : {}),
        status: "ready" as const,
        runtimeMode:
          typeof input === "object" &&
          input !== null &&
          "runtimeMode" in input &&
          (input.runtimeMode === "approval-required" || input.runtimeMode === "full-access")
            ? input.runtimeMode
            : "full-access",
        ...(typeof input === "object" &&
        input !== null &&
        "cwd" in input &&
        typeof input.cwd === "string"
          ? { cwd: input.cwd }
          : {}),
        ...((inputModelSelection?.model ?? modelSelection.model)
          ? { model: inputModelSelection?.model ?? modelSelection.model }
          : {}),
        threadId,
        resumeCursor: resumeCursor ?? { opaque: `resume-${sessionIndex}` },
        createdAt: now,
        updatedAt: now,
      };
      return (startSessionEffect?.(session) ?? Effect.succeed(session)).pipe(
        Effect.tap((startedSession) =>
          Effect.sync(() => {
            runtimeSessions.push(startedSession);
          }),
        ),
      );
    });
    let sendTurnExecutions = 0;
    const sendTurn = vi.fn((_: unknown) =>
      Effect.suspend(() => {
        sendTurnExecutions += 1;
        return (
          input?.sendTurnEffect?.(sendTurnExecutions) ??
          Effect.succeed({
            threadId: ThreadId.make("thread-1"),
            turnId: asTurnId(`turn-${sendTurnExecutions}`),
          })
        );
      }),
    );
    const interruptTurn = vi.fn((_: unknown) => input?.interruptTurnEffect?.() ?? Effect.void);
    const requestAbort = vi.fn<TurnAbortCoordinator["Service"]["requestAbort"]>(() => Effect.void);
    const respondToRequest = vi.fn<ProviderServiceShape["respondToRequest"]>(() => Effect.void);
    const respondToUserInput = vi.fn<ProviderServiceShape["respondToUserInput"]>(() => Effect.void);
    const stopSession = vi.fn((stopInput: unknown) =>
      (input?.stopSessionEffect?.() ?? Effect.void).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const threadId =
              typeof stopInput === "object" && stopInput !== null && "threadId" in stopInput
                ? (stopInput as { threadId?: ThreadId }).threadId
                : undefined;
            if (!threadId) {
              return;
            }
            const index = runtimeSessions.findIndex((session) => session.threadId === threadId);
            if (index >= 0) {
              runtimeSessions.splice(index, 1);
            }
          }),
        ),
      ),
    );
    const renameBranch = vi.fn((input: unknown) =>
      Effect.succeed({
        branch:
          typeof input === "object" &&
          input !== null &&
          "newBranch" in input &&
          typeof input.newBranch === "string"
            ? input.newBranch
            : "renamed-branch",
      }),
    );
    const pruneWorktrees = vi.fn((_: { readonly cwd: string }) => Effect.void);
    const createWorktree = vi.fn(
      (input: { readonly refName: string; readonly path: string | null }) =>
        Effect.succeed({ worktree: { path: input.path ?? "", refName: input.refName } }),
    );
    const refreshStatus = vi.fn((_: string) =>
      Effect.succeed({
        isRepo: true,
        hasPrimaryRemote: true,
        isDefaultRef: false,
        refName: "renamed-branch",
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
    );
    const generateBranchName = vi.fn<TextGenerationShape["generateBranchName"]>((_) =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateBranchName",
          detail: "disabled in test harness",
        }),
      ),
    );
    const generateThreadMetadata = vi.fn<TextGenerationShape["generateThreadMetadata"]>((_) =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateThreadMetadata",
          detail: "disabled in test harness",
        }),
      ),
    );
    const generateThreadTitle = vi.fn<TextGenerationShape["generateThreadTitle"]>((_) =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "disabled in test harness",
        }),
      ),
    );
    const decideAutoReasoning = vi.fn<TextGenerationShape["decideAutoReasoning"]>(
      (request) =>
        input?.decideAutoReasoningEffect?.(request) ??
        Effect.fail(
          new TextGenerationError({
            operation: "decideAutoReasoning",
            detail: "disabled in test harness",
          }),
        ),
    );
    const defaultDriver = ProviderDriverKind.make(
      String(modelSelection.instanceId).startsWith("claude")
        ? "claudeAgent"
        : String(modelSelection.instanceId).startsWith("codex")
          ? "codex"
          : String(modelSelection.instanceId),
    );
    const defaultModelSlugs = [
      modelSelection.model,
      ...(defaultDriver === ProviderDriverKind.make("codex")
        ? ["gpt-5.3-codex-spark", "gpt-5.6-luna"]
        : []),
    ].filter((slug, index, all) => all.indexOf(slug) === index);
    const providerSnapshots: ReadonlyArray<ServerProvider> = input?.providerSnapshots ?? [
      {
        instanceId: modelSelection.instanceId,
        driver: defaultDriver,
        enabled: true,
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: now,
        nativeSubagents: {
          toolName: "spawn_agent",
          maxRecommendedSubagents: 8,
        },
        fetchWorkers: {
          maxRecommendedWorkers: 8,
          commandExecutionPolicy: "deny",
        },
        ...(input?.requiresNewThreadForModelChange === true
          ? { requiresNewThreadForModelChange: true }
          : {}),
        models: defaultModelSlugs.map((slug) => ({
          slug,
          name: slug,
          isCustom: false,
          capabilities: null,
        })),
        slashCommands: [],
        skills: [],
      },
    ];

    const runFetch = vi.fn((fetchInput: FetchRunInput) =>
      input?.runFetchEffect
        ? input.runFetchEffect(fetchInput)
        : Effect.succeed({
            runId: "fetch-run-1",
            status: "skipped" as const,
            warnings: [],
            plannedWorkers: 0,
            completedWorkers: 0,
            successfulWorkers: 0,
            providerInstanceId: fetchInput.modelSelection.instanceId,
            providerDriver: fetchInput.providerDriver,
            modelSelection: fetchInput.modelSelection,
          }),
    );
    const fetchHandoffInputs: Array<{ readonly threadId: ThreadId; readonly runId: string }> = [];
    const handoffToMain: FetchWorkerCoordinator["Service"]["handoffToMain"] = (
      handoffInput,
      sendMainEffect,
    ) => {
      fetchHandoffInputs.push(handoffInput);
      return input?.fetchHandoffAllowed === false
        ? Effect.succeed(false)
        : sendMainEffect.pipe(Effect.as(true));
    };
    const requestFetchInterrupt = vi.fn<FetchWorkerCoordinator["Service"]["requestInterrupt"]>(() =>
      Effect.succeed(input?.fetchInterruptHandled ?? false),
    );
    const serverSettingsLayer = ServerSettingsService.layerTest({
      ...input?.serverSettings,
      ...(input?.fetchModelSelection !== undefined
        ? { fetchModelSelection: input.fetchModelSelection }
        : {}),
    });
    const readProjectMemory = vi.fn(() =>
      Effect.succeed(
        input?.projectMemoryRead ?? {
          mode: "provider" as const,
          storage: null,
          entries: [],
          markdown: "",
          tokenBudget: 2_560,
          estimatedTokens: 0,
          truncated: false,
        },
      ),
    );

    const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
    const forkSession = vi.fn((forkInput: Parameters<ProviderServiceShape["forkSession"]>[0]) =>
      (input?.forkSessionEffect?.(forkInput) ?? unsupported()).pipe(
        Effect.tap((session) =>
          Effect.sync(() => {
            runtimeSessions.push(session);
          }),
        ),
      ),
    );
    const service: ProviderServiceShape = {
      startSession: startSession as ProviderServiceShape["startSession"],
      forkSession,
      startTransientSession: () => unsupported(),
      sendTurn: sendTurn as ProviderServiceShape["sendTurn"],
      compactThread: () => Effect.void,
      interruptTurn: interruptTurn as ProviderServiceShape["interruptTurn"],
      resolveAbortTarget: () => unsupported(),
      interruptAbortTarget: () => unsupported(),
      forceStopAbortTarget: () => unsupported(),
      isAbortTargetCurrent: () => Effect.succeed(false),
      respondToRequest: respondToRequest as ProviderServiceShape["respondToRequest"],
      respondToUserInput: respondToUserInput as ProviderServiceShape["respondToUserInput"],
      stopSession: stopSession as ProviderServiceShape["stopSession"],
      stopTransientSession: () => unsupported(),
      listSessions: () => Effect.succeed(runtimeSessions),
      getCapabilities: (_provider) =>
        Effect.succeed({
          sessionModelSwitch: input?.sessionModelSwitch ?? "in-session",
          mcp: "unsupported",
        }),
      getInstanceInfo: (instanceId) => {
        const raw = String(instanceId);
        const driverKind = ProviderDriverKind.make(
          raw.startsWith("claude") ? "claudeAgent" : raw.startsWith("codex") ? "codex" : raw,
        );
        return Effect.succeed({
          instanceId,
          driverKind,
          displayName: undefined,
          enabled: true,
          continuationIdentity: {
            driverKind,
            continuationKey:
              driverKind === ProviderDriverKind.make("codex")
                ? "codex:home:/shared-codex"
                : `${driverKind}:instance:${instanceId}`,
          },
        });
      },
      rollbackConversation: () => unsupported(),
      uploadFeedback: () => unsupported(),
      get streamEvents() {
        return Stream.fromPubSub(runtimeEventPubSub);
      },
    };

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
    );
    let titleRegenerationCompletionDispatchAttempts = 0;
    const reactorOrchestrationLayer = Layer.effect(
      OrchestrationEngineService,
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        return {
          readEvents: engine.readEvents,
          dispatch: (command) => {
            if (command.type === "thread.title.regeneration.complete") {
              titleRegenerationCompletionDispatchAttempts += 1;
              if (
                titleRegenerationCompletionDispatchAttempts <=
                (input?.titleRegenerationCompletionDispatchFailures ?? 0)
              ) {
                return Effect.die(new Error("Injected title regeneration completion failure"));
              }
            }
            return engine.dispatch(command);
          },
          get streamDomainEvents() {
            return engine.streamDomainEvents;
          },
          latestSequence: engine.latestSequence,
        } satisfies OrchestrationEngineService["Service"];
      }),
    ).pipe(Layer.provide(orchestrationLayer));
    const layer = ProviderCommandReactorLive.pipe(
      Layer.provideMerge(reactorOrchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(Layer.succeed(ProviderService, service)),
      Layer.provideMerge(
        Layer.succeed(TurnAbortCoordinator, {
          requestAbort,
          settleCooperative: () => Effect.succeed(false),
        }),
      ),
      Layer.provideMerge(
        Layer.succeed(FetchWorkerCoordinator, {
          run: runFetch,
          handoffToMain,
          requestInterrupt: requestFetchInterrupt,
          hasActiveRun: () => Effect.succeed(false),
        }),
      ),
      Layer.provideMerge(makeProviderRegistryLayer(providerSnapshots)),
      Layer.provideMerge(
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          renameBranch,
          pruneWorktrees,
          createWorktree,
        } satisfies Partial<GitWorkflowService.GitWorkflowService["Service"]>),
      ),
      Layer.provideMerge(
        Layer.succeed(VcsStatusBroadcaster, {
          getStatus: () => Effect.die("getStatus should not be called in this test"),
          refreshLocalStatus: () =>
            Effect.die("refreshLocalStatus should not be called in this test"),
          refreshStatus,
          streamStatus: () => Stream.die("streamStatus should not be called in this test"),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(TextGeneration, {
          decideAutoReasoning,
          generateBranchName,
          generateThreadMetadata,
          generateThreadTitle,
        }),
      ),
      Layer.provideMerge(NoOpSkillEngineLayer),
      Layer.provideMerge(Layer.mock(ProjectMemoryStore)({ read: readProjectMemory })),
      Layer.provideMerge(serverSettingsLayer),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
      Layer.provideMerge(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const reactor = await runtime.runPromise(Effect.service(ProviderCommandReactor));
    const serverSettings = await runtime.runPromise(Effect.service(ServerSettingsService));
    const runEffect = <A, E>(effect: Effect.Effect<A, E>) => runtime!.runPromise(effect);

    await runEffect(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Provider Project",
        workspaceRoot: "/tmp/provider-project",
        defaultModelSelection: modelSelection,
        createdAt: now,
      }),
    );
    if (input?.forkBeforeStart === true) {
      const sourceThreadId = ThreadId.make("source-thread-1");
      await runEffect(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-source-thread-create"),
          threadId: sourceThreadId,
          projectId: asProjectId("project-1"),
          title: "Source Thread",
          modelSelection: modelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      );
      const sourceTurnId = asTurnId("source-provider-turn");
      if (input.forkProviderCursor !== undefined) {
        await runEffect(
          engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("cmd-source-session-running"),
            threadId: sourceThreadId,
            session: {
              threadId: sourceThreadId,
              status: "running",
              providerName: "codex",
              providerInstanceId: modelSelection.instanceId,
              runtimeSessionId: null,
              runtimeMode: "approval-required",
              activeTurnId: sourceTurnId,
              providerForkCursor: input.forkProviderCursor,
              abortState: null,
              lastError: null,
              updatedAt: now,
            },
            createdAt: now,
          }),
        );
      }
      await runEffect(
        engine.dispatch({
          type: "thread.message.import",
          commandId: CommandId.make("cmd-source-user-import"),
          threadId: sourceThreadId,
          message: {
            id: asMessageId("source-user-message"),
            role: "user",
            text: input.forkSourceUserText ?? "source question with image",
            attachments: [
              {
                type: "image",
                id: "source-image",
                name: "source.png",
                mimeType: "image/png",
                sizeBytes: 32,
              },
            ],
            turnId: input.forkProviderCursor === undefined ? null : sourceTurnId,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      await runEffect(
        engine.dispatch({
          type: "thread.message.import",
          commandId: CommandId.make("cmd-source-assistant-import"),
          threadId: sourceThreadId,
          message: {
            id: asMessageId("source-assistant-message"),
            role: "assistant",
            text: "source completed answer",
            attachments: [],
            turnId: input.forkProviderCursor === undefined ? null : sourceTurnId,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      if (input.forkProviderCursor !== undefined) {
        await runEffect(
          engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("cmd-source-session-ready"),
            threadId: sourceThreadId,
            session: {
              threadId: sourceThreadId,
              status: "ready",
              providerName: "codex",
              providerInstanceId: modelSelection.instanceId,
              runtimeSessionId: null,
              runtimeMode: "approval-required",
              activeTurnId: null,
              providerForkCursor: input.forkProviderCursor,
              abortState: null,
              lastError: null,
              updatedAt: now,
            },
            createdAt: now,
          }),
        );
      }
      await runEffect(
        engine.dispatch({
          type: "thread.fork",
          commandId: CommandId.make("cmd-thread-fork"),
          threadId: ThreadId.make("thread-1"),
          sourceThreadId,
          boundary: {
            kind: "message",
            messageId: asMessageId("source-assistant-message"),
          },
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          workspace: {
            mode: "local",
            baseBranch: null,
            startFromOrigin: false,
            runSetupScript: false,
          },
          createdAt: now,
        }),
      );
    } else {
      await runEffect(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create"),
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: modelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      );
    }
    if (
      input?.titleRegenerationBeforeStart === "two" ||
      input?.activeProjectPeerBeforeStart === true
    ) {
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create-2"),
          threadId: ThreadId.make("thread-2"),
          projectId: asProjectId("project-1"),
          title: "Thread 2",
          modelSelection: modelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      );
    }
    const titleRegenerationThreadIds =
      input?.titleRegenerationBeforeStart === "two"
        ? [ThreadId.make("thread-1"), ThreadId.make("thread-2")]
        : input?.titleRegenerationBeforeStart === "one"
          ? [ThreadId.make("thread-1")]
          : [];
    for (const [index, threadId] of titleRegenerationThreadIds.entries()) {
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make(
            `cmd-thread-title-regeneration-before-reactor-start-${index + 1}`,
          ),
          threadId,
          regenerateTitle: true,
        }),
      );
    }

    if (input?.activeProjectPeerBeforeStart === true) {
      const peerThreadId = ThreadId.make("thread-2");
      const peerTurnId = asTurnId("turn-project-peer");
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-project-peer-session-set-before-reactor-start"),
          threadId: peerThreadId,
          session: {
            threadId: peerThreadId,
            status: "running",
            providerName: "codex",
            providerInstanceId: modelSelection.instanceId,
            runtimeSessionId: null,
            runtimeMode: "approval-required",
            activeTurnId: peerTurnId,
            abortState: null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        }),
      );
      runtimeSessions.push({
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: modelSelection.instanceId,
        status: "running",
        runtimeMode: "approval-required",
        cwd: "/tmp/provider-project",
        ...(modelSelection.model ? { model: modelSelection.model } : {}),
        threadId: peerThreadId,
        runtimeSessionId: RuntimeSessionId.make("runtime-project-peer"),
        activeTurnId: peerTurnId,
        resumeCursor: { opaque: "resume-project-peer" },
        createdAt: now,
        updatedAt: now,
      });
    }

    const projectedSessionBeforeStart = input?.projectedSessionBeforeStart;
    if (projectedSessionBeforeStart) {
      const projectedSession: OrchestrationSession = {
        threadId: ThreadId.make("thread-1"),
        status: projectedSessionBeforeStart.status,
        providerName: projectedSessionBeforeStart.providerName ?? "codex",
        providerInstanceId:
          projectedSessionBeforeStart.providerInstanceId ?? ProviderInstanceId.make("codex"),
        runtimeSessionId: projectedSessionBeforeStart.runtimeSessionId ?? null,
        runtimeMode: projectedSessionBeforeStart.runtimeMode ?? "approval-required",
        activeTurnId: projectedSessionBeforeStart.activeTurnId ?? null,
        abortState: projectedSessionBeforeStart.abortState ?? null,
        lastError: projectedSessionBeforeStart.lastError ?? null,
        updatedAt: projectedSessionBeforeStart.updatedAt ?? now,
      };
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-set-before-reactor-start"),
          threadId: ThreadId.make("thread-1"),
          session: projectedSession,
          createdAt: projectedSession.updatedAt,
        }),
      );

      const partialAssistantMessage = projectedSessionBeforeStart.partialAssistantMessage;
      if (partialAssistantMessage) {
        const messageTurnId = partialAssistantMessage.turnId ?? projectedSession.activeTurnId;
        await Effect.runPromise(
          engine.dispatch({
            type: "thread.message.import",
            commandId: CommandId.make("cmd-assistant-import-before-reactor-start"),
            threadId: ThreadId.make("thread-1"),
            message: {
              id: partialAssistantMessage.id,
              role: "assistant",
              text: "",
              attachments: partialAssistantMessage.attachments,
              turnId: messageTurnId,
              streaming: false,
              createdAt: projectedSession.updatedAt,
              updatedAt: projectedSession.updatedAt,
            },
          }),
        );
        await Effect.runPromise(
          engine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: CommandId.make("cmd-assistant-delta-before-reactor-start"),
            threadId: ThreadId.make("thread-1"),
            messageId: partialAssistantMessage.id,
            delta: partialAssistantMessage.text,
            ...(messageTurnId !== null ? { turnId: messageTurnId } : {}),
            createdAt: projectedSession.updatedAt,
          }),
        );
      }

      if (input?.seedMatchingLiveProviderSession === true) {
        runtimeSessions.push({
          provider: ProviderDriverKind.make(projectedSession.providerName ?? "codex"),
          providerInstanceId:
            projectedSession.providerInstanceId ?? ProviderInstanceId.make("codex"),
          status: projectedSession.status === "starting" ? "connecting" : "running",
          runtimeMode: projectedSession.runtimeMode,
          cwd: "/tmp/provider-project",
          model: modelSelection.model,
          threadId: projectedSession.threadId,
          ...(projectedSession.runtimeSessionId !== null
            ? { runtimeSessionId: projectedSession.runtimeSessionId }
            : {}),
          resumeCursor: { opaque: "resume-before-restart" },
          ...(projectedSession.activeTurnId !== null
            ? { activeTurnId: projectedSession.activeTurnId }
            : {}),
          createdAt: projectedSession.updatedAt,
          updatedAt: projectedSession.updatedAt,
        });
      }
    }

    for (const [index, subagent] of (input?.projectedSubagentsBeforeStart ?? []).entries()) {
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.subagent.upsert",
          commandId: CommandId.make(`cmd-subagent-before-reactor-start-${index}`),
          threadId: ThreadId.make("thread-1"),
          subagent,
          createdAt: subagent.updatedAt,
        }),
      );
    }

    for (const [index, activity] of (input?.projectedActivitiesBeforeStart ?? []).entries()) {
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make(`cmd-activity-before-reactor-start-${index}`),
          threadId: ThreadId.make("thread-1"),
          activity,
          createdAt: activity.createdAt,
        }),
      );
    }

    scope = await Effect.runPromise(Scope.make("sequential"));
    const startReactor = () => Effect.runPromise(reactor.start().pipe(Scope.provide(scope!)));
    await startReactor();
    const drain = () => Effect.runPromise(reactor.drain);

    return {
      engine,
      readModel: () => Effect.runPromise(snapshotQuery.getSnapshot()),
      readShell: () => Effect.runPromise(snapshotQuery.getShellSnapshot()),
      startSession,
      forkSession,
      sendTurn,
      runFetch,
      fetchHandoffInputs,
      requestFetchInterrupt,
      interruptTurn,
      requestAbort,
      respondToRequest,
      respondToUserInput,
      stopSession,
      renameBranch,
      pruneWorktrees,
      createWorktree,
      refreshStatus,
      generateBranchName,
      generateThreadMetadata,
      generateThreadTitle,
      decideAutoReasoning,
      readProjectMemory,
      serverSettings,
      runtimeSessions,
      stateDir,
      drain,
      startReactor,
      readEvents: () =>
        runtime!.runPromise(
          Stream.runCollect(engine.readEvents(0)).pipe(Effect.map((events) => Array.from(events))),
        ),
      runEffect,
      get titleRegenerationCompletionDispatchAttempts() {
        return titleRegenerationCompletionDispatchAttempts;
      },
      get sendTurnExecutions() {
        return sendTurnExecutions;
      },
    };
  }

  it("applies current agent enhancement settings only to newly activated turns", async () => {
    const harness = await createHarness({
      serverSettings: {
        betterT3Environment: { flags: { "agent.deepThinking": true } },
        agentEnhancement: {
          cavemanMode: "full",
          deepThinking: {
            enabled: false,
            stepCount: 4,
            refinementPasses: 1,
            parallelEnabled: false,
          },
        },
      },
    });
    const dispatchTurn = (input: { readonly command: string; readonly message: string }) =>
      harness.runEffect(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(input.command),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId(`${input.command}-message`),
            role: "user",
            text: input.message,
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: "2026-01-01T00:00:01.000Z",
        }),
      );

    await dispatchTurn({ command: "cmd-enhanced-turn", message: "first request" });
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    const firstProviderInput = harness.sendTurn.mock.calls[0]?.[0]?.input;
    expect(firstProviderInput).toContain("### Deep thinking");
    expect(firstProviderInput).toContain("### Caveman mode");
    expect(firstProviderInput?.endsWith("first request")).toBe(true);
    expect(harness.sendTurn.mock.calls[0]?.[0]?.interactionMode).toBe(
      DEFAULT_PROVIDER_INTERACTION_MODE,
    );
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      runtimeMode: "approval-required",
    });

    await harness.runEffect(
      harness.serverSettings.updateSettings({
        betterT3Environment: { flags: { "agent.deepThinking": false } },
        agentEnhancement: { cavemanMode: "off" },
      }),
    );
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe(firstProviderInput);

    await dispatchTurn({ command: "cmd-unenhanced-turn", message: "second request" });
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.sendTurn.mock.calls[1]?.[0]?.input).toBe("second request");

    const readModel = await harness.readModel();
    const storedUserMessages =
      readModel.threads
        .find((thread) => thread.id === ThreadId.make("thread-1"))
        ?.messages.filter((message) => message.role === "user")
        .map((message) => message.text) ?? [];
    expect(storedUserMessages).toEqual(["first request", "second request"]);
  });

  it("starts a fork in a fresh provider session and completes its handoff exactly once", async () => {
    const harness = await createHarness({ forkBeforeStart: true });
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Generated fork question" }),
    );
    const now = "2026-01-01T00:00:01.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-fork-first-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("fork-first-user-message"),
          role: "user",
          text: "new fork question",
          attachments: [
            {
              type: "image",
              id: "current-image",
              name: "current.png",
              mimeType: "image/png",
              sizeBytes: 64,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      freshSession: true,
    });
    expect(harness.startSession.mock.calls[0]?.[1]).not.toHaveProperty("resumeCursor");
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe("new fork question");
    expect(harness.sendTurn.mock.calls[0]?.[0]?.transcriptHandoff?.text).toContain(
      "source question with image",
    );
    expect(harness.sendTurn.mock.calls[0]?.[0]?.transcriptHandoff?.text).toContain(
      "source completed answer",
    );
    expect(
      harness.sendTurn.mock.calls[0]?.[0]?.transcriptHandoff?.attachments?.map((entry) => entry.id),
    ).toEqual(["source-image"]);
    expect(harness.sendTurn.mock.calls[0]?.[0]?.attachments?.map((entry) => entry.id)).toEqual([
      "current-image",
    ]);

    await waitFor(async () => {
      const readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.fork?.handoff
          .status === "completed"
      );
    });
    await waitFor(async () => {
      const readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.title ===
        "Generated fork question"
      );
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-fork-second-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("fork-second-user-message"),
          role: "user",
          text: "ordinary follow-up",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[1]?.[0]?.input).toBe("ordinary follow-up");
  });

  it("uses the persisted Codex fork cursor without injecting transcript bytes", async () => {
    const modelSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
      { id: "reasoningEffort", value: "max" },
      { id: "contextWindow", value: "262144" },
    ]);
    const harness = await createHarness({
      forkBeforeStart: true,
      forkProviderCursor: {
        providerThreadId: "provider-source-thread",
        providerTurnId: "provider-source-turn-9",
      },
      threadModelSelection: modelSelection,
      forkSessionEffect: (input) =>
        Effect.succeed({
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          status: "ready",
          runtimeMode: input.session.runtimeMode,
          cwd: input.session.cwd,
          model: input.session.modelSelection?.model,
          threadId: input.destinationThreadId,
          runtimeSessionId: RuntimeSessionId.make("runtime-native-fork"),
          resumeCursor: { threadId: "provider-forked-thread" },
          createdAt: "2026-01-01T00:00:01.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        }),
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-native-fork-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("native-fork-user-message"),
          role: "user",
          text: "continue natively",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession).not.toHaveBeenCalled();
    expect(harness.forkSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceThreadId: ThreadId.make("source-thread-1"),
        destinationThreadId: ThreadId.make("thread-1"),
        sourceProviderThreadId: "provider-source-thread",
        lastProviderTurnId: "provider-source-turn-9",
        session: expect.objectContaining({ modelSelection }),
      }),
    );
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe("continue natively");
    expect(harness.sendTurn.mock.calls[0]?.[0]).not.toHaveProperty("transcriptHandoff");
  });

  it("falls back to a compact handoff when the native fork RPC fails", async () => {
    const harness = await createHarness({
      forkBeforeStart: true,
      forkProviderCursor: {
        providerThreadId: "provider-source-thread",
        providerTurnId: "provider-source-turn-9",
      },
      forkSessionEffect: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "thread/fork",
            detail: "injected native fork failure",
          }),
        ),
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-native-fork-fallback-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("native-fork-fallback-user-message"),
          role: "user",
          text: "continue after failed native fork",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.forkSession).toHaveBeenCalledTimes(1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({ freshSession: true });
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe("continue after failed native fork");
    expect(harness.sendTurn.mock.calls[0]?.[0]?.transcriptHandoff?.text).toContain(
      "source question with image",
    );
  });

  it("passes a compact fork handoff while retaining the exact source history in projection", async () => {
    const sourceText = "source context ".repeat(10_000);
    const harness = await createHarness({
      forkBeforeStart: true,
      forkSourceUserText: sourceText,
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-fork-bounded-handoff-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("fork-bounded-handoff-message"),
          role: "user",
          text: "continue from the fork",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    const request = harness.sendTurn.mock.calls[0]?.[0];
    expect(request?.input).toBe("continue from the fork");
    expect(request?.transcriptHandoff?.text.length).toBeLessThan(25_000);
    expect(request?.transcriptHandoff?.text).toContain("[truncated]");
    expect(request?.transcriptHandoff?.text).not.toContain(sourceText);
    expect(request?.transcriptHandoff?.text).toContain("source completed answer");

    const readModel = await harness.readModel();
    const forkThread = readModel.threads.find((thread) => thread.id === ThreadId.make("thread-1"));
    expect(forkThread?.messages.some((message) => message.text === sourceText)).toBe(true);
  });

  it("keeps a failed fork handoff pending and retries it in another fresh session", async () => {
    const harness = await createHarness({
      forkBeforeStart: true,
      sendTurnEffect: (execution) =>
        execution === 1
          ? Effect.fail(
              new ProviderAdapterRequestError({
                provider: "codex",
                method: "thread.turn.start",
                detail: "injected first-send failure",
              }),
            )
          : Effect.succeed({
              threadId: ThreadId.make("thread-1"),
              turnId: asTurnId("turn-retry"),
            }),
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-fork-failed-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("fork-failed-user-message"),
          role: "user",
          text: "first attempt",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await waitFor(() => harness.sendTurnExecutions === 1);
    await harness.drain();
    let readModel = await harness.readModel();
    expect(
      readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.fork?.handoff
        .status,
    ).toBe("pending");

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-fork-retry-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("fork-retry-user-message"),
          role: "user",
          text: "retry now",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );

    await waitFor(() => harness.sendTurnExecutions === 2);
    expect(harness.startSession).toHaveBeenCalledTimes(2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({ freshSession: true });
    expect(harness.startSession.mock.calls[1]?.[1]).not.toHaveProperty("resumeCursor");
    expect(harness.sendTurn.mock.calls[1]?.[0]?.input).toBe("retry now");
    expect(harness.sendTurn.mock.calls[1]?.[0]?.transcriptHandoff?.text).toContain(
      "source completed answer",
    );
    expect(harness.sendTurn.mock.calls[1]?.[0]?.transcriptHandoff?.text).toContain("first attempt");
    await waitFor(async () => {
      readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.fork?.handoff
          .status === "completed"
      );
    });
  });

  it("keeps a full-size first fork prompt separate from compact inherited context", async () => {
    const harness = await createHarness({
      forkBeforeStart: true,
      forkSourceUserText: "source context ".repeat(100),
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-fork-over-budget-turn"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("fork-over-budget-user-message"),
          role: "user",
          text: "u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe(
      "u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
    );
    expect(harness.sendTurn.mock.calls[0]?.[0]?.transcriptHandoff?.text).toContain(
      "source context",
    );
    await waitFor(async () => {
      const readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.fork?.handoff
          .status === "completed"
      );
    });
  });

  describe("startup session reconciliation", () => {
    const projectedAt = "2025-12-31T23:59:00.000Z";
    const runtimeSessionId = RuntimeSessionId.make("runtime-before-restart");
    const activeTurnId = asTurnId("turn-before-restart");
    const partialAssistantMessageId = asMessageId("assistant-before-restart");
    const partialAssistantAttachments = [
      {
        type: "image" as const,
        id: "attachment-before-restart",
        name: "reproduction.png",
        mimeType: "image/png",
        sizeBytes: 321,
      },
    ];
    const abortState: NonNullable<OrchestrationSession["abortState"]> = {
      runtimeSessionId,
      targetTurnId: activeTurnId,
      phase: "interrupting",
      requestedAt: "2025-12-31T23:59:30.000Z",
      forceAt: "2025-12-31T23:59:35.000Z",
    };
    const makeInteractionActivity = (input: {
      readonly id: string;
      readonly kind: string;
      readonly requestId: string;
      readonly turnId?: TurnId;
      readonly payload?: Readonly<Record<string, unknown>>;
    }): OrchestrationThreadActivity => ({
      id: EventId.make(input.id),
      tone: "approval",
      kind: input.kind,
      summary: input.kind,
      payload: {
        requestId: asApprovalRequestId(input.requestId),
        ...input.payload,
      },
      turnId: input.turnId ?? activeTurnId,
      createdAt: projectedAt,
    });
    const makeProjectedSubagent = (input: {
      readonly id: string;
      readonly status: OrchestrationSubagentSummary["status"];
      readonly latestTurnState?: NonNullable<OrchestrationSubagentSummary["latestTurn"]>["state"];
      readonly origin?: OrchestrationSubagentSummary["origin"];
      readonly providerInstanceId?: ProviderInstanceId | null;
      readonly providerDriver?: ProviderDriverKind | null;
    }): OrchestrationSubagentSummary => {
      const id = SubagentId.make(input.id);
      const completedAt =
        input.latestTurnState !== undefined && input.latestTurnState !== "running"
          ? projectedAt
          : null;
      const statusSummary =
        input.status === "starting"
          ? "Starting"
          : input.status === "waiting"
            ? "Waiting"
            : input.status === "running"
              ? "Working"
              : input.status === "completed"
                ? "Completed"
                : input.status === "interrupted"
                  ? "Interrupted"
                  : input.status === "error"
                    ? "Error"
                    : "Unavailable";
      return {
        id,
        providerThreadId: input.id.replace("codex:", ""),
        parentId: null,
        path: `/root/${input.id}`,
        name: input.id,
        nickname: null,
        role: null,
        task: null,
        model: null,
        reasoningEffort: null,
        origin: input.origin ?? "provider-native",
        providerInstanceId: input.providerInstanceId ?? null,
        providerDriver: input.providerDriver ?? null,
        depth: 1,
        status: input.status,
        statusMessage: null,
        latestProgress: {
          kind: `state.${input.status}`,
          summary: statusSummary,
          detail: null,
          createdAt: projectedAt,
        },
        latestTurn:
          input.latestTurnState === undefined
            ? null
            : {
                turnId: asTurnId(`turn-${input.id}`),
                state: input.latestTurnState,
                requestedAt: projectedAt,
                startedAt: projectedAt,
                completedAt,
                assistantMessageId: null,
              },
        startedAt: projectedAt,
        updatedAt: projectedAt,
        completedAt: input.status === "completed" ? projectedAt : null,
      };
    };

    it("interrupts an orphaned running turn and finalizes its partial assistant output", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "running",
          runtimeSessionId,
          runtimeMode: "full-access",
          activeTurnId,
          abortState,
          lastError: "stale runtime error",
          updatedAt: projectedAt,
          partialAssistantMessage: {
            id: partialAssistantMessageId,
            text: "Partial response before shutdown",
            attachments: partialAssistantAttachments,
          },
        },
      });

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session).toMatchObject({
        status: "interrupted",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeSessionId: null,
        runtimeMode: "full-access",
        activeTurnId: null,
        abortState: null,
        lastError: null,
      });
      expect(thread?.session?.updatedAt).not.toBe(projectedAt);
      expect(thread?.latestTurn).toMatchObject({
        turnId: activeTurnId,
        state: "interrupted",
        completedAt: thread?.session?.updatedAt,
      });
      expect(thread?.latestTurn?.state).not.toBe("completed");
      expect(
        thread?.messages.find((message) => message.id === partialAssistantMessageId),
      ).toMatchObject({
        text: "Partial response before shutdown",
        attachments: partialAssistantAttachments,
        turnId: activeTurnId,
        streaming: false,
      });
      expect(harness.stopSession).not.toHaveBeenCalled();

      const events = await harness.readEvents();
      const interruptionIndex = events.findIndex(
        (event) =>
          event.type === "thread.session-set" && event.payload.session.status === "interrupted",
      );
      expect(interruptionIndex).toBeGreaterThan(-1);
      expect(
        events
          .slice(interruptionIndex + 1)
          .some(
            (event) =>
              event.type === "thread.message-sent" &&
              event.payload.messageId === partialAssistantMessageId &&
              event.payload.streaming === false,
          ),
      ).toBe(true);
    });

    it("interrupts an orphaned running turn and resolves its pending user input", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "running",
          runtimeSessionId,
          activeTurnId,
          updatedAt: projectedAt,
        },
        projectedActivitiesBeforeStart: [
          makeInteractionActivity({
            id: "input-before-restart",
            kind: "user-input.requested",
            requestId: "input-before-restart",
          }),
        ],
      });

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session?.status).toBe("interrupted");
      expect(thread?.activities.at(-1)).toMatchObject({
        kind: "user-input.resolved",
        turnId: activeTurnId,
        payload: {
          requestId: asApprovalRequestId("input-before-restart"),
          answers: {},
          reason: "provider-runtime-unavailable-after-startup",
        },
      });

      const shell = await harness.readShell();
      expect(shell.threads.find((entry) => entry.id === ThreadId.make("thread-1"))).toMatchObject({
        hasPendingUserInput: false,
      });
    });

    it("repairs pending input on an already interrupted thread without changing its sort time", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "interrupted",
          runtimeSessionId: null,
          updatedAt: projectedAt,
        },
        projectedActivitiesBeforeStart: [
          makeInteractionActivity({
            // Sorts after the old startup-prefixed repair ID when timestamps tie.
            // The repair must still follow the request in projection ordering.
            id: "zz-stale-input-on-interrupted-thread",
            kind: "user-input.requested",
            requestId: "stale-input-on-interrupted-thread",
          }),
        ],
      });

      const shell = await harness.readShell();
      expect(shell.threads.find((entry) => entry.id === ThreadId.make("thread-1"))).toMatchObject({
        updatedAt: projectedAt,
        hasPendingUserInput: false,
      });
      const repairEvents = (await harness.readEvents()).filter(
        (event) =>
          event.type === "thread.activity-appended" &&
          event.payload.activity.kind === "user-input.resolved",
      );
      expect(repairEvents).toHaveLength(1);
      expect(repairEvents[0]?.payload.activity.id).toBe(
        "zz-stale-input-on-interrupted-thread:startup-pending-interaction:user-input",
      );

      const eventCountAfterFirstReconciliation = (await harness.readEvents()).length;
      await harness.startReactor();
      expect((await harness.readEvents()).length).toBe(eventCountAfterFirstReconciliation);
    });

    it("repairs pending approvals with a canonical cancellation", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "ready",
          runtimeSessionId: null,
          updatedAt: projectedAt,
        },
        projectedActivitiesBeforeStart: [
          makeInteractionActivity({
            id: "approval-before-restart",
            kind: "approval.requested",
            requestId: "approval-before-restart",
          }),
        ],
      });

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.activities.at(-1)).toMatchObject({
        kind: "approval.resolved",
        turnId: activeTurnId,
        payload: {
          requestId: asApprovalRequestId("approval-before-restart"),
          decision: "cancel",
          reason: "provider-runtime-unavailable-after-startup",
        },
      });
      const shell = await harness.readShell();
      expect(shell.threads.find((entry) => entry.id === ThreadId.make("thread-1"))).toMatchObject({
        hasPendingApprovals: false,
      });
    });

    it("does not duplicate an already resolved startup interaction", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "interrupted",
          runtimeSessionId: null,
          updatedAt: projectedAt,
        },
        projectedActivitiesBeforeStart: [
          makeInteractionActivity({
            id: "input-before-resolution",
            kind: "user-input.requested",
            requestId: "input-before-resolution",
          }),
          makeInteractionActivity({
            id: "input-resolved-before-restart",
            kind: "user-input.resolved",
            requestId: "input-before-resolution",
            payload: { answers: { answer: "done" } },
          }),
        ],
      });
      const eventCountAfterFirstReconciliation = (await harness.readEvents()).length;

      await harness.startReactor();

      expect((await harness.readEvents()).length).toBe(eventCountAfterFirstReconciliation);
      const repairActivities = (await harness.readModel()).threads
        .find((entry) => entry.id === ThreadId.make("thread-1"))
        ?.activities.filter((activity) =>
          String(activity.id).startsWith("startup-pending-interaction:"),
        );
      expect(repairActivities).toEqual([]);
    });

    it("leaves pending interactions untouched while the provider session is live", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "running",
          runtimeSessionId,
          activeTurnId,
          updatedAt: projectedAt,
        },
        seedMatchingLiveProviderSession: true,
        projectedActivitiesBeforeStart: [
          makeInteractionActivity({
            id: "live-input",
            kind: "user-input.requested",
            requestId: "live-input",
          }),
        ],
      });

      const shell = await harness.readShell();
      expect(shell.threads.find((entry) => entry.id === ThreadId.make("thread-1"))).toMatchObject({
        hasPendingUserInput: true,
      });
      const repairActivities = (await harness.readModel()).threads
        .find((entry) => entry.id === ThreadId.make("thread-1"))
        ?.activities.filter((activity) =>
          String(activity.id).startsWith("startup-pending-interaction:"),
        );
      expect(repairActivities).toEqual([]);
    });

    it("interrupts an orphaned starting session and clears its runtime identifiers", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "starting",
          runtimeSessionId,
          abortState: {
            ...abortState,
            targetTurnId: null,
          },
          lastError: "stale startup error",
          updatedAt: projectedAt,
        },
      });

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session).toMatchObject({
        status: "interrupted",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeSessionId: null,
        runtimeMode: "approval-required",
        activeTurnId: null,
        abortState: null,
        lastError: null,
      });
      expect(thread?.latestTurn).toBeNull();
    });

    it("durably settles orphaned active subagents when no provider runtime survives startup", async () => {
      const runningChild = makeProjectedSubagent({
        id: "fetch:thread-1:run-before-restart:0",
        status: "running",
        latestTurnState: "running",
        origin: "t3-fetch",
        providerInstanceId: ProviderInstanceId.make("claude_fetch"),
        providerDriver: ProviderDriverKind.make("claudeAgent"),
      });
      const runningManagedChild = makeProjectedSubagent({
        id: "general:thread-1:worker-before-restart",
        status: "running",
        latestTurnState: "running",
        origin: "t3-managed",
        providerInstanceId: ProviderInstanceId.make("codex_security"),
        providerDriver: ProviderDriverKind.make("codex"),
      });
      const terminalChildWithStaleStatus = makeProjectedSubagent({
        id: "codex:completed-child-before-restart",
        status: "running",
        latestTurnState: "completed",
      });
      const completedSibling = makeProjectedSubagent({
        id: "codex:already-completed-child",
        status: "completed",
        latestTurnState: "completed",
      });
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "ready",
          runtimeSessionId,
          updatedAt: projectedAt,
        },
        projectedSubagentsBeforeStart: [
          runningChild,
          runningManagedChild,
          terminalChildWithStaleStatus,
          completedSibling,
        ],
      });

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      const repairedAt = thread?.subagents.find(
        (subagent) => subagent.id === runningChild.id,
      )?.completedAt;
      expect(repairedAt).not.toBeNull();
      expect(thread?.subagents.find((subagent) => subagent.id === runningChild.id)).toMatchObject({
        status: "interrupted",
        origin: "t3-fetch",
        providerInstanceId: ProviderInstanceId.make("claude_fetch"),
        providerDriver: ProviderDriverKind.make("claudeAgent"),
        statusMessage: null,
        latestProgress: {
          kind: "state.interrupted",
          summary: "Interrupted",
          detail: null,
          createdAt: repairedAt,
        },
        latestTurn: {
          state: "interrupted",
          completedAt: repairedAt,
        },
        completedAt: repairedAt,
      });
      expect(
        thread?.subagents.find((subagent) => subagent.id === runningManagedChild.id),
      ).toMatchObject({
        status: "interrupted",
        origin: "t3-managed",
        providerInstanceId: ProviderInstanceId.make("codex_security"),
        providerDriver: ProviderDriverKind.make("codex"),
      });
      expect(
        thread?.subagents.find((subagent) => subagent.id === terminalChildWithStaleStatus.id),
      ).toMatchObject({
        status: "completed",
        statusMessage: null,
        latestProgress: {
          kind: "state.completed",
          summary: "Completed",
          detail: null,
          createdAt: projectedAt,
        },
        latestTurn: {
          state: "completed",
          completedAt: projectedAt,
        },
        completedAt: projectedAt,
      });
      expect(thread?.subagents.find((subagent) => subagent.id === completedSibling.id)).toEqual(
        completedSibling,
      );

      const repairedIds = (await harness.readEvents())
        .filter((event) => event.type === "thread.subagent-upserted")
        .map((event) => event.payload.subagent.id);
      expect(repairedIds.filter((id) => id === runningChild.id)).toHaveLength(2);
      expect(repairedIds.filter((id) => id === runningManagedChild.id)).toHaveLength(2);
      expect(repairedIds.filter((id) => id === terminalChildWithStaleStatus.id)).toHaveLength(2);
      expect(repairedIds.filter((id) => id === completedSibling.id)).toHaveLength(1);

      const eventCountAfterFirstReconciliation = (await harness.readEvents()).length;
      await harness.startReactor();
      expect((await harness.readEvents()).length).toBe(eventCountAfterFirstReconciliation);
    });

    it("leaves a projected running session untouched when its provider runtime is live", async () => {
      const runningChild = makeProjectedSubagent({
        id: "codex:live-child-before-restart",
        status: "running",
        latestTurnState: "running",
      });
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "running",
          runtimeSessionId,
          runtimeMode: "full-access",
          activeTurnId,
          abortState,
          updatedAt: projectedAt,
          partialAssistantMessage: {
            id: partialAssistantMessageId,
            text: "Provider is still streaming",
            attachments: partialAssistantAttachments,
          },
        },
        projectedSubagentsBeforeStart: [runningChild],
        seedMatchingLiveProviderSession: true,
      });

      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session).toMatchObject({
        status: "running",
        runtimeSessionId,
        activeTurnId,
        abortState,
        updatedAt: projectedAt,
      });
      expect(
        thread?.messages.find((message) => message.id === partialAssistantMessageId),
      ).toMatchObject({
        text: "Provider is still streaming",
        attachments: partialAssistantAttachments,
        streaming: true,
      });
      expect(harness.runtimeSessions).toHaveLength(1);
      expect(harness.runtimeSessions[0]).toMatchObject({
        threadId: ThreadId.make("thread-1"),
        runtimeSessionId,
        resumeCursor: { opaque: "resume-before-restart" },
      });
      expect(harness.stopSession).not.toHaveBeenCalled();
      expect(thread?.subagents.find((subagent) => subagent.id === runningChild.id)).toEqual(
        runningChild,
      );

      const sessionSetEvents = (await harness.readEvents()).filter(
        (event) => event.type === "thread.session-set",
      );
      expect(sessionSetEvents).toHaveLength(1);
    });

    it.each(["ready", "error", "stopped", "interrupted"] as const)(
      "leaves an existing %s session unchanged",
      async (status) => {
        const harness = await createHarness({
          projectedSessionBeforeStart: {
            status,
            runtimeSessionId,
            lastError: status === "error" ? "existing provider failure" : null,
            updatedAt: projectedAt,
          },
        });

        const readModel = await harness.readModel();
        const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
        expect(thread?.session).toMatchObject({
          status,
          runtimeSessionId,
          lastError: status === "error" ? "existing provider failure" : null,
          updatedAt: projectedAt,
        });
        const sessionSetEvents = (await harness.readEvents()).filter(
          (event) => event.type === "thread.session-set",
        );
        expect(sessionSetEvents).toHaveLength(1);
      },
    );

    it("does not append more repair events when startup reconciliation runs again", async () => {
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "running",
          runtimeSessionId,
          activeTurnId,
          updatedAt: projectedAt,
        },
      });
      const eventCountAfterFirstReconciliation = (await harness.readEvents()).length;

      await harness.startReactor();

      expect((await harness.readEvents()).length).toBe(eventCountAfterFirstReconciliation);
    });

    it("starts fresh with visible context when the user continues an errored provider turn", async () => {
      const originalRequest = "Implement the researched ViaVersion and Folia rate-limit mode.";
      const partialContext = "Analyzed the ViaVersion and Folia rate-limit constraints.";
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "error",
          providerName: "openrouter",
          providerInstanceId: ProviderInstanceId.make("openrouter"),
          runtimeSessionId,
          lastError: "OpenRouter turn was stopped to protect server memory.",
          updatedAt: projectedAt,
          partialAssistantMessage: {
            id: partialAssistantMessageId,
            text: partialContext,
            attachments: [],
            turnId: activeTurnId,
          },
        },
        threadModelSelection: {
          instanceId: ProviderInstanceId.make("openrouter"),
          model: "moonshotai/kimi-k3",
        },
      });
      await harness.runEffect(
        harness.engine.dispatch({
          type: "thread.message.import",
          commandId: CommandId.make("cmd-user-import-before-provider-error"),
          threadId: ThreadId.make("thread-1"),
          message: {
            id: asMessageId("user-message-before-provider-error"),
            role: "user",
            text: originalRequest,
            attachments: [],
            turnId: activeTurnId,
            streaming: false,
            createdAt: "2025-12-31T23:58:00.000Z",
            updatedAt: "2025-12-31T23:58:00.000Z",
          },
        }),
      );
      await harness.runEffect(
        harness.engine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: CommandId.make("cmd-assistant-complete-after-provider-error"),
          threadId: ThreadId.make("thread-1"),
          messageId: partialAssistantMessageId,
          turnId: activeTurnId,
          createdAt: "2026-01-01T00:00:30.000Z",
        }),
      );

      await harness.runEffect(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-after-provider-error"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("user-message-after-provider-error"),
            role: "user",
            text: "Continue with the implementation",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: "2026-01-01T00:01:00.000Z",
        }),
      );

      await waitFor(() => harness.startSession.mock.calls.length === 1);
      await waitFor(() => harness.sendTurn.mock.calls.length === 1);
      expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
        provider: ProviderDriverKind.make("openrouter"),
        providerInstanceId: ProviderInstanceId.make("openrouter"),
        freshSession: true,
      });
      expect(harness.startSession.mock.calls[0]?.[1]).not.toHaveProperty("resumeCursor");
      const request = harness.sendTurn.mock.calls[0]?.[0];
      expect(request?.input).toBe("Continue with the implementation");
      expect(request?.transcriptHandoff?.text).toContain(`[user]\n${originalRequest}\n[/user]`);
      expect(request?.transcriptHandoff?.text).toContain(
        `[assistant]\n${partialContext}\n[/assistant]`,
      );
    });

    it("starts fresh with visible context when the user continues an interrupted thread", async () => {
      const partialContext = "Partial response before shutdown";
      const harness = await createHarness({
        projectedSessionBeforeStart: {
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId,
          activeTurnId,
          updatedAt: projectedAt,
          partialAssistantMessage: {
            id: partialAssistantMessageId,
            text: partialContext,
            attachments: [],
          },
        },
      });

      await harness.runEffect(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-after-startup-reconciliation"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("user-message-after-startup-reconciliation"),
            role: "user",
            text: "Continue after restart",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: "2026-01-01T00:01:00.000Z",
        }),
      );

      await waitFor(() => harness.startSession.mock.calls.length === 1);
      await waitFor(() => harness.sendTurn.mock.calls.length === 1);
      expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
        threadId: ThreadId.make("thread-1"),
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        freshSession: true,
      });
      expect(harness.startSession.mock.calls[0]?.[1]).not.toHaveProperty("resumeCursor");
      const request = harness.sendTurn.mock.calls[0]?.[0];
      expect(request?.input).toBe("Continue after restart");
      expect(request?.transcriptHandoff?.text).toContain(
        `[assistant]\n${partialContext}\n[/assistant]`,
      );
    });
  });

  it("reacts to thread.turn.start by ensuring session and sending provider turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-1"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },
        fetchMode: "repository-exploration",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.runFetch.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[0]).toEqual(ThreadId.make("thread-1"));
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.status).toBe("starting");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
    expect(thread?.messages.at(-1)?.text).toBe("hello reactor");
    const providerInput = harness.sendTurn.mock.calls[0]?.[0]?.input;
    expect(providerInput).toBe("hello reactor");
    expect(providerInput).not.toContain("T3 TURN INSTRUCTIONS");
    expect(harness.runFetch.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      cwd: "/tmp/provider-project",
      userRequest: "hello reactor",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.3-codex-spark",
      },
      providerDriver: ProviderDriverKind.make("codex"),
      maxRecommendedWorkers: 8,
      commandExecutionPolicy: "deny",
      contextMaxChars: 64_000,
      lunaFallback: {
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6-luna",
          options: [{ id: "reasoningEffort", value: "low" }],
        },
        providerDriver: ProviderDriverKind.make("codex"),
        maxRecommendedWorkers: 8,
        commandExecutionPolicy: "deny",
      },
    });
    expect(harness.startSession.mock.invocationCallOrder[0]).toBeLessThan(
      harness.runFetch.mock.invocationCallOrder[0]!,
    );
  });

  it("starts Codex with project memory isolated and sends only relevant memory as handoff", async () => {
    const markdown = "# Project memory\n\n## Active decisions\n\nUse native forks.\n";
    const harness = await createHarness({
      projectMemoryRead: {
        mode: "project",
        storage: "workspace",
        entries: [
          {
            section: "active-decisions",
            key: "forks.native",
            content: "Use native forks.",
            verified: true,
            sourceThreadId: ThreadId.make("source-thread"),
          },
        ],
        markdown,
        tokenBudget: 2_560,
        estimatedTokens: 16,
        truncated: false,
      },
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-with-project-memory"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-with-project-memory"),
          role: "user",
          text: "continue the fork work",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.readProjectMemory).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "root", projectId: ProjectId.make("project-1") }),
      expect.objectContaining({ query: "continue the fork work", contextWindowTokens: 128_000 }),
    );
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      projectMemoryMode: "project",
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe("continue the fork work");
    expect(harness.sendTurn.mock.calls[0]?.[0]?.transcriptHandoff?.text).toBe(
      `<t3code_project_memory>\n${markdown.trim()}\n</t3code_project_memory>`,
    );
  });

  it("retries an interrupted result-less turn with the existing user message", async () => {
    const harness = await createHarness();
    const threadId = ThreadId.make("thread-1");
    const messageId = asMessageId("user-message-result-only-retry");
    const turnId = asTurnId("turn-1");
    const runtimeSessionId = RuntimeSessionId.make("runtime-result-only-retry");

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-title-before-result-only-retry"),
        threadId,
        title: "New thread",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-result-only-retry"),
        threadId,
        message: {
          messageId,
          role: "user",
          text: "answer this once",
          attachments: [
            {
              type: "image",
              id: "result-only-retry-image",
              name: "question.png",
              mimeType: "image/png",
              sizeBytes: 64,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1);
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-aborting-before-result-only-retry"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: turnId,
          abortState: {
            runtimeSessionId,
            targetTurnId: turnId,
            phase: "interrupting",
            requestedAt: "2026-01-01T00:00:02.000Z",
            forceAt: "2026-01-01T00:00:07.000Z",
          },
          lastError: null,
          updatedAt: "2026-01-01T00:00:02.000Z",
        },
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.abort.settle",
        commandId: CommandId.make("cmd-abort-settle-before-result-only-retry"),
        threadId,
        runtimeSessionId,
        turnId,
        outcome: "cooperative",
        settledAt: "2026-01-01T00:00:03.000Z",
        createdAt: "2026-01-01T00:00:03.000Z",
      }),
    );

    const interruptedThread = (await harness.readModel()).threads.find(
      (entry) => entry.id === threadId,
    );
    expect(interruptedThread?.latestTurn).toMatchObject({
      turnId,
      state: "interrupted",
      assistantMessageId: null,
    });

    harness.sendTurn.mockClear();
    harness.generateThreadTitle.mockClear();
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.retry",
        commandId: CommandId.make("cmd-result-only-retry"),
        threadId,
        turnId,
        messageId,
        createdAt: "2026-01-01T00:00:04.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await harness.drain();
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe("answer this once");
    expect(harness.sendTurn.mock.calls[0]?.[0]?.attachments?.map((entry) => entry.id)).toEqual([
      "result-only-retry-image",
    ]);
    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    expect(
      (await harness.readModel()).threads
        .find((entry) => entry.id === threadId)
        ?.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
  });

  it("injects project-agent coordination instructions when another project thread is active", async () => {
    const harness = await createHarness({ activeProjectPeerBeforeStart: true });
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-with-active-project-peer"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-with-active-project-peer"),
          role: "user",
          text: "coordinate this change",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe(
      coordinatedProviderInput("coordinate this change"),
    );
  });

  effectIt.effect("waits for independent Claude Fetch workers before sending a Codex turn", () =>
    Effect.gen(function* () {
      const fetchResult = yield* Deferred.make<FetchRunResult>();
      const claudeFetchSelection: ModelSelection = {
        instanceId: ProviderInstanceId.make("claude_fetch"),
        model: "claude-opus-4-6",
        options: [{ id: "effort", value: "high" }],
      };
      const harness = yield* Effect.promise(() =>
        createHarness({
          fetchModelSelection: claudeFetchSelection,
          providerSnapshots: [
            fetchProviderFixture({
              instanceId: "codex",
              driver: "codex",
              models: ["gpt-5-codex", "gpt-5.3-codex-spark", "gpt-5.6-luna"],
            }),
            fetchProviderFixture({
              instanceId: "claude_fetch",
              driver: "claudeAgent",
              models: ["claude-opus-4-6"],
              maxRecommendedWorkers: 10,
            }),
          ],
          runFetchEffect: () => Deferred.await(fetchResult),
        }),
      );
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-fetch-claude"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-fetch-claude"),
          role: "user",
          text: "trace the provider boundary",
          attachments: [],
        },
        fetchMode: "repository-exploration",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });

      yield* Effect.promise(() => waitFor(() => harness.runFetch.mock.calls.length === 1));
      expect(harness.sendTurn).not.toHaveBeenCalled();
      const duringFetch = yield* Effect.promise(() => harness.readModel());
      expect(
        duringFetch.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.session
          ?.status,
      ).toBe("starting");
      expect(harness.runFetch.mock.calls[0]?.[0]).toMatchObject({
        modelSelection: claudeFetchSelection,
        providerDriver: ProviderDriverKind.make("claudeAgent"),
        maxRecommendedWorkers: 10,
        commandExecutionPolicy: "deny",
      });

      yield* Deferred.succeed(fetchResult, {
        runId: "fetch-run-claude",
        status: "completed",
        context: "T3 FETCH CONTEXT\nClaude evidence",
        warnings: [],
        plannedWorkers: 2,
        completedWorkers: 2,
        successfulWorkers: 2,
        providerInstanceId: claudeFetchSelection.instanceId,
        providerDriver: ProviderDriverKind.make("claudeAgent"),
        modelSelection: claudeFetchSelection,
      });
      yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));

      expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
        providerInstanceId: ProviderInstanceId.make("codex"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex") },
      });
      expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe(
        "trace the provider boundary\n\nT3 FETCH CONTEXT\nClaude evidence",
      );
      expect(harness.fetchHandoffInputs).toEqual([
        { threadId: ThreadId.make("thread-1"), runId: "fetch-run-claude" },
      ]);
    }),
  );

  it.each([
    {
      label: "Cursor main with Codex Fetch",
      mainSelection: {
        instanceId: ProviderInstanceId.make("cursor"),
        model: "cursor-sonnet-4.5",
      } satisfies ModelSelection,
      mainDriver: "cursor",
      fetchSelection: {
        instanceId: ProviderInstanceId.make("codex_fetch"),
        model: "gpt-5.6-luna",
        options: [
          { id: "reasoningEffort", value: "low" },
          { id: "serviceTier", value: "priority" },
        ],
      } satisfies ModelSelection,
      fetchDriver: "codex",
    },
    {
      label: "Grok main with OpenCode Fetch",
      mainSelection: {
        instanceId: ProviderInstanceId.make("grok"),
        model: "grok-code-fast-1",
      } satisfies ModelSelection,
      mainDriver: "grok",
      fetchSelection: {
        instanceId: ProviderInstanceId.make("opencode_fetch"),
        model: "anthropic/claude-sonnet-4-5",
        options: [{ id: "reasoningEffort", value: "high" }],
      } satisfies ModelSelection,
      fetchDriver: "opencode",
    },
  ])("routes $label independently with exact Fetch traits", async (testCase) => {
    const harness = await createHarness({
      threadModelSelection: testCase.mainSelection,
      fetchModelSelection: testCase.fetchSelection,
      providerSnapshots: [
        fetchProviderFixture({
          instanceId: testCase.mainSelection.instanceId,
          driver: testCase.mainDriver,
          models: [testCase.mainSelection.model],
        }),
        fetchProviderFixture({
          instanceId: testCase.fetchSelection.instanceId,
          driver: testCase.fetchDriver,
          models: [testCase.fetchSelection.model],
        }),
      ],
    });
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`cmd-${testCase.label.replaceAll(" ", "-")}`),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId(`message-${testCase.label.replaceAll(" ", "-")}`),
          role: "user",
          text: `verify ${testCase.label}`,
          attachments: [],
        },
        fetchMode: "repository-exploration",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      providerInstanceId: testCase.mainSelection.instanceId,
      modelSelection: testCase.mainSelection,
    });
    expect(harness.runFetch.mock.calls[0]?.[0]).toMatchObject({
      modelSelection: testCase.fetchSelection,
      providerDriver: ProviderDriverKind.make(testCase.fetchDriver),
      commandExecutionPolicy: "deny",
    });
  });

  it.each([
    {
      label: "planner failure",
      warning: "Fetch planning failed; the main agent continued without repository workers.",
      plannedWorkers: 0,
      completedWorkers: 0,
      successfulWorkers: 0,
      context: undefined,
    },
    {
      label: "partial worker failure",
      warning: "Fetch completed with partial results; failed workers were not retried.",
      plannedWorkers: 2,
      completedWorkers: 1,
      successfulWorkers: 1,
      context: "T3 FETCH CONTEXT\npartial evidence",
    },
    {
      label: "all-worker failure",
      warning: "Every Fetch worker failed or returned no findings; the main turn will continue.",
      plannedWorkers: 2,
      completedWorkers: 0,
      successfulWorkers: 0,
      context: undefined,
    },
  ])("continues the main turn after Fetch $label", async (testCase) => {
    const harness = await createHarness({
      runFetchEffect: (fetchInput) =>
        Effect.succeed({
          runId: `fetch-${testCase.label.replaceAll(" ", "-")}`,
          status: "completed",
          ...(testCase.context !== undefined ? { context: testCase.context } : {}),
          warnings: [testCase.warning],
          plannedWorkers: testCase.plannedWorkers,
          completedWorkers: testCase.completedWorkers,
          successfulWorkers: testCase.successfulWorkers,
          providerInstanceId: fetchInput.modelSelection.instanceId,
          providerDriver: fetchInput.providerDriver,
          modelSelection: fetchInput.modelSelection,
        }),
    });
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`cmd-fetch-${testCase.label.replaceAll(" ", "-")}`),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId(`message-fetch-${testCase.label.replaceAll(" ", "-")}`),
          role: "user",
          text: `continue after ${testCase.label}`,
          attachments: [],
        },
        fetchMode: "repository-exploration",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    const providerInput = harness.sendTurn.mock.calls[0]?.[0]?.input;
    expect(providerInput).toContain(`continue after ${testCase.label}`);
    if (testCase.context !== undefined) expect(providerInput).toContain(testCase.context);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fetch.warning",
          payload: expect.objectContaining({ detail: testCase.warning }),
        }),
      ]),
    );
  });

  it("keeps a full-size main request unchanged and warns when no Fetch context space remains", async () => {
    const mainRequest = "u".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
    const harness = await createHarness({
      runFetchEffect: (fetchInput) =>
        Effect.succeed({
          runId: "fetch-no-context-space",
          status: "completed",
          warnings: [],
          plannedWorkers: 1,
          completedWorkers: 1,
          successfulWorkers: 1,
          providerInstanceId: fetchInput.modelSelection.instanceId,
          providerDriver: fetchInput.providerDriver,
          modelSelection: fetchInput.modelSelection,
        }),
    });
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-fetch-no-context-space"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("message-fetch-no-context-space"),
          role: "user",
          text: mainRequest,
          attachments: [],
        },
        fetchMode: "repository-exploration",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.runFetch.mock.calls[0]?.[0]?.contextMaxChars).toBe(0);
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe(mainRequest);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.activities.some((activity) => activity.kind === "coordination.warning")).toBe(
      false,
    );
    expect(thread?.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fetch.warning",
          summary: "Fetch context omitted",
        }),
      ]),
    );
  });

  it("continues unchanged and warns when an explicit Fetch selection is unavailable", async () => {
    const harness = await createHarness({
      fetchModelSelection: {
        instanceId: ProviderInstanceId.make("claude_disabled"),
        model: "claude-opus-4-6",
        options: [{ id: "effort", value: "high" }],
      },
      providerSnapshots: [
        fetchProviderFixture({
          instanceId: "codex",
          driver: "codex",
          models: ["gpt-5-codex", "gpt-5.3-codex-spark", "gpt-5.6-luna"],
        }),
        fetchProviderFixture({
          instanceId: "claude_disabled",
          driver: "claudeAgent",
          models: ["claude-opus-4-6"],
          enabled: false,
        }),
      ],
    });
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-fetch-unavailable"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-fetch-unavailable"),
          role: "user",
          text: "continue without unavailable Fetch",
          attachments: [],
        },
        fetchMode: "repository-exploration",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.runFetch).not.toHaveBeenCalled();
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toBe("continue without unavailable Fetch");
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "fetch.warning",
          summary: "Fetch unavailable",
          payload: expect.objectContaining({
            detail: expect.stringContaining("T3 did not substitute another model"),
          }),
        }),
      ]),
    );
  });

  it("does not invoke Fetch coordination when the turn has no Fetch mode", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-without-fetch"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-without-fetch"),
          role: "user",
          text: "normal provider turn",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.runFetch).not.toHaveBeenCalled();
    expect(harness.fetchHandoffInputs).toHaveLength(0);
  });

  it("does not dispatch the main turn when Fetch cancellation wins the handoff", async () => {
    const harness = await createHarness({ fetchHandoffAllowed: false });
    const now = "2026-01-01T00:00:00.000Z";
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-fetch-cancelled-at-handoff"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-fetch-cancelled-at-handoff"),
          role: "user",
          text: "do not send after stop",
          attachments: [],
        },
        fetchMode: "repository-exploration",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.fetchHandoffInputs.length === 1);
    expect(harness.sendTurnExecutions).toBe(0);
  });

  effectIt.effect("projects starting before a slow provider session finishes", () =>
    Effect.gen(function* () {
      const releaseStart = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          startSessionEffect: (session) => Deferred.await(releaseStart).pipe(Effect.as(session)),
        }),
      );
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-slow-provider"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-slow-provider"),
          role: "user",
          text: "start slowly",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });

      yield* Effect.promise(() => waitFor(() => harness.startSession.mock.calls.length === 1));
      const duringStartup = yield* Effect.promise(() => harness.readModel());
      expect(
        duringStartup.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.session
          ?.status,
      ).toBe("starting");
      expect(harness.sendTurn).not.toHaveBeenCalled();

      yield* Deferred.succeed(releaseStart, undefined);
      yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));
    }),
  );

  effectIt.effect("settles a failed provider startup and allows a clean retry", () =>
    Effect.gen(function* () {
      let failStartup = true;
      const harness = yield* Effect.promise(() =>
        createHarness({
          startSessionEffect: (session) =>
            failStartup
              ? Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "codex",
                    method: "thread.start",
                    detail: "deterministic startup failure",
                  }),
                )
              : Effect.succeed(session),
        }),
      );
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-failure"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-failure"),
          role: "user",
          text: "fail once",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });

      yield* Effect.promise(() =>
        waitFor(async () => {
          const readModel = await harness.readModel();
          return (
            readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.session
              ?.status === "error"
          );
        }),
      );
      let readModel = yield* Effect.promise(() => harness.readModel());
      let thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session?.lastError).toContain("deterministic startup failure");
      expect(harness.sendTurn).not.toHaveBeenCalled();

      failStartup = false;
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-retry"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-retry"),
          role: "user",
          text: "retry",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      });

      yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));
      readModel = yield* Effect.promise(() => harness.readModel());
      thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session?.status).toBe("starting");
      expect(thread?.session?.lastError).toBeNull();
    }),
  );

  it("retries thread title generation after a transient failure", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const seededTitle = "Please investigate reconnect failures after restar...";
    let attempts = 0;
    harness.generateThreadTitle.mockReturnValue(
      Effect.suspend(() => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(
              new TextGenerationError({
                operation: "generateThreadTitle",
                detail: "Claude CLI request timed out.",
              }),
            )
          : Effect.succeed({ title: "Generated title" });
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-seed"),
        threadId: ThreadId.make("thread-1"),
        title: seededTitle,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-title"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-title"),
          role: "user",
          text: "Please investigate reconnect failures after restarting the session.",
          attachments: [],
        },
        titleSeed: seededTitle,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1);
    expect(harness.generateThreadTitle.mock.calls[0]?.[0]).toMatchObject({
      message: "Please investigate reconnect failures after restarting the session.",
    });

    await waitFor(async () => {
      const readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.title ===
        "Generated title"
      );
    });
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Generated title");
    expect(attempts).toBe(2);
  });

  it("regenerates a thread title from the current conversation", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Resolve stale reconnect state" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-existing"),
        threadId: ThreadId.make("thread-1"),
        title: "Investigate reconnect regressions",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-title-regeneration"),
          role: "user",
          text: "Please investigate reconnect regressions after restarting the session.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: CommandId.make("cmd-assistant-before-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-message-before-title-regeneration"),
        delta: "The remaining issue is stale reconnect state.",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.make("cmd-assistant-complete-before-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-message-before-title-regeneration"),
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regenerate"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
    expect(harness.generateThreadTitle.mock.calls[0]?.[0]).toMatchObject({
      cwd: "/tmp/provider-project",
      previousTitle: "Investigate reconnect regressions",
      message: [
        "USER:",
        "Please investigate reconnect regressions after restarting the session.",
        "",
        "ASSISTANT:",
        "The remaining issue is stale reconnect state.",
      ].join("\n"),
    });
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Resolve stale reconnect state");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("pins the first user message when regeneration context is truncated", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const firstUserMessage = `Review subagent monitoring risks. ${"Opening context. ".repeat(200)}`;
    const recentUserMessage = `LATEST FINDING: ${"implementation detail ".repeat(320)}`;
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Review subagent monitoring risks" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-existing-long"),
        threadId: ThreadId.make("thread-1"),
        title: "Generic PR review",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-long-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-long-title-regeneration"),
          role: "user",
          text: firstUserMessage,
          attachments: [
            {
              type: "image",
              id: "opening-context-image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-middle-turn-before-long-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("middle-message-before-long-title-regeneration"),
          role: "user",
          text: "Temporary handoff details.",
          attachments: [
            {
              type: "image",
              id: "middle-context-image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-recent-turn-before-long-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("recent-message-before-long-title-regeneration"),
          role: "user",
          text: recentUserMessage,
          attachments: [
            {
              type: "image",
              id: "recent-context-image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regenerate-long"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
    const input = harness.generateThreadTitle.mock.calls[0]?.[0];
    if (!input) {
      throw new Error("Expected a title generation input");
    }
    const message = input.message;
    expect(message.startsWith("USER:\nReview subagent monitoring risks.")).toBe(true);
    expect(message).toContain("[First user message truncated]");
    expect(message).toContain("[Earlier content truncated]");
    expect(message).toContain("image.png");
    expect(message).toHaveLength(8_000);
    expect(input.attachments?.map((attachment) => attachment.id)).toEqual([
      "opening-context-image",
      "recent-context-image",
    ]);
  });

  it("clears title regeneration state left pending across reactor startup", async () => {
    const harness = await createHarness({
      titleRegenerationBeforeStart: "one",
    });

    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(1);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Thread");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("continues clearing startup title regeneration state after one completion fails", async () => {
    const harness = await createHarness({
      titleRegenerationBeforeStart: "two",
      titleRegenerationCompletionDispatchFailures: 1,
    });

    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(2);
    const readModel = await harness.readModel();
    expect(
      readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.titleRegeneration,
    ).not.toBeNull();
    expect(
      readModel.threads.find((entry) => entry.id === ThreadId.make("thread-2"))?.titleRegeneration,
    ).toBeNull();
  });

  it("keeps the current title when regeneration returns the fallback", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(Effect.succeed({ title: "New thread" }));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-fallback-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep meaningful title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-fallback-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-fallback-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-fallback-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep meaningful title");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("clears title regeneration state when generation fails", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-failed-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep title after failure",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-failed-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-failed-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-failed-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep title after failure");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("retries a failed completion and continues regenerating", async () => {
    const harness = await createHarness({
      titleRegenerationCompletionDispatchFailures: 1,
    });
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle
      .mockReturnValueOnce(Effect.succeed({ title: "Title lost to completion failure" }))
      .mockReturnValueOnce(Effect.succeed({ title: "Recovered regeneration worker" }));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-completion-failure"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regeneration-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.drain();

    let readModel = await harness.readModel();
    let thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Title lost to completion failure");
    expect(thread?.titleRegeneration).toBeNull();

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regeneration-after-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(2);
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(3);
    readModel = await harness.readModel();
    thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Recovered regeneration worker");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("pins the first user context and attachment before the retained tail", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const firstUserContext = "USER:\nOld visual issue\n[Attachments: old-issue.png]";
    const truncationMarker = "[Earlier content truncated]\n\n";
    const retainedContext = "x".repeat(
      8_000 - firstUserContext.length - "\n\n".length - truncationMarker.length,
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-truncated-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-truncated-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-truncated-regeneration"),
          role: "user",
          text: "Old visual issue",
          attachments: [
            {
              type: "image",
              id: "old-title-context-image",
              name: "old-issue.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: CommandId.make("cmd-assistant-truncated-regeneration-context"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-truncated-regeneration-context"),
        delta: `content before retained tail${"x".repeat(8_100)}`,
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.make("cmd-assistant-truncated-regeneration-context-complete"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-truncated-regeneration-context"),
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regenerate-truncated-context"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    expect(harness.generateThreadTitle.mock.calls[0]?.[0].message).toBe(
      `${firstUserContext}\n\n${truncationMarker}${retainedContext}`,
    );
    expect(harness.generateThreadTitle.mock.calls[0]?.[0].attachments).toEqual([
      expect.objectContaining({
        id: "old-title-context-image",
        name: "old-issue.png",
      }),
    ]);
  });

  it("does not overwrite a manual rename while title regeneration is running", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const generatedTitle = await harness.runEffect(
      Deferred.make<{ readonly title: string }, never>(),
    );
    harness.generateThreadTitle.mockReturnValue(Deferred.await(generatedTitle));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-regeneration-race"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing thread title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-regeneration-race"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-regeneration-race"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regeneration-race"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1);
    const pendingReadModel = await harness.readModel();
    expect(
      pendingReadModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))
        ?.titleRegeneration?.requestId,
    ).toBe(CommandId.make("cmd-thread-title-regeneration-race"));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-manual-rename-during-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep manual rename",
      }),
    );
    await harness.runEffect(
      Deferred.succeed(generatedTitle, { title: "Generated title should not win" }),
    );
    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep manual rename");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("does not overwrite a manual rename while title regeneration is queued", async () => {
    let releaseStart = () => {};
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const harness = await createHarness({
      startSessionEffect: (session) => Effect.promise(() => startGate).pipe(Effect.as(session)),
    });
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Generated title should not win" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-queued-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing thread title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-queued-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-queued-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.startSession.mock.calls.length === 1);

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-queued-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-manual-rename-before-regeneration-starts"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep queued manual rename",
      }),
    );
    releaseStart();
    await harness.drain();

    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep queued manual rename");
  });

  it("skips superseded title regeneration before generation starts", async () => {
    let releaseStart = () => {};
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const harness = await createHarness({
      startSessionEffect: (session) => Effect.promise(() => startGate).pipe(Effect.as(session)),
    });
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Latest regenerated title" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-superseded-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-superseded-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.startSession.mock.calls.length === 1);

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-superseded-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-latest-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    releaseStart();
    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(1);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Latest regenerated title");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("does not overwrite an existing custom thread title on the first turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const seededTitle = "Please investigate reconnect failures after restar...";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-custom"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep this custom title",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-title-preserve"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-title-preserve"),
          role: "user",
          text: "Please investigate reconnect failures after restarting the session.",
          attachments: [],
        },
        titleSeed: seededTitle,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.generateThreadTitle).not.toHaveBeenCalled();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep this custom title");
  });

  it("matches the client-seeded title even when the outgoing prompt is reformatted", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const seededTitle = "Fix reconnect spinner on resume";
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({
        title: "Reconnect spinner resume bug",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-formatted-seed"),
        threadId: ThreadId.make("thread-1"),
        title: seededTitle,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-title-formatted"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-title-formatted"),
          role: "user",
          text: "[effort:high]\\n\\nFix reconnect spinner on resume",
          attachments: [],
        },
        titleSeed: seededTitle,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1);
    await waitFor(async () => {
      const readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.title ===
        "Reconnect spinner resume bug"
      );
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Reconnect spinner resume bug");
  });

  it("generates first-turn title and worktree branch in one metadata call", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6",
        options: [{ id: "reasoningEffort", value: "max" }],
      },
      serverSettings: {
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6-luna",
          options: [
            { id: "reasoningEffort", value: "high" },
            { id: "serviceTier", value: "priority" },
          ],
        },
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-branch"),
        threadId: ThreadId.make("thread-1"),
        title: "Add a safer reconnect backoff.",
        branch: "t3code/1234abcd",
        worktreePath: "/tmp/provider-project-worktree",
      }),
    );

    harness.generateThreadMetadata.mockReturnValue(
      Effect.succeed({
        title: "Safer reconnect backoff",
        branch: "safer-reconnect-backoff",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-branch-model"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-branch-model"),
          role: "user",
          text: "Add a safer reconnect backoff.",
          attachments: [],
        },
        titleSeed: "Add a safer reconnect backoff.",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.generateThreadMetadata.mock.calls.length === 1);
    await waitFor(() => harness.refreshStatus.mock.calls.length === 1);
    await waitFor(async () => {
      const readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.title ===
        "Safer reconnect backoff"
      );
    });
    expect(harness.generateThreadMetadata.mock.calls[0]?.[0]).toMatchObject({
      message: "Add a safer reconnect backoff.",
      modelSelection: {
        model: "gpt-5.6-luna",
        options: [
          { id: "serviceTier", value: "priority" },
          { id: "reasoningEffort", value: "low" },
        ],
      },
    });
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        model: "gpt-5.6",
        options: [{ id: "reasoningEffort", value: "max" }],
      },
    });
    expect(harness.generateBranchName).not.toHaveBeenCalled();
    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    expect(harness.renameBranch).toHaveBeenCalledWith({
      cwd: "/tmp/provider-project-worktree",
      oldBranch: "t3code/1234abcd",
      newBranch: "t3code/safer-reconnect-backoff",
    });
    expect(harness.refreshStatus.mock.calls[0]?.[0]).toBe("/tmp/provider-project-worktree");
  });

  it("recreates a missing worktree from the thread branch before starting a turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const worktreePath = NodePath.join(harness.stateDir, "missing-worktree");

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-missing-worktree"),
        threadId: ThreadId.make("thread-1"),
        branch: "feature/restore",
        worktreePath,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-missing-worktree"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-missing-worktree"),
          role: "user",
          text: "continue",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    expect(harness.pruneWorktrees).toHaveBeenCalledWith({ cwd: "/tmp/provider-project" });
    expect(harness.createWorktree).toHaveBeenCalledWith({
      cwd: "/tmp/provider-project",
      refName: "feature/restore",
      path: worktreePath,
    });
    expect(harness.createWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      harness.startSession.mock.invocationCallOrder[0]!,
    );
  });

  it("resolves Auto Reasoning once per submitted user message and reuses it for retries", async () => {
    const model = "gpt-5.6-sol";
    const autoSelection = createModelSelection(ProviderInstanceId.make("codex"), model, [
      { id: "reasoningEffort", value: "low" },
      { id: "t3AutoReasoning", value: true },
      { id: "serviceTier", value: "priority" },
    ]);
    const routerSelection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-luna", [
      { id: "reasoningEffort", value: "low" },
      { id: "t3AutoReasoning", value: true },
    ]);
    let decisionCount = 0;
    const harness = await createHarness({
      threadModelSelection: createModelSelection(ProviderInstanceId.make("codex"), model, [
        { id: "reasoningEffort", value: "low" },
      ]),
      providerSnapshots: [codexAutoReasoningProviderFixture(model)],
      serverSettings: { autoReasoningModelSelection: routerSelection },
      decideAutoReasoningEffect: () =>
        Effect.sync(() =>
          ++decisionCount === 1
            ? {
                effort: "high",
                usage: { inputTokens: 120, outputTokens: 4, totalTokens: 124 },
              }
            : decisionCount === 2
              ? { effort: "xhigh" }
              : { effort: "low" },
        ),
    });
    const completeMainPrompt = `${"implement carefully ".repeat(2_500)}MAIN_PROMPT_TAIL`;
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.import",
        commandId: CommandId.make("cmd-auto-reasoning-prior-user-import"),
        threadId: ThreadId.make("thread-1"),
        message: {
          id: asMessageId("user-message-auto-reasoning-prior"),
          role: "user",
          text: "Original work items: contract and server wiring",
          turnId: null,
          streaming: false,
          createdAt: "2025-12-31T23:59:58.000Z",
          updatedAt: "2025-12-31T23:59:58.000Z",
        },
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.import",
        commandId: CommandId.make("cmd-auto-reasoning-prior-assistant-import"),
        threadId: ThreadId.make("thread-1"),
        message: {
          id: asMessageId("assistant-message-auto-reasoning-prior"),
          role: "assistant",
          text: "Contract and server wiring are complete.",
          turnId: null,
          streaming: false,
          createdAt: "2025-12-31T23:59:59.000Z",
          updatedAt: "2025-12-31T23:59:59.000Z",
        },
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.interaction-mode.set",
        commandId: CommandId.make("cmd-auto-reasoning-plan-mode"),
        threadId: ThreadId.make("thread-1"),
        interactionMode: "plan",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-auto-reasoning-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-auto-reasoning-1"),
          role: "user",
          text: completeMainPrompt,
          attachments: [
            {
              type: "image",
              id: "architecture-image",
              name: "architecture.png",
              mimeType: "image/png",
              sizeBytes: 42,
            },
          ],
        },
        modelSelection: autoSelection,
        interactionMode: "plan",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.decideAutoReasoning).toHaveBeenCalledTimes(1);
    expect(harness.decideAutoReasoning.mock.calls[0]?.[0]).toMatchObject({
      userPrompt: completeMainPrompt,
      interactionMode: "plan",
      allowedEfforts: ["low", "medium", "high", "xhigh"],
      attachments: [
        {
          type: "image",
          name: "architecture.png",
          mimeType: "image/png",
          sizeBytes: 42,
        },
      ],
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
      conversation: [
        { role: "user", text: "Original work items: contract and server wiring" },
        { role: "assistant", text: "Contract and server wiring are complete." },
      ],
    });
    expect(harness.decideAutoReasoning.mock.invocationCallOrder[0]).toBeLessThan(
      harness.startSession.mock.invocationCallOrder[0]!,
    );
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
        ],
      },
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      input: completeMainPrompt,
      modelSelection: {
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "priority" },
        ],
      },
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.import",
        commandId: CommandId.make("cmd-auto-reasoning-assistant-import"),
        threadId: ThreadId.make("thread-1"),
        message: {
          id: asMessageId("assistant-message-auto-reasoning-1"),
          role: "assistant",
          text: "Previous assistant result",
          turnId: null,
          streaming: false,
          createdAt: "2026-01-01T00:00:01.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-auto-reasoning-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-auto-reasoning-2"),
          role: "user",
          text: "Follow up without changing sessions",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.decideAutoReasoning).toHaveBeenCalledTimes(2);
    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.decideAutoReasoning.mock.calls[1]?.[0].userPrompt).toBe(
      "Follow up without changing sessions",
    );
    expect(harness.decideAutoReasoning.mock.calls[1]?.[0].conversation).toEqual([
      { role: "assistant", text: "Contract and server wiring are complete." },
      { role: "user", text: completeMainPrompt },
      { role: "assistant", text: "Previous assistant result" },
    ]);
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      input: "Follow up without changing sessions",
      modelSelection: {
        options: [
          { id: "reasoningEffort", value: "xhigh" },
          { id: "serviceTier", value: "priority" },
        ],
      },
    });
    await waitFor(async () => {
      const current = await harness.readModel();
      return (
        current.threads
          .find((entry) => entry.id === ThreadId.make("thread-1"))
          ?.activities.filter((activity) => activity.kind === "auto-reasoning.resolved").length ===
        2
      );
    });
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.modelSelection).toEqual(autoSelection);
    expect(
      thread?.activities
        .filter((activity) => activity.kind === "auto-reasoning.resolved")
        .map((activity) => ({ turnId: activity.turnId, payload: activity.payload })),
    ).toEqual([
      {
        turnId: asTurnId("turn-1"),
        payload: {
          autoReasoningEffort: "high",
          autoReasoningFallback: false,
          autoReasoningRouterModel: {
            instanceId: "codex",
            model: "gpt-5.6-luna",
          },
          autoReasoningDurationMs: expect.any(Number),
          autoReasoningUsage: { inputTokens: 120, outputTokens: 4, totalTokens: 124 },
        },
      },
      {
        turnId: asTurnId("turn-2"),
        payload: {
          autoReasoningEffort: "xhigh",
          autoReasoningFallback: false,
          autoReasoningRouterModel: {
            instanceId: "codex",
            model: "gpt-5.6-luna",
          },
          autoReasoningDurationMs: expect.any(Number),
          autoReasoningUsage: null,
        },
      },
    ]);

    const retryRuntimeSessionId = RuntimeSessionId.make("runtime-auto-reasoning-retry");
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-aborting-auto-reasoning-retry"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId: retryRuntimeSessionId,
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-2"),
          abortState: {
            runtimeSessionId: retryRuntimeSessionId,
            targetTurnId: asTurnId("turn-2"),
            phase: "interrupting",
            requestedAt: "2026-01-01T00:00:03.000Z",
            forceAt: "2026-01-01T00:00:08.000Z",
          },
          lastError: null,
          updatedAt: "2026-01-01T00:00:03.000Z",
        },
        createdAt: "2026-01-01T00:00:03.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.abort.settle",
        commandId: CommandId.make("cmd-abort-settle-auto-reasoning-retry"),
        threadId: ThreadId.make("thread-1"),
        runtimeSessionId: retryRuntimeSessionId,
        turnId: asTurnId("turn-2"),
        outcome: "cooperative",
        settledAt: "2026-01-01T00:00:04.000Z",
        createdAt: "2026-01-01T00:00:04.000Z",
      }),
    );

    harness.sendTurn.mockClear();
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.retry",
        commandId: CommandId.make("cmd-auto-reasoning-retry"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-2"),
        messageId: asMessageId("user-message-auto-reasoning-2"),
        createdAt: "2026-01-01T00:00:05.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    await harness.drain();
    expect(harness.decideAutoReasoning).toHaveBeenCalledTimes(2);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      modelSelection: {
        options: [
          { id: "reasoningEffort", value: "xhigh" },
          { id: "serviceTier", value: "priority" },
        ],
      },
    });
  });

  it("bypasses Auto Reasoning for manual Codex effort selections", async () => {
    const model = "gpt-5.6-sol";
    const manualSelection = createModelSelection(ProviderInstanceId.make("codex"), model, [
      { id: "reasoningEffort", value: "high" },
    ]);
    const harness = await createHarness({
      threadModelSelection: manualSelection,
      providerSnapshots: [codexAutoReasoningProviderFixture(model)],
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-manual-reasoning"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-manual-reasoning"),
          role: "user",
          text: "Use my manual effort",
          attachments: [],
        },
        modelSelection: manualSelection,
        interactionMode: "default",
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.decideAutoReasoning).not.toHaveBeenCalled();
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      modelSelection: {
        ...manualSelection,
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "serviceTier", value: "default" },
        ],
      },
    });
  });

  it("falls back to the stored concrete effort for an invalid routing decision", async () => {
    const model = "gpt-5.6-sol";
    const autoSelection = createModelSelection(ProviderInstanceId.make("codex"), model, [
      { id: "reasoningEffort", value: "low" },
      { id: "t3AutoReasoning", value: true },
    ]);
    const harness = await createHarness({
      threadModelSelection: autoSelection,
      providerSnapshots: [codexAutoReasoningProviderFixture(model)],
      decideAutoReasoningEffect: () => Effect.succeed({ effort: "unsupported" }),
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-auto-reasoning-invalid"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-auto-reasoning-invalid"),
          role: "user",
          text: "Continue even if routing fails",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.decideAutoReasoning).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      modelSelection: {
        options: [
          { id: "reasoningEffort", value: "low" },
          { id: "serviceTier", value: "default" },
        ],
      },
    });
  });

  it("falls back to the stored concrete effort when routing fails", async () => {
    const model = "gpt-5.6-sol";
    const autoSelection = createModelSelection(ProviderInstanceId.make("codex"), model, [
      { id: "reasoningEffort", value: "medium" },
      { id: "t3AutoReasoning", value: true },
    ]);
    const harness = await createHarness({
      threadModelSelection: autoSelection,
      providerSnapshots: [codexAutoReasoningProviderFixture(model)],
      decideAutoReasoningEffect: () =>
        Effect.fail(
          new TextGenerationError({
            operation: "decideAutoReasoning",
            detail: "router unavailable",
          }),
        ),
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-auto-reasoning-failure"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-auto-reasoning-failure"),
          role: "user",
          text: "Continue even when the router is unavailable",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.decideAutoReasoning).toHaveBeenCalledTimes(1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      modelSelection: {
        options: [
          { id: "reasoningEffort", value: "medium" },
          { id: "serviceTier", value: "default" },
        ],
      },
    });
  });

  it("uses the concrete fallback without routing when live efforts are unavailable", async () => {
    const model = "gpt-5.6-sol";
    const autoSelection = createModelSelection(ProviderInstanceId.make("codex"), model, [
      { id: "reasoningEffort", value: "medium" },
      { id: "t3AutoReasoning", value: true },
    ]);
    const harness = await createHarness({ threadModelSelection: autoSelection });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-auto-reasoning-unavailable"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-auto-reasoning-unavailable"),
          role: "user",
          text: "Fallback without a live descriptor",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.decideAutoReasoning).not.toHaveBeenCalled();
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      modelSelection: {
        options: [{ id: "reasoningEffort", value: "medium" }],
      },
    });
  });

  it("canonicalizes legacy codex fast mode through session start and turn send", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-fast"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-fast"),
          role: "user",
          text: "hello fast mode",
          attachments: [],
        },
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ]),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
      ]),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
      ]),
    });
  });

  it("forwards claude effort options through session start and turn send", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-effort"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-effort"),
          role: "user",
          text: "hello with effort",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-sonnet-4-6",
          [{ id: "effort", value: "max" }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-sonnet-4-6",
        [{ id: "effort", value: "max" }],
      ),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-sonnet-4-6",
        [{ id: "effort", value: "max" }],
      ),
    });
  });

  it("forwards claude fast mode options through session start and turn send", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-fast-mode"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-fast-mode"),
          role: "user",
          text: "hello with fast mode",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-opus-4-6",
          [{ id: "fastMode", value: true }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-opus-4-6",
        [{ id: "fastMode", value: true }],
      ),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-opus-4-6",
        [{ id: "fastMode", value: true }],
      ),
    });
  });

  it("forwards plan interaction mode to the provider turn request", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.interaction-mode.set",
        commandId: CommandId.make("cmd-interaction-mode-set-plan"),
        threadId: ThreadId.make("thread-1"),
        interactionMode: "plan",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-plan"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-plan"),
          role: "user",
          text: "plan this change",
          attachments: [],
        },
        interactionMode: "plan",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      interactionMode: "plan",
    });
  });

  it("preserves the active session model when in-session model switching is unsupported", async () => {
    const harness = await createHarness({ sessionModelSwitch: "unsupported" });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unsupported-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unsupported-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unsupported-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unsupported-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
    });
  });

  it("starts fresh with transcript handoff when a provider requires a new session for model changes", async () => {
    const harness = await createHarness({ requiresNewThreadForModelChange: true });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-restricted-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-restricted-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.message.import",
        commandId: CommandId.make("cmd-import-restricted-answer"),
        threadId: ThreadId.make("thread-1"),
        message: {
          id: asMessageId("assistant-message-restricted-1"),
          role: "assistant",
          text: "completed answer",
          turnId: null,
          streaming: false,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-restricted-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-restricted-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.1-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({ freshSession: true });
    expect(harness.startSession.mock.calls[1]?.[1]).not.toHaveProperty("resumeCursor");
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.1-codex",
      },
    });
    const switchedRequest = harness.sendTurn.mock.calls[1]?.[0];
    expect(switchedRequest?.input).toBe("second");
    expect(switchedRequest?.transcriptHandoff?.text).toContain("[user]\nfirst\n[/user]");
    expect(switchedRequest?.transcriptHandoff?.text).toContain(
      "[assistant]\ncompleted answer\n[/assistant]",
    );

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.modelSelection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.1-codex",
    });
  });

  it("starts a first turn on the requested provider instance even when it differs from the thread model", async () => {
    const harness = await createHarness({
      threadModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-first"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-first"),
          role: "user",
          text: "hello claude",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.providerName).toBe("claudeAgent");
    expect(thread?.session?.providerInstanceId).toBe(ProviderInstanceId.make("claudeAgent"));
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toBeUndefined();
  });

  it("reuses the same provider session when runtime mode is unchanged", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unchanged-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unchanged-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unchanged-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unchanged-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls.length).toBe(1);
    expect(harness.stopSession.mock.calls.length).toBe(0);
  });

  it("restarts an existing Codex thread on a compatible requested instance", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-compatible-codex-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-compatible-codex-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-compatible-codex-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-compatible-codex-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex_work"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.startSession).toHaveBeenCalledTimes(2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex_work"),
      resumeCursor: { opaque: "resume-1" },
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.providerInstanceId).toBe(ProviderInstanceId.make("codex_work"));
  });

  it("restarts the provider session when the thread workspace changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-workspace-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-workspace-1"),
          role: "user",
          text: "first in project root",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-worktree-change"),
        threadId: ThreadId.make("thread-1"),
        worktreePath: "/tmp/provider-project-worktree",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-workspace-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-workspace-2"),
          role: "user",
          text: "second in worktree",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      cwd: "/tmp/provider-project-worktree",
      resumeCursor: { opaque: "resume-1" },
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
      runtimeMode: "approval-required",
    });
  });

  it("restarts and resumes a gateway GPT session when effort changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-codex-gpt-5.4",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-effort-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-effort-1"),
          role: "user",
          text: "first claude turn",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-codex-gpt-5.4",
          [{ id: "effort", value: "medium" }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-effort-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-effort-2"),
          role: "user",
          text: "second claude turn",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-codex-gpt-5.4",
          [{ id: "effort", value: "max" }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      resumeCursor: { opaque: "resume-1" },
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-codex-gpt-5.4",
        [{ id: "effort", value: "max" }],
      ),
    });
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-codex-gpt-5.4",
        [{ id: "effort", value: "max" }],
      ),
    });
  });

  it("restarts and resumes a gateway GPT session when Fast is enabled and disabled", async () => {
    const model = "claude-codex-gpt-5.4";
    const providerInstanceId = ProviderInstanceId.make("claudeAgent");
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: providerInstanceId,
        model,
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    const startTurn = async (input: {
      readonly index: number;
      readonly fastMode: boolean;
    }): Promise<void> => {
      const modelSelection = createModelSelection(providerInstanceId, model, [
        { id: "effort", value: "high" },
        { id: "fastMode", value: input.fastMode },
      ]);
      await Effect.runPromise(
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`cmd-turn-start-gpt-fast-${input.index}`),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId(`user-message-gpt-fast-${input.index}`),
            role: "user",
            text: `gateway GPT turn ${input.index}`,
            attachments: [],
          },
          modelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        }),
      );
      await waitFor(() => harness.startSession.mock.calls.length === input.index);
      await waitFor(() => harness.sendTurn.mock.calls.length === input.index);
      expect(harness.startSession.mock.calls[input.index - 1]?.[1]).toMatchObject({
        ...(input.index > 1 ? { resumeCursor: { opaque: "resume-1" } } : {}),
        modelSelection,
      });
      expect(harness.sendTurn.mock.calls[input.index - 1]?.[0]).toMatchObject({
        threadId: ThreadId.make("thread-1"),
        modelSelection,
      });
    };

    await startTurn({ index: 1, fastMode: false });
    await startTurn({ index: 2, fastMode: true });
    await startTurn({ index: 3, fastMode: false });

    expect(harness.startSession).toHaveBeenCalledTimes(3);
  });

  it("restarts the provider session when runtime mode is updated on the thread", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-initial-full-access"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-runtime-mode-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-runtime-mode-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-1"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return thread?.runtimeMode === "approval-required";
    });
    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-runtime-mode-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-runtime-mode-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      resumeCursor: { opaque: "resume-1" },
      runtimeMode: "approval-required",
    });
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
  });

  it("does not inject derived model options when restarting claude on runtime mode changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-runtime-mode-claude"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-claude-no-options"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);

    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
      runtimeMode: "approval-required",
    });
  });

  it("does not stop the active session when restart fails before rebind", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-initial-full-access-2"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-restart-failure-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-restart-failure-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    harness.startSession.mockImplementationOnce(
      (_: unknown, __: unknown) => Effect.fail("simulated restart failure") as never,
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-restart-failure"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return thread?.runtimeMode === "approval-required";
    });
    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await harness.drain();

    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.sendTurn.mock.calls.length).toBe(1);

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("full-access");
  });

  it("switches cross-driver providers with a fresh session and compact transcript handoff", async () => {
    const oldRuntimeSessionId = RuntimeSessionId.make("runtime-codex-before-switch");
    const newRuntimeSessionId = RuntimeSessionId.make("runtime-claude-after-switch");
    const harness = await createHarness({
      startSessionEffect: (session) =>
        Effect.succeed({
          ...session,
          runtimeSessionId:
            session.provider === ProviderDriverKind.make("claudeAgent")
              ? newRuntimeSessionId
              : oldRuntimeSessionId,
        }),
    });
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-switch-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-switch-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-switch-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-switch-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      provider: "claudeAgent",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      freshSession: true,
    });
    expect(harness.startSession.mock.calls[1]?.[1]).not.toHaveProperty("resumeCursor");
    expect(harness.sendTurn.mock.calls[1]?.[0]?.input).toBe("second");
    expect(harness.sendTurn.mock.calls[1]?.[0]?.transcriptHandoff?.text).toContain(
      "[user]\nfirst\n[/user]",
    );

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.providerName).toBe("claudeAgent");
    expect(thread?.session?.runtimeSessionId).toBe(newRuntimeSessionId);
    expect(thread?.session?.runtimeSessionId).not.toBe(oldRuntimeSessionId);
    expect(thread?.modelSelection.instanceId).toBe(ProviderInstanceId.make("claudeAgent"));
  });

  effectIt.effect(
    "clears the old runtime generation before switching a Codex thread to OpenCode Gemini",
    () =>
      Effect.gen(function* () {
        const oldRuntimeSessionId = RuntimeSessionId.make("runtime-codex-before-opencode");
        const newRuntimeSessionId = RuntimeSessionId.make("runtime-opencode-after-switch");
        const releaseOpenCodeStart = yield* Deferred.make<void>();
        const openCodeProvider = ProviderDriverKind.make("opencode");
        const openCodeInstanceId = ProviderInstanceId.make("opencode");
        const harness = yield* Effect.promise(() =>
          createHarness({
            startSessionEffect: (session) =>
              session.provider === openCodeProvider
                ? Deferred.await(releaseOpenCodeStart).pipe(
                    Effect.as({ ...session, runtimeSessionId: newRuntimeSessionId }),
                  )
                : Effect.succeed({ ...session, runtimeSessionId: oldRuntimeSessionId }),
          }),
        );
        const now = "2026-01-01T00:00:00.000Z";

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-codex-before-opencode"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("user-message-codex-before-opencode"),
            role: "user",
            text: "first",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        });
        yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-opencode-gemini"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("user-message-opencode-gemini"),
            role: "user",
            text: "continue with Gemini",
            attachments: [],
          },
          modelSelection: {
            instanceId: openCodeInstanceId,
            model: "google/gemini-2.5-flash",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        });

        yield* Effect.promise(() => waitFor(() => harness.startSession.mock.calls.length === 2));
        const duringStartup = yield* Effect.promise(() => harness.readModel());
        const startingThread = duringStartup.threads.find(
          (entry) => entry.id === ThreadId.make("thread-1"),
        );
        expect(startingThread?.session).toMatchObject({
          status: "starting",
          providerName: openCodeProvider,
          providerInstanceId: openCodeInstanceId,
          runtimeSessionId: null,
        });
        expect(harness.sendTurn).toHaveBeenCalledTimes(1);

        yield* Deferred.succeed(releaseOpenCodeStart, undefined);
        yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 2));

        const completedSwitch = yield* Effect.promise(() => harness.readModel());
        const switchedThread = completedSwitch.threads.find(
          (entry) => entry.id === ThreadId.make("thread-1"),
        );
        expect(switchedThread?.session).toMatchObject({
          providerName: openCodeProvider,
          providerInstanceId: openCodeInstanceId,
          runtimeSessionId: newRuntimeSessionId,
        });
        expect(switchedThread?.modelSelection).toMatchObject({
          instanceId: openCodeInstanceId,
          model: "google/gemini-2.5-flash",
        });
      }),
  );

  it("starts cross-driver provider changes fresh after the existing thread session has stopped", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-stopped-provider-switch"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "stopped",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-stopped-provider-switch"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-stopped-provider-switch"),
          role: "user",
          text: "continue with claude",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      provider: "claudeAgent",
      freshSession: true,
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]?.input).toContain("continue with claude");
  });

  it("routes thread.turn.interrupt-requested through the server abort lane", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeSessionId: null,
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-1"),
          abortState: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make("cmd-turn-interrupt"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-1"),
        createdAt: now,
      }),
    );

    await waitFor(() => harness.requestAbort.mock.calls.length === 1);
    expect(harness.requestAbort.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
      requestedAt: now,
    });
    expect(harness.interruptTurn).not.toHaveBeenCalled();
  });

  it("offers a stop to the active Fetch preflight before the normal abort lane", async () => {
    const harness = await createHarness({ fetchInterruptHandled: true });
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-fetch-preflight"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "starting",
          providerName: ProviderDriverKind.make("codex"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeSessionId: null,
          runtimeMode: "approval-required",
          activeTurnId: null,
          abortState: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make("cmd-turn-interrupt-fetch-preflight"),
        threadId: ThreadId.make("thread-1"),
        createdAt: now,
      }),
    );

    await waitFor(() => harness.requestFetchInterrupt.mock.calls.length === 1);
    expect(harness.requestFetchInterrupt.mock.calls[0]?.[0]).toEqual({
      threadId: ThreadId.make("thread-1"),
      requestedAt: now,
    });
    expect(harness.requestAbort).not.toHaveBeenCalled();
  });

  effectIt.effect("records a server abort-lane failure without owning provider settlement", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-abort-lane-failure"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-1"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });

      harness.requestAbort.mockImplementation(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: "codex",
            method: "abort.resolve-target",
            detail: "provider session disappeared",
          }),
        ),
      );

      yield* harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make("cmd-turn-interrupt-abort-lane-failure"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-1"),
        createdAt: now,
      });

      yield* Effect.promise(() => harness.drain());

      const thread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === ThreadId.make("thread-1"),
      );
      expect(thread?.session).toMatchObject({
        status: "running",
        activeTurnId: asTurnId("turn-1"),
        lastError: null,
        updatedAt: now,
      });
      expect(harness.stopSession).not.toHaveBeenCalled();
      expect(
        thread?.activities.find((activity) => activity.kind === "provider.turn.interrupt.failed"),
      ).toMatchObject({
        summary: "Provider turn interrupt failed",
        payload: { detail: "provider session disappeared" },
      });
    }),
  );

  it("starts a fresh session when only projected session state exists", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-stale"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-stale"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-stale"),
          role: "user",
          text: "resume codex",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
    });
  });

  it("rejects active runtime sessions that are missing provider instance ids", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-missing-instance"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    harness.runtimeSessions.push({
      provider: ProviderDriverKind.make("codex"),
      status: "ready",
      runtimeMode: "approval-required",
      threadId: ThreadId.make("thread-1"),
      cwd: "/tmp/provider-project",
      resumeCursor: { opaque: "resume-without-instance" },
      createdAt: now,
      updatedAt: now,
    });

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-missing-instance"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-missing-instance"),
          role: "user",
          text: "resume codex",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return (
        thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed") ??
        false
      );
    });

    expect(harness.startSession.mock.calls.length).toBe(0);
    expect(harness.sendTurn.mock.calls.length).toBe(0);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toMatchObject({
      payload: {
        detail: expect.stringContaining("without a provider instance id"),
      },
    });
  });

  it("reacts to thread.approval.respond by forwarding provider approval response", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-approval"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-respond"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("approval-request-1"),
        decision: "accept",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.respondToRequest.mock.calls.length === 1);
    expect(harness.respondToRequest.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
      requestId: "approval-request-1",
      decision: "accept",
    });
  });

  it("reacts to thread.user-input.respond by forwarding structured user input answers", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-user-input"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.user-input.respond",
        commandId: CommandId.make("cmd-user-input-respond"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("user-input-request-1"),
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: now,
      }),
    );

    await waitFor(() => harness.respondToUserInput.mock.calls.length === 1);
    expect(harness.respondToUserInput.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
      requestId: "user-input-request-1",
      answers: {
        sandbox_mode: "workspace-write",
      },
    });
  });

  it("normalizes stale Codex approval callbacks without faking approval resolution", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    harness.respondToRequest.mockImplementation(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: ProviderDriverKind.make("codex"),
          method: "item/requestApproval/decision",
          detail: "Unknown pending Codex approval request: approval-request-1",
        }),
      ),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-approval-error"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make("cmd-approval-requested"),
        threadId: ThreadId.make("thread-1"),
        activity: {
          id: EventId.make("activity-approval-requested"),
          tone: "approval",
          kind: "approval.requested",
          summary: "Command approval requested",
          payload: {
            requestId: "approval-request-1",
            requestKind: "command",
          },
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-respond-stale"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("approval-request-1"),
        decision: "acceptForSession",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      if (!thread) return false;
      return thread.activities.some(
        (activity) => activity.kind === "provider.approval.respond.failed",
      );
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread).toBeDefined();

    const failureActivity = thread?.activities.find(
      (activity) => activity.kind === "provider.approval.respond.failed",
    );
    expect(failureActivity).toBeDefined();
    expect(failureActivity?.payload).toMatchObject({
      requestId: "approval-request-1",
      detail: expect.stringContaining("Stale pending approval request: approval-request-1"),
    });

    const resolvedActivity = thread?.activities.find(
      (activity) =>
        activity.kind === "approval.resolved" &&
        typeof activity.payload === "object" &&
        activity.payload !== null &&
        (activity.payload as Record<string, unknown>).requestId === "approval-request-1",
    );
    expect(resolvedActivity).toBeUndefined();
  });

  effectIt("surfaces non-resumable provider user-input callbacks as stale failures", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      const now = "2026-01-01T00:00:00.000Z";
      harness.respondToUserInput.mockImplementation(() =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: ProviderDriverKind.make("claudeAgent"),
            method: "item/tool/respondToUserInput",
            detail: "Unknown pending Codex user input request: user-input-request-1",
          }),
        ),
      );

      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-user-input-error"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });

      yield* harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make("cmd-user-input-requested"),
        threadId: ThreadId.make("thread-1"),
        activity: {
          id: EventId.make("activity-user-input-requested"),
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            requestId: "user-input-request-1",
            questions: [
              {
                id: "sandbox_mode",
                header: "Sandbox",
                question: "Which mode should be used?",
                options: [
                  {
                    label: "workspace-write",
                    description: "Allow workspace writes only",
                  },
                ],
              },
            ],
          },
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      });

      yield* harness.engine.dispatch({
        type: "thread.user-input.respond",
        commandId: CommandId.make("cmd-user-input-respond-stale"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("user-input-request-1"),
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: now,
      });

      yield* Effect.promise(() =>
        waitFor(async () => {
          const readModel = await harness.readModel();
          const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
          if (!thread) return false;
          return thread.activities.some(
            (activity) => activity.kind === "provider.user-input.respond.failed",
          );
        }),
      );

      const readModel = yield* Effect.promise(() => harness.readModel());
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread).toBeDefined();

      const failureActivity = thread?.activities.find(
        (activity) => activity.kind === "provider.user-input.respond.failed",
      );
      expect(failureActivity).toBeDefined();
      expect(failureActivity?.payload).toMatchObject({
        requestId: "user-input-request-1",
        detail: expect.stringContaining("Stale pending user-input request: user-input-request-1"),
      });

      const resolvedActivity = thread?.activities.find(
        (activity) =>
          activity.kind === "user-input.resolved" &&
          typeof activity.payload === "object" &&
          activity.payload !== null &&
          (activity.payload as Record<string, unknown>).requestId === "user-input-request-1",
      );
      expect(resolvedActivity).toBeUndefined();
    }),
  );

  effectIt(
    "reacts to thread.session.stop by stopping provider session and clearing thread session state",
    () =>
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() => createHarness());
        const now = "2026-01-01T00:00:00.000Z";

        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-set-for-stop"),
          threadId: ThreadId.make("thread-1"),
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "ready",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex_work"),
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });

        const activeChildId = SubagentId.make("codex:child-before-explicit-stop");
        yield* harness.engine.dispatch({
          type: "thread.subagent.upsert",
          commandId: CommandId.make("cmd-subagent-set-for-stop"),
          threadId: ThreadId.make("thread-1"),
          subagent: {
            id: activeChildId,
            providerThreadId: "child-before-explicit-stop",
            parentId: null,
            path: "/root/child-before-explicit-stop",
            name: "child-before-explicit-stop",
            nickname: null,
            role: null,
            task: null,
            model: null,
            reasoningEffort: null,
            depth: 1,
            status: "running",
            statusMessage: null,
            latestProgress: null,
            latestTurn: {
              turnId: asTurnId("child-turn-before-explicit-stop"),
              state: "running",
              requestedAt: now,
              startedAt: now,
              completedAt: null,
              assistantMessageId: null,
            },
            startedAt: now,
            updatedAt: now,
            completedAt: null,
          },
          createdAt: now,
        });

        yield* harness.engine.dispatch({
          type: "thread.session.stop",
          commandId: CommandId.make("cmd-session-stop"),
          threadId: ThreadId.make("thread-1"),
          createdAt: now,
        });

        yield* Effect.promise(() =>
          waitFor(async () => {
            if (harness.stopSession.mock.calls.length !== 1) {
              return false;
            }
            const readModel = await harness.readModel();
            const thread = readModel.threads.find(
              (entry) => entry.id === ThreadId.make("thread-1"),
            );
            return (
              thread?.session?.status === "stopped" &&
              thread.subagents.find((subagent) => subagent.id === activeChildId)?.status ===
                "interrupted"
            );
          }),
        );
        const readModel = yield* Effect.promise(() => harness.readModel());
        const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
        expect(thread?.session).not.toBeNull();
        expect(thread?.session?.status).toBe("stopped");
        expect(thread?.session?.threadId).toBe("thread-1");
        expect(thread?.session?.providerInstanceId).toBe(ProviderInstanceId.make("codex_work"));
        expect(thread?.session?.activeTurnId).toBeNull();
        expect(thread?.subagents.find((subagent) => subagent.id === activeChildId)).toMatchObject({
          status: "interrupted",
          latestProgress: {
            kind: "state.interrupted",
            summary: "Interrupted",
          },
          latestTurn: {
            state: "interrupted",
            completedAt: now,
          },
          completedAt: now,
        });
      }),
  );
});
