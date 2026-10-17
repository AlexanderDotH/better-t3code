// @vitest-environment jsdom

import { RegistryContext } from "@effect/atom-react";
import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentRegistry,
  EnvironmentSupervisor,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import { EnvironmentCacheStore } from "@t3tools/client-runtime/platform";
import type { RpcSession, WsRpcProtocolClient } from "@t3tools/client-runtime/rpc";
import { createVcsActionTransportId } from "@t3tools/client-runtime/state/vcs";
import {
  EnvironmentId,
  ThreadId,
  WS_METHODS,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { createRoot } from "react-dom/client";
import { GitCommitComposer } from "../components/git-workbench/GitCommitComposer";
import { useGitCommitDraftStore } from "../components/git-workbench/gitCommitDraftStore";
import {
  commitResult,
  deferredResult,
  workbenchSnapshot,
  vcsStatus,
} from "../components/git-workbench/gitCommitTestFixtures";
import { TooltipProvider } from "../components/ui/tooltip";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  runtime: undefined as
    | Atom.AtomRuntime<EnvironmentRegistry | EnvironmentCacheStore, never>
    | undefined,
  rpcInputs: new Array<GitRunStackedActionInput>(),
  refreshInputs: new Array<unknown>(),
  metadataInputs: new Array<unknown>(),
  stackedResult: null as GitRunStackedActionResult | null,
  threadId: null as ThreadId | null,
}));

vi.mock("../connection/runtime", () => ({
  get connectionAtomRuntime() {
    if (testState.runtime === undefined) {
      throw new Error("The source control test runtime has not been initialized.");
    }
    return testState.runtime;
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => Promise.resolve(),
}));
vi.mock("~/state/server", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  const config = Atom.make({
    environment: { capabilities: { gitWorkbenchVersion: 1 } },
    availableEditors: [],
  });
  return { serverEnvironment: { configValueAtom: () => config } };
});
vi.mock("~/state/entities", () => ({
  useThreadShell: () => ({ id: testState.threadId, branch: "feature/test" }),
}));
vi.mock("~/state/threads", () => ({
  threadEnvironment: {
    updateMetadata: {
      label: "test:thread-metadata",
      run: async (_registry: unknown, input: unknown) => {
        testState.metadataInputs.push(input);
        return { _tag: "Success", value: undefined };
      },
    },
  },
}));
vi.mock("~/composerDraftStore", () => {
  const store = {
    getDraftSession: () => null,
    getDraftThreadByRef: () => null,
    setDraftThreadContext: () => undefined,
  };
  return { useComposerDraftStore: (select: (value: typeof store) => unknown) => select(store) };
});
vi.mock("~/editorPreferences", () => ({
  useOpenInPreferredEditor: () => () => Promise.resolve(),
}));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => () => Promise.resolve() }));
vi.mock("~/lib/openPullRequestLink", () => ({ useOpenPrLink: () => () => Promise.resolve() }));
vi.mock("~/components/ui/toast", () => ({
  toastManager: { add: vi.fn(() => "toast"), update: vi.fn(), close: vi.fn() },
  stackedThreadToast: (toast: unknown) => toast,
}));

const environmentId = EnvironmentId.make("commit-selection-environment");
const scope = { environmentId, cwd: "/repo" };
const threadId = ThreadId.make("commit-selection-thread");
const result: GitRunStackedActionResult = {
  action: "commit_push",
  branch: { status: "skipped_not_requested" },
  commit: { status: "created", commitSha: "abc123", subject: "Chosen changes" },
  push: { status: "pushed", branch: "feature" },
  pr: { status: "skipped_not_requested" },
  toast: { title: "Changes pushed", cta: { kind: "none" } },
};

let GitActionsControl: (typeof import("../components/GitActionsControl"))["default"];
let useGitStackedAction: (typeof import("./sourceControlActions"))["useGitStackedAction"];
let latest: ReturnType<typeof useGitStackedAction>;
let registry: AtomRegistry.AtomRegistry;
let renderer: ReactTestRenderer | undefined;

function Probe() {
  const action = useGitStackedAction(scope);
  useLayoutEffect(() => {
    latest = action;
  }, [action]);
  return null;
}

beforeAll(async () => {
  testState.runtime = Atom.runtime(
    Layer.unwrap(
      Effect.gen(function* () {
        const client = {
          [WS_METHODS.subscribeVcsStatus]: () =>
            Stream.make({
              _tag: "snapshot" as const,
              local: vcsStatus(),
              remote: vcsStatus(),
            }).pipe(Stream.concat(Stream.never)),
          [WS_METHODS.serverDiscoverSourceControl]: () =>
            Effect.succeed({ sourceControlProviders: [] }),
          [WS_METHODS.gitRefreshWorkbench]: (input: unknown) => {
            testState.refreshInputs.push(input);
            return Effect.succeed(workbenchSnapshot());
          },
          [WS_METHODS.gitRunStackedAction]: (input: GitRunStackedActionInput) => {
            testState.rpcInputs.push(input);
            return Stream.make({
              kind: "action_finished" as const,
              actionId: input.actionId,
              cwd: input.cwd,
              action: input.action,
              result: testState.stackedResult ?? result,
            });
          },
        } as unknown as WsRpcProtocolClient;
        const session: RpcSession = {
          client,
          initialConfig: Effect.never,
          subscribeServerConfig: (input) => client.subscribeServerConfig(input),
          ready: Effect.void,
          probe: Effect.void,
          closed: Effect.never,
        };
        const supervisor = EnvironmentSupervisor.of({
          target: new PrimaryConnectionTarget({
            environmentId,
            label: "Test environment",
            httpBaseUrl: "https://environment.example.test",
            wsBaseUrl: "wss://environment.example.test",
          }),
          state: yield* SubscriptionRef.make<SupervisorConnectionState>({
            ...AVAILABLE_CONNECTION_STATE,
            desired: true,
            network: "online",
            phase: "connected",
            attempt: 1,
            generation: 1,
          }),
          session: yield* SubscriptionRef.make(Option.some(session)),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        });
        const run: EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
          Effect.provideService(effect, EnvironmentSupervisor, supervisor);
        const runStream: EnvironmentRegistry["Service"]["runStream"] = (_environmentId, stream) =>
          Stream.provideService(stream, EnvironmentSupervisor, supervisor);
        const followStream: EnvironmentRegistry["Service"]["followStream"] = (
          _environmentId,
          stream,
        ) => Stream.provideService(stream, EnvironmentSupervisor, supervisor);
        const environmentRegistry = EnvironmentRegistry.of({
          run,
          runStream,
          followStream,
        } as unknown as EnvironmentRegistry["Service"]);
        const cache = EnvironmentCacheStore.of({
          loadShell: () => Effect.succeedNone,
          saveShell: () => Effect.void,
          loadThread: () => Effect.succeedNone,
          saveThread: () => Effect.void,
          removeThread: () => Effect.void,
          loadServerConfig: () => Effect.succeedNone,
          saveServerConfig: () => Effect.void,
          loadVcsRefs: () => Effect.succeedNone,
          saveVcsRefs: () => Effect.void,
          removeVcsRefs: () => Effect.void,
          clearVcsRefs: () => Effect.void,
          clear: () => Effect.void,
        });
        return Layer.merge(
          Layer.succeed(EnvironmentRegistry, environmentRegistry),
          Layer.succeed(EnvironmentCacheStore, cache),
        );
      }),
    ),
  );
  testState.threadId = threadId;
  ({ useGitStackedAction } = await import("./sourceControlActions"));
  ({ default: GitActionsControl } = await import("../components/GitActionsControl"));
});

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  testState.rpcInputs.length = 0;
  testState.refreshInputs.length = 0;
  testState.metadataInputs.length = 0;
  testState.stackedResult = null;
  registry = AtomRegistry.make();
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <Probe />
      </RegistryContext.Provider>,
    );
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  registry.dispose();
  vi.unstubAllGlobals();
});

describe("useGitStackedAction commit selection transport", () => {
  it.each([
    { name: "legacy omission", input: {} },
    { name: "legacy paths", input: { filePaths: ["src/legacy.ts"] } },
    { name: "staged changes", input: { commitSelection: { mode: "staged" } } },
    { name: "all changes", input: { commitSelection: { mode: "all" } } },
    {
      name: "selected paths",
      input: {
        commitSelection: { mode: "paths", paths: ["src/one.ts", "src/renamed file.ts"] },
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    input: {
      commitSelection?: GitRunStackedActionInput["commitSelection"];
      filePaths?: string[];
    };
  }>)("preserves $name through the runtime RPC", async ({ name, input }) => {
    const actionId = `commit-selection-${name}`;
    let succeeded = false;
    await act(async () => {
      succeeded = AsyncResult.isSuccess(
        await latest.run({
          actionId,
          action: "commit_push",
          commitMessage: "Chosen changes",
          featureBranch: true,
          threadId,
          ...input,
        }),
      );
    });

    expect(succeeded).toBe(true);
    expect(testState.rpcInputs).toEqual([
      {
        actionId: createVcsActionTransportId(scope, actionId),
        cwd: scope.cwd,
        action: "commit_push",
        commitMessage: "Chosen changes",
        featureBranch: true,
        threadId,
        ...input,
      },
    ]);
  });
});

it("submits the actual composer through the actual control and web hook to the runtime RPC", async () => {
  testState.stackedResult = commitResult();
  const settled = deferredResult<void>();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  useGitCommitDraftStore.getState().clear();
  try {
    await act(() => {
      root.render(
        <RegistryContext.Provider value={registry}>
          <TooltipProvider>
            <GitActionsControl gitCwd={scope.cwd} activeThreadRef={{ environmentId, threadId }} />
            <GitCommitComposer
              {...scope}
              stateToken="state-1"
              stagedCount={1}
              partialStagedCount={1}
              blocked={false}
              activeTurn={false}
              hasQueuedWorkflow={false}
              focusRequest={0}
              pushAvailable={false}
              onQueueCommit={async () => ({ status: "queued" })}
              onSettled={() => settled.resolve()}
            />
          </TooltipProvider>
        </RegistryContext.Provider>,
      );
    });
    expect(testState.rpcInputs).toEqual([]);
    expect(testState.refreshInputs).toEqual([]);
    const manual = container.querySelector<HTMLInputElement>('[data-git-commit-mode="manual"]')!;
    await act(() => manual.click());
    const textarea = container.querySelector<HTMLTextAreaElement>("[data-git-commit-message]")!;
    const commitMessage = "  A deliberate subject\n\nBody with details.  ";
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        commitMessage,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = container.querySelector<HTMLButtonElement>('[data-git-commit-action="commit"]')!;
    expect(button.disabled).toBe(false);
    await act(async () => {
      button.click();
      await settled.promise;
    });

    expect(testState.refreshInputs).toEqual([{ cwd: scope.cwd }]);
    expect(testState.rpcInputs).toEqual([
      {
        actionId: expect.any(String),
        cwd: scope.cwd,
        action: "commit",
        commitMessage,
        commitSelection: { mode: "staged" },
        threadId,
      },
    ]);
    expect(textarea.value).toBe("");
    expect(testState.metadataInputs).toEqual([]);
  } finally {
    await act(() => root.unmount());
    container.remove();
    useGitCommitDraftStore.getState().clear();
  }
});
