import type { EnvironmentApi, EnvironmentId, PlanParallelismReviewInput } from "@t3tools/contracts";

import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { runAtomCommand, type AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { WsRpcClient } from "@t3tools/client-runtime/wsRpcClient";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { agentSettingsEnvironment } from "./state/agentSettings";
import { orchestrationEnvironment } from "./state/orchestration";
import { serverEnvironment } from "./state/server";

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  const client = rpcClient as any;
  return {
    terminal: {
      open: client.terminal.open,
      attach: client.terminal.attach,
      write: client.terminal.write,
      resize: client.terminal.resize,
      clear: client.terminal.clear,
      restart: client.terminal.restart,
      close: client.terminal.close,
      onMetadata: client.terminal.onMetadata,
    },
    projects: {
      listEntries: client.projects.listEntries,
      readFile: client.projects.readFile,
      searchEntries: client.projects.searchEntries,
      writeFile: client.projects.writeFile,
    },
    filesystem: {
      browse: client.filesystem.browse,
    },
    assets: {
      createUrl: client.assets?.createUrl,
    },
    sourceControl: {
      lookupRepository: client.sourceControl.lookupRepository,
      cloneRepository: client.sourceControl.cloneRepository,
      publishRepository: client.sourceControl.publishRepository,
    },
    vcs: {
      pull: client.vcs.pull,
      refreshStatus: client.vcs.refreshStatus,
      onStatus: client.vcs.onStatus,
      listRefs: client.vcs.listRefs,
      createWorktree: client.vcs.createWorktree,
      removeWorktree: client.vcs.removeWorktree,
      createRef: client.vcs.createRef,
      switchRef: client.vcs.switchRef,
      init: client.vcs.init,
    },
    git: {
      resolvePullRequest: client.git.resolvePullRequest,
      preparePullRequestThread: client.git.preparePullRequestThread,
      subscribeWorkbench: client.git.onWorkbench,
      refreshWorkbench: client.git.refreshWorkbench,
      getRepositoryInsights: client.git.getRepositoryInsights,
      listHistory: client.git.listHistory,
      getCommitDetail: client.git.getCommitDetail,
      getCommitFileDiff: client.git.getCommitFileDiff,
      getChangesDiff: client.git.getChangesDiff,
      getInteractiveRebasePlan: client.git.getInteractiveRebasePlan,
      applyChangeSelection: client.git.applyChangeSelection,
      runWorkbenchOperation: client.git.runWorkbenchOperation,
      listUndoSnapshots: client.git.listUndoSnapshots,
      createUndoSnapshot: client.git.createUndoSnapshot,
      restoreUndoSnapshot: client.git.restoreUndoSnapshot,
      upsertQueuedWorkflow: client.git.upsertQueuedWorkflow,
      cancelQueuedWorkflow: client.git.cancelQueuedWorkflow,
    },
    review: {
      getDiffPreview: client.review.getDiffPreview,
    },
    chatImport: {
      discover: client.chatImport.discover,
      run: client.chatImport.run,
    },
    harnessChatSync: {
      sources: client.harnessChatSync.sources,
      list: client.harnessChatSync.list,
      run: client.harnessChatSync.run,
      status: client.harnessChatSync.status,
    },
    skills: {
      list: client.skills.list,
      discoverImportSources: client.skills.discoverImportSources,
      importSources: client.skills.importSources,
      create: client.skills.create,
      update: client.skills.update,
      rename: client.skills.rename,
      delete: client.skills.delete,
      setEnabled: client.skills.setEnabled,
    },
    mcp: {
      list: client.mcp.list,
      discoverImportSources: client.mcp.discoverImportSources,
      create: client.mcp.create,
      update: client.mcp.update,
      delete: client.mcp.delete,
      setEnabled: client.mcp.setEnabled,
      setProviderEnabled: client.mcp.setProviderEnabled,
      importCursorJson: client.mcp.importCursorJson,
      importSources: client.mcp.importSources,
      exportCursorJson: client.mcp.exportCursorJson,
      providerStatus: client.mcp.providerStatus,
      runtimeContexts: client.mcp.runtimeContexts,
      runtimeSnapshot: client.mcp.runtimeSnapshot,
      runtimeChanges: client.mcp.runtimeChanges,
      runtimeServerDetails: client.mcp.runtimeServerDetails,
      runtimeAction: client.mcp.runtimeAction,
    },
    orchestration: {
      dispatchCommand: client.orchestration.dispatchCommand,
      getTurnDiff: client.orchestration.getTurnDiff,
      getFullThreadDiff: client.orchestration.getFullThreadDiff,
      exportThreadTranscript: client.orchestration.exportThreadTranscript,
      getArchivedShellSnapshot: client.orchestration.getArchivedShellSnapshot,
      subscribeShell: client.orchestration.subscribeShell,
      subscribeThread: client.orchestration.subscribeThread,
    },
    plan: {
      reviewParallelism: client.plan.reviewParallelism,
    },
    preview: client.preview,
  } as unknown as EnvironmentApi;
}

async function runEnvironmentCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await runAtomCommand(appAtomRegistry, command, input, { label: command.label });
  if (result._tag === "Success") {
    return result.value;
  }
  throw Cause.squash(result.cause);
}

function createRuntimeEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  return {
    chatImport: {
      discover: (input?: Parameters<EnvironmentApi["chatImport"]["discover"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.chatImport.discover, {
          environmentId,
          input: input ?? {},
        }),
      run: (input: Parameters<EnvironmentApi["chatImport"]["run"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.chatImport.run, {
          environmentId,
          input,
        }),
    },
    harnessChatSync: {
      sources: (input?: Parameters<EnvironmentApi["harnessChatSync"]["sources"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.harnessChatSync.sources, {
          environmentId,
          input: input ?? {},
        }),
      list: (input: Parameters<EnvironmentApi["harnessChatSync"]["list"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.harnessChatSync.list, {
          environmentId,
          input,
        }),
      run: (input: Parameters<EnvironmentApi["harnessChatSync"]["run"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.harnessChatSync.run, {
          environmentId,
          input,
        }),
      status: (input: Parameters<EnvironmentApi["harnessChatSync"]["status"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.harnessChatSync.status, {
          environmentId,
          input,
        }),
    },
    skills: {
      list: (input: Parameters<EnvironmentApi["skills"]["list"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.list, {
          environmentId,
          input,
        }),
      discoverImportSources: (
        input?: Parameters<EnvironmentApi["skills"]["discoverImportSources"]>[0],
      ) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.discoverImportSources, {
          environmentId,
          input: input ?? {},
        }),
      importSources: (input: Parameters<EnvironmentApi["skills"]["importSources"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.importSources, {
          environmentId,
          input,
        }),
      create: (input: Parameters<EnvironmentApi["skills"]["create"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.create, {
          environmentId,
          input,
        }),
      update: (input: Parameters<EnvironmentApi["skills"]["update"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.update, {
          environmentId,
          input,
        }),
      rename: (input: Parameters<EnvironmentApi["skills"]["rename"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.rename, {
          environmentId,
          input,
        }),
      delete: (input: Parameters<EnvironmentApi["skills"]["delete"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.delete, {
          environmentId,
          input,
        }),
      setEnabled: (input: Parameters<EnvironmentApi["skills"]["setEnabled"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.skills.setEnabled, {
          environmentId,
          input,
        }),
    },
    mcp: {
      list: (input?: Parameters<EnvironmentApi["mcp"]["list"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.list, {
          environmentId,
          input: input ?? {},
        }),
      discoverImportSources: (
        input?: Parameters<EnvironmentApi["mcp"]["discoverImportSources"]>[0],
      ) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.discoverImportSources, {
          environmentId,
          input: input ?? {},
        }),
      create: (input: Parameters<EnvironmentApi["mcp"]["create"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.create, {
          environmentId,
          input,
        }),
      update: (input: Parameters<EnvironmentApi["mcp"]["update"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.update, {
          environmentId,
          input,
        }),
      delete: (input: Parameters<EnvironmentApi["mcp"]["delete"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.delete, {
          environmentId,
          input,
        }),
      setEnabled: (input: Parameters<EnvironmentApi["mcp"]["setEnabled"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.setEnabled, {
          environmentId,
          input,
        }),
      setProviderEnabled: (input: Parameters<EnvironmentApi["mcp"]["setProviderEnabled"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.setProviderEnabled, {
          environmentId,
          input,
        }),
      importCursorJson: (input: Parameters<EnvironmentApi["mcp"]["importCursorJson"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.importCursorJson, {
          environmentId,
          input,
        }),
      importSources: (input: Parameters<EnvironmentApi["mcp"]["importSources"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.importSources, {
          environmentId,
          input,
        }),
      exportCursorJson: (input?: Parameters<EnvironmentApi["mcp"]["exportCursorJson"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.exportCursorJson, {
          environmentId,
          input: input ?? { includeDisabled: false },
        }),
      providerStatus: (input?: Parameters<EnvironmentApi["mcp"]["providerStatus"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.providerStatus, {
          environmentId,
          input: input ?? {},
        }),
      runtimeContexts: (input: Parameters<EnvironmentApi["mcp"]["runtimeContexts"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.runtimeContexts, {
          environmentId,
          input,
        }),
      runtimeSnapshot: (input: Parameters<EnvironmentApi["mcp"]["runtimeSnapshot"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.runtimeSnapshot, {
          environmentId,
          input,
        }),
      runtimeChanges: (
        input: Parameters<EnvironmentApi["mcp"]["runtimeChanges"]>[0],
        callback: Parameters<EnvironmentApi["mcp"]["runtimeChanges"]>[1],
        options?: Parameters<EnvironmentApi["mcp"]["runtimeChanges"]>[2],
      ) => {
        const atom = agentSettingsEnvironment.mcp.runtimeChanges({ environmentId, input });
        const initial = appAtomRegistry.get(atom);
        let receivedSnapshot = false;
        const notify = (result: typeof initial) => {
          if (!AsyncResult.isSuccess(result)) {
            return;
          }
          if (result.value.type === "snapshot") {
            if (receivedSnapshot) {
              options?.onResubscribe?.();
            }
            receivedSnapshot = true;
          }
          callback(result.value);
        };
        notify(initial);
        return appAtomRegistry.subscribe(atom, notify);
      },
      runtimeServerDetails: (input: Parameters<EnvironmentApi["mcp"]["runtimeServerDetails"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.runtimeServerDetails, {
          environmentId,
          input,
        }),
      runtimeAction: (input: Parameters<EnvironmentApi["mcp"]["runtimeAction"]>[0]) =>
        runEnvironmentCommand(agentSettingsEnvironment.mcp.runtimeAction, {
          environmentId,
          input,
        }),
    },
    orchestration: {
      exportThreadTranscript: (
        input: Parameters<EnvironmentApi["orchestration"]["exportThreadTranscript"]>[0],
      ) =>
        runEnvironmentCommand(orchestrationEnvironment.exportThreadTranscript, {
          environmentId,
          input,
        }),
    },
    plan: {
      reviewParallelism: (input: PlanParallelismReviewInput) =>
        runEnvironmentCommand(serverEnvironment.reviewPlanParallelism, {
          environmentId,
          input,
        }),
    },
  } as unknown as EnvironmentApi;
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const overriddenApi = environmentApiOverridesForTests.get(environmentId);
  if (overriddenApi) {
    return overriddenApi;
  }

  return createRuntimeEnvironmentApi(environmentId);
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}

export function createAssemblyAiStreamingTokenForEnvironment(
  environmentId: EnvironmentId,
  projectId: import("@t3tools/contracts").ProjectId,
) {
  return runEnvironmentCommand(serverEnvironment.createAssemblyAiStreamingToken, {
    environmentId,
    input: { projectId },
  });
}

export function getProjectSpeechProfileForEnvironment(
  environmentId: EnvironmentId,
  projectId: import("@t3tools/contracts").ProjectId,
) {
  return runEnvironmentCommand(serverEnvironment.getProjectSpeechProfile, {
    environmentId,
    input: { projectId },
  });
}

export function listProjectSpeechProfilesForEnvironment(environmentId: EnvironmentId) {
  return runEnvironmentCommand(serverEnvironment.listProjectSpeechProfiles, {
    environmentId,
    input: {},
  });
}

export function indexProjectSpeechProfileForEnvironment(
  environmentId: EnvironmentId,
  projectId: import("@t3tools/contracts").ProjectId,
) {
  return runEnvironmentCommand(serverEnvironment.indexProjectSpeechProfile, {
    environmentId,
    input: { projectId },
  });
}

export function createBasicProjectSpeechProfileForEnvironment(
  environmentId: EnvironmentId,
  projectId: import("@t3tools/contracts").ProjectId,
) {
  return runEnvironmentCommand(serverEnvironment.createBasicProjectSpeechProfile, {
    environmentId,
    input: { projectId },
  });
}

export function translateSpeechTranscriptForEnvironment(
  environmentId: EnvironmentId,
  input: import("@t3tools/contracts").TranslateTranscriptInput,
) {
  return runEnvironmentCommand(serverEnvironment.translateSpeechTranscript, {
    environmentId,
    input,
  });
}

export function improvePromptForEnvironment(
  environmentId: EnvironmentId,
  input: import("@t3tools/contracts").ImprovePromptInput,
) {
  return runEnvironmentCommand(serverEnvironment.improvePrompt, {
    environmentId,
    input,
  });
}

export function reviewPlanParallelismForEnvironment(
  environmentId: EnvironmentId,
  input: PlanParallelismReviewInput,
) {
  return runEnvironmentCommand(serverEnvironment.reviewPlanParallelism, {
    environmentId,
    input,
  });
}

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}
