import type { EnvironmentId, EnvironmentApi } from "@t3tools/contracts";

import * as Cause from "effect/Cause";
import { runAtomCommand, type AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { WsRpcClient } from "@t3tools/client-runtime/wsRpcClient";
import { appAtomRegistry } from "./rpc/atomRegistry";
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
    },
    review: {
      getDiffPreview: client.review.getDiffPreview,
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
    orchestration: {
      exportThreadTranscript: (
        input: Parameters<EnvironmentApi["orchestration"]["exportThreadTranscript"]>[0],
      ) =>
        runEnvironmentCommand(orchestrationEnvironment.exportThreadTranscript, {
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

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}
