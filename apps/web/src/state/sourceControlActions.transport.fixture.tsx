import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  EnvironmentRegistry as Registry,
  EnvironmentSupervisor as Supervisor,
} from "@t3tools/client-runtime/connection";
const { EnvironmentRegistry } = Registry;
type EnvironmentRegistry = Registry.EnvironmentRegistry;
const { EnvironmentSupervisor } = Supervisor;
import { Persistence } from "@t3tools/client-runtime/platform";
import type { RpcSession, WsRpcProtocolClient } from "@t3tools/client-runtime/rpc";
import {
  EnvironmentId,
  ThreadId,
  WS_METHODS,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";
import {
  deferredResult,
  workbenchSnapshot,
  vcsStatus,
} from "../components/git-workbench/gitCommitTestFixtures";
import { vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  runtime: undefined as
    | Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore, never>
    | undefined,
  rpcInputs: new Array<GitRunStackedActionInput>(),
  refreshInputs: new Array<unknown>(),
  metadataInputs: new Array<unknown>(),
  stackedResult: null as GitRunStackedActionResult | null,
  stackedResponse: undefined as Promise<GitRunStackedActionResult> | undefined,
  onStackedRequest: undefined as ((input: GitRunStackedActionInput) => void) | undefined,
  status: undefined as VcsStatusResult | undefined,
  threadId: null as ThreadId | null,
}));

vi.mock("@t3tools/client-runtime/state/session", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const { AuthStandardClientScopes } = await import("@t3tools/contracts");
  const session = Atom.make(
    AsyncResult.success({
      authenticated: true,
      scopes: AuthStandardClientScopes,
      permissions: AuthStandardClientScopes,
      auth: {
        policy: "remote-reachable",
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "test",
      },
    }),
  );
  return { createEnvironmentSessionAtoms: () => ({ sessionStateAtom: () => session }) };
});

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
  const { Atom } = await import("effect/reactivity");
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

export const environmentId = EnvironmentId.make("commit-selection-environment");
export const scope = { environmentId, cwd: "/repo" };
export const threadId = ThreadId.make("commit-selection-thread");
const result: GitRunStackedActionResult = {
  action: "commit_push",
  branch: { status: "skipped_not_requested" },
  commit: { status: "created", commitSha: "abc123", subject: "Chosen changes" },
  push: { status: "pushed", branch: "feature" },
  pr: { status: "skipped_not_requested" },
  toast: { title: "Changes pushed", cta: { kind: "none" } },
};

export let GitActionsControl: (typeof import("../components/GitActionsControl"))["default"];
export let useGitStackedAction: (typeof import("./sourceControlActions"))["useGitStackedAction"];
export function transportTestState() {
  return testState;
}

export function deferStackedResponse() {
  const received = deferredResult<GitRunStackedActionInput>();
  const response = deferredResult<GitRunStackedActionResult>();
  testState.onStackedRequest = received.resolve;
  testState.stackedResponse = response.promise;
  return {
    received: received.promise,
    complete: response.resolve,
    [Symbol.dispose]() {
      response.resolve(testState.stackedResult ?? result);
      testState.onStackedRequest = undefined;
      testState.stackedResponse = undefined;
    },
  };
}

export async function setupTransportTest(options: { status?: VcsStatusResult } = {}) {
  if (testState.runtime === undefined) {
    testState.runtime = Atom.runtime(
      Layer.unwrap(
        Effect.gen(function* () {
          const client = {
            [WS_METHODS.subscribeVcsStatus]: () =>
              Stream.make({
                _tag: "snapshot" as const,
                local: testState.status ?? vcsStatus(),
                remote: testState.status ?? vcsStatus(),
              }).pipe(Stream.concat(Stream.never)),
            [WS_METHODS.serverDiscoverSourceControl]: () =>
              Effect.succeed({ sourceControlProviders: [] }),
            [WS_METHODS.gitRefreshWorkbench]: (input: unknown) => {
              testState.refreshInputs.push(input);
              return Effect.succeed(workbenchSnapshot());
            },
            [WS_METHODS.gitRunStackedAction]: (input: GitRunStackedActionInput) => {
              testState.rpcInputs.push(input);
              const response = testState.stackedResponse;
              testState.onStackedRequest?.(input);
              return Stream.fromEffect(
                response === undefined
                  ? Effect.succeed(testState.stackedResult ?? result)
                  : Effect.promise(() => response),
              ).pipe(
                Stream.map((result) => ({
                  kind: "action_finished" as const,
                  actionId: input.actionId,
                  cwd: input.cwd,
                  action: input.action,
                  result,
                })),
              );
            },
          } as unknown as WsRpcProtocolClient;
          const session: RpcSession = {
            client,
            inboundFrames: Effect.succeed(0),
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
          const cacheMiss = Effect.fn("test.cacheMiss")(() => Effect.succeedNone);
          const cacheWrite = Effect.fn("test.cacheWrite")(() => Effect.void);
          const cache = Persistence.EnvironmentCacheStore.of({
            loadShell: cacheMiss,
            saveShell: cacheWrite,
            loadThread: cacheMiss,
            saveThread: cacheWrite,
            removeThread: cacheWrite,
            loadServerConfig: cacheMiss,
            saveServerConfig: cacheWrite,
            loadVcsRefs: cacheMiss,
            saveVcsRefs: cacheWrite,
            removeVcsRefs: cacheWrite,
            clearVcsRefs: cacheWrite,
            clear: cacheWrite,
          });
          return Layer.merge(
            Layer.succeed(EnvironmentRegistry, environmentRegistry),
            Layer.succeed(Persistence.EnvironmentCacheStore, cache),
          );
        }),
      ),
    );
    testState.threadId = threadId;
    ({ useGitStackedAction } = await import("./sourceControlActions"));
    ({ default: GitActionsControl } = await import("../components/GitActionsControl"));
  }
  testState.rpcInputs.length = 0;
  testState.refreshInputs.length = 0;
  testState.metadataInputs.length = 0;
  testState.stackedResult = null;
  testState.stackedResponse = undefined;
  testState.onStackedRequest = undefined;
  testState.status = options.status ?? vcsStatus();
  return AtomRegistry.make();
}
