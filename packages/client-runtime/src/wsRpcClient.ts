import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  ORCHESTRATION_WS_METHODS,
  type RelayClientInstallProgressEvent,
  type RelayClientStatus,
  type ServerSettingsPatch,
  type VcsStatusResult,
  type VcsStatusStreamEvent,
  WS_METHODS,
} from "@t3tools/contracts";
import { applyGitStatusStreamEvent } from "@t3tools/shared/git";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import { type WsRpcProtocolClient } from "./rpc/protocol.ts";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

export interface WsTransport {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly isHeartbeatFresh: () => boolean;
  readonly request: <TSuccess>(
    useClient: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, any, any>,
  ) => Promise<TSuccess>;
  readonly requestStream: <TEvent>(
    useClient: (client: WsRpcProtocolClient) => Stream.Stream<TEvent, any, any>,
    listener: (event: TEvent) => void,
  ) => Promise<void>;
  readonly subscribe: <TEvent>(
    useClient: (client: WsRpcProtocolClient) => Stream.Stream<TEvent, any, any>,
    listener: (event: TEvent) => void,
    options: StreamSubscriptionOptions & { readonly tag: string },
  ) => () => void;
}

function subscriptionOptions(
  options: StreamSubscriptionOptions | undefined,
  tag: string,
): StreamSubscriptionOptions & { readonly tag: string } {
  return {
    ...options,
    tag,
  };
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

type RpcInputStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (
        input: RpcInput<TTag>,
        listener: (event: TEvent) => void,
        options?: StreamSubscriptionOptions,
      ) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly isHeartbeatFresh: () => boolean;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly attach: RpcInputStreamMethod<typeof WS_METHODS.terminalAttach>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
    readonly onMetadata: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalMetadata>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly filesystem: {
    readonly browse: RpcUnaryMethod<typeof WS_METHODS.filesystemBrowse>;
  };
  readonly sourceControl: {
    readonly lookupRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlLookupRepository>;
    readonly cloneRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlCloneRepository>;
    readonly publishRepository: RpcUnaryMethod<typeof WS_METHODS.sourceControlPublishRepository>;
  };
  readonly shell: {
    readonly openInEditor: RpcUnaryMethod<typeof WS_METHODS.shellOpenInEditor>;
  };
  readonly vcs: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.vcsPull>;
    readonly refreshStatus: RpcUnaryMethod<typeof WS_METHODS.vcsRefreshStatus>;
    readonly onStatus: (
      input: RpcInput<typeof WS_METHODS.subscribeVcsStatus>,
      listener: (status: VcsStatusResult) => void,
      options?: StreamSubscriptionOptions,
    ) => () => void;
    readonly listRefs: RpcUnaryMethod<typeof WS_METHODS.vcsListRefs>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.vcsRemoveWorktree>;
    readonly createRef: RpcUnaryMethod<typeof WS_METHODS.vcsCreateRef>;
    readonly switchRef: RpcUnaryMethod<typeof WS_METHODS.vcsSwitchRef>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.vcsInit>;
  };
  readonly git: {
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly review: {
    readonly getDiffPreview: RpcUnaryMethod<typeof WS_METHODS.reviewGetDiffPreview>;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: (
      input?: RpcInput<typeof WS_METHODS.serverRefreshProviders>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverRefreshProviders>>;
    readonly discoverSourceControl: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverDiscoverSourceControl
    >;
    readonly updateProvider: RpcUnaryMethod<typeof WS_METHODS.serverUpdateProvider>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly removeKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverRemoveKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly createAssemblyAiStreamingToken: RpcUnaryMethod<
      typeof WS_METHODS.serverCreateAssemblyAiStreamingToken
    >;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
    readonly subscribeAuthAccess: RpcStreamMethod<typeof WS_METHODS.subscribeAuthAccess>;
    readonly getTraceDiagnostics: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetTraceDiagnostics>;
    readonly getProcessDiagnostics: RpcUnaryNoArgMethod<
      typeof WS_METHODS.serverGetProcessDiagnostics
    >;
    readonly getProcessResourceHistory: RpcUnaryMethod<
      typeof WS_METHODS.serverGetProcessResourceHistory
    >;
    readonly signalProcess: RpcUnaryMethod<typeof WS_METHODS.serverSignalProcess>;
  };
  readonly speech: {
    readonly getProjectProfile: RpcUnaryMethod<typeof WS_METHODS.speechGetProjectProfile>;
    readonly listProjectProfiles: RpcUnaryNoArgMethod<typeof WS_METHODS.speechListProjectProfiles>;
    readonly indexProject: RpcUnaryMethod<typeof WS_METHODS.speechIndexProject>;
    readonly createBasicProjectProfile: RpcUnaryMethod<
      typeof WS_METHODS.speechCreateBasicProjectProfile
    >;
    readonly translateTranscript: RpcUnaryMethod<typeof WS_METHODS.speechTranslateTranscript>;
  };
  readonly prompt: {
    readonly improve: RpcUnaryMethod<typeof WS_METHODS.promptImprove>;
  };
  readonly cloud: {
    readonly getRelayClientStatus: RpcUnaryNoArgMethod<typeof WS_METHODS.cloudGetRelayClientStatus>;
    readonly installRelayClient: (
      onProgress?: (event: RelayClientInstallProgressEvent) => void,
    ) => Promise<RelayClientStatus>;
  };
  readonly skills: {
    readonly list: RpcUnaryMethod<typeof WS_METHODS.skillsList>;
    readonly discoverImportSources: (
      input?: RpcInput<typeof WS_METHODS.skillsDiscoverImportSources>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.skillsDiscoverImportSources>>;
    readonly importSources: RpcUnaryMethod<typeof WS_METHODS.skillsImportSources>;
    readonly create: RpcUnaryMethod<typeof WS_METHODS.skillsCreate>;
    readonly update: RpcUnaryMethod<typeof WS_METHODS.skillsUpdate>;
    readonly rename: RpcUnaryMethod<typeof WS_METHODS.skillsRename>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.skillsDelete>;
    readonly setEnabled: RpcUnaryMethod<typeof WS_METHODS.skillsSetEnabled>;
  };
  readonly chatImport: {
    readonly discover: (
      input?: RpcInput<typeof WS_METHODS.chatImportDiscover>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.chatImportDiscover>>;
    readonly run: RpcUnaryMethod<typeof WS_METHODS.chatImportRun>;
  };
  readonly mcp: {
    readonly list: (
      input?: RpcInput<typeof WS_METHODS.mcpList>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.mcpList>>;
    readonly discoverImportSources: (
      input?: RpcInput<typeof WS_METHODS.mcpDiscoverImportSources>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.mcpDiscoverImportSources>>;
    readonly create: RpcUnaryMethod<typeof WS_METHODS.mcpCreate>;
    readonly update: RpcUnaryMethod<typeof WS_METHODS.mcpUpdate>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.mcpDelete>;
    readonly setEnabled: RpcUnaryMethod<typeof WS_METHODS.mcpSetEnabled>;
    readonly importCursorJson: RpcUnaryMethod<typeof WS_METHODS.mcpImportCursorJson>;
    readonly importSources: RpcUnaryMethod<typeof WS_METHODS.mcpImportSources>;
    readonly exportCursorJson: (
      input?: RpcInput<typeof WS_METHODS.mcpExportCursorJson>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.mcpExportCursorJson>>;
    readonly providerStatus: (
      input?: RpcInput<typeof WS_METHODS.mcpProviderStatus>,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.mcpProviderStatus>>;
  };
  readonly orchestration: {
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly exportThreadTranscript: RpcUnaryMethod<
      typeof ORCHESTRATION_WS_METHODS.exportThreadTranscript
    >;
    readonly getArchivedShellSnapshot: RpcUnaryNoArgMethod<
      typeof ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot
    >;
    readonly subscribeShell: RpcStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeShell>;
    readonly subscribeThread: RpcInputStreamMethod<typeof ORCHESTRATION_WS_METHODS.subscribeThread>;
  };
}

export interface CreateWsRpcClientOptions {
  /** Runs immediately before `transport.reconnect()` (e.g. reset reconnect UI/backoff state). */
  readonly beforeReconnect?: () => void;
}

export function createWsRpcClient(
  transport: WsTransport,
  options?: CreateWsRpcClientOptions,
): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    isHeartbeatFresh: () => transport.isHeartbeatFresh(),
    reconnect: async () => {
      options?.beforeReconnect?.();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      attach: (input, listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.terminalAttach](input),
          listener,
          subscriptionOptions(options, WS_METHODS.terminalAttach),
        ),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          subscriptionOptions(options, WS_METHODS.subscribeTerminalEvents),
        ),
      onMetadata: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalMetadata]({}),
          listener,
          subscriptionOptions(options, WS_METHODS.subscribeTerminalMetadata),
        ),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    filesystem: {
      browse: (input) => transport.request((client) => client[WS_METHODS.filesystemBrowse](input)),
    },
    sourceControl: {
      lookupRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlLookupRepository](input)),
      cloneRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlCloneRepository](input)),
      publishRepository: (input) =>
        transport.request((client) => client[WS_METHODS.sourceControlPublishRepository](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    vcs: {
      pull: (input) => transport.request((client) => client[WS_METHODS.vcsPull](input)),
      refreshStatus: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRefreshStatus](input)),
      onStatus: (input, listener, options) => {
        let current: VcsStatusResult | null = null;
        return transport.subscribe(
          (client) => client[WS_METHODS.subscribeVcsStatus](input),
          (event: VcsStatusStreamEvent) => {
            current = applyGitStatusStreamEvent(current, event);
            listener(current);
          },
          subscriptionOptions(options, WS_METHODS.subscribeVcsStatus),
        );
      },
      listRefs: (input) => transport.request((client) => client[WS_METHODS.vcsListRefs](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.vcsRemoveWorktree](input)),
      createRef: (input) => transport.request((client) => client[WS_METHODS.vcsCreateRef](input)),
      switchRef: (input) => transport.request((client) => client[WS_METHODS.vcsSwitchRef](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.vcsInit](input)),
    },
    git: {
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    review: {
      getDiffPreview: (input) =>
        transport.request((client) => client[WS_METHODS.reviewGetDiffPreview](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: (input) =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders](input ?? {})),
      discoverSourceControl: () =>
        transport.request((client) => client[WS_METHODS.serverDiscoverSourceControl]({})),
      updateProvider: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpdateProvider](input)),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      removeKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverRemoveKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      createAssemblyAiStreamingToken: (input) =>
        transport.request((client) =>
          client[WS_METHODS.serverCreateAssemblyAiStreamingToken](input),
        ),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          subscriptionOptions(options, WS_METHODS.subscribeServerConfig),
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          subscriptionOptions(options, WS_METHODS.subscribeServerLifecycle),
        ),
      subscribeAuthAccess: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuthAccess]({}),
          listener,
          subscriptionOptions(options, WS_METHODS.subscribeAuthAccess),
        ),
      getTraceDiagnostics: () =>
        transport.request((client) => client[WS_METHODS.serverGetTraceDiagnostics]({})),
      getProcessDiagnostics: () =>
        transport.request((client) => client[WS_METHODS.serverGetProcessDiagnostics]({})),
      getProcessResourceHistory: (input) =>
        transport.request((client) => client[WS_METHODS.serverGetProcessResourceHistory](input)),
      signalProcess: (input) =>
        transport.request((client) => client[WS_METHODS.serverSignalProcess](input)),
    },
    speech: {
      getProjectProfile: (input) =>
        transport.request((client) => client[WS_METHODS.speechGetProjectProfile](input)),
      listProjectProfiles: () =>
        transport.request((client) => client[WS_METHODS.speechListProjectProfiles]({})),
      indexProject: (input) =>
        transport.request((client) => client[WS_METHODS.speechIndexProject](input)),
      createBasicProjectProfile: (input) =>
        transport.request((client) => client[WS_METHODS.speechCreateBasicProjectProfile](input)),
      translateTranscript: (input) =>
        transport.request((client) => client[WS_METHODS.speechTranslateTranscript](input)),
    },
    prompt: {
      improve: (input) => transport.request((client) => client[WS_METHODS.promptImprove](input)),
    },
    cloud: {
      getRelayClientStatus: () =>
        transport.request((client) => client[WS_METHODS.cloudGetRelayClientStatus]({})),
      installRelayClient: async (onProgress) => {
        let installed: RelayClientStatus | null = null;
        await transport.requestStream(
          (client) => client[WS_METHODS.cloudInstallRelayClient]({}),
          (event) => {
            onProgress?.(event);
            if (event.type === "complete") {
              installed = event.status;
            }
          },
        );
        if (installed) {
          return installed;
        }
        throw new Error("Relay client install stream completed without a final status.");
      },
    },
    skills: {
      list: (input) => transport.request((client) => client[WS_METHODS.skillsList](input)),
      discoverImportSources: (input) =>
        transport.request((client) => client[WS_METHODS.skillsDiscoverImportSources](input ?? {})),
      importSources: (input) =>
        transport.request((client) => client[WS_METHODS.skillsImportSources](input)),
      create: (input) => transport.request((client) => client[WS_METHODS.skillsCreate](input)),
      update: (input) => transport.request((client) => client[WS_METHODS.skillsUpdate](input)),
      rename: (input) => transport.request((client) => client[WS_METHODS.skillsRename](input)),
      delete: (input) => transport.request((client) => client[WS_METHODS.skillsDelete](input)),
      setEnabled: (input) =>
        transport.request((client) => client[WS_METHODS.skillsSetEnabled](input)),
    },
    chatImport: {
      discover: (input) =>
        transport.request((client) => client[WS_METHODS.chatImportDiscover](input ?? {})),
      run: (input) => transport.request((client) => client[WS_METHODS.chatImportRun](input)),
    },
    mcp: {
      list: (input) => transport.request((client) => client[WS_METHODS.mcpList](input ?? {})),
      discoverImportSources: (input) =>
        transport.request((client) => client[WS_METHODS.mcpDiscoverImportSources](input ?? {})),
      create: (input) => transport.request((client) => client[WS_METHODS.mcpCreate](input)),
      update: (input) => transport.request((client) => client[WS_METHODS.mcpUpdate](input)),
      delete: (input) => transport.request((client) => client[WS_METHODS.mcpDelete](input)),
      setEnabled: (input) => transport.request((client) => client[WS_METHODS.mcpSetEnabled](input)),
      importCursorJson: (input) =>
        transport.request((client) => client[WS_METHODS.mcpImportCursorJson](input)),
      importSources: (input) =>
        transport.request((client) => client[WS_METHODS.mcpImportSources](input)),
      exportCursorJson: (input) =>
        transport.request((client) =>
          client[WS_METHODS.mcpExportCursorJson](input ?? { includeDisabled: false }),
        ),
      providerStatus: (input) =>
        transport.request((client) => client[WS_METHODS.mcpProviderStatus](input ?? {})),
    },
    orchestration: {
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      exportThreadTranscript: (input) =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.exportThreadTranscript](input),
        ),
      getArchivedShellSnapshot: () =>
        transport.request((client) =>
          client[ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]({}),
        ),
      subscribeShell: (listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeShell]({}),
          listener,
          subscriptionOptions(options, ORCHESTRATION_WS_METHODS.subscribeShell),
        ),
      subscribeThread: (input, listener, options) =>
        transport.subscribe(
          (client) => client[ORCHESTRATION_WS_METHODS.subscribeThread](input),
          listener,
          subscriptionOptions(options, ORCHESTRATION_WS_METHODS.subscribeThread),
        ),
    },
  };
}
